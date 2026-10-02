/** Parsing and quoting for PostgreSQL array text. @module */
/** Nested array text. `null` is an unquoted `NULL` element. */
export type ArrayText = Array<string | null | ArrayText>

/**
 * Parse Postgres array text into element strings.
 *
 * A leading `[l:u]...=` dimension prefix is skipped. Bounds are not kept.
 *
 * @param {string} text - Array text from `array_out` or {@linkcode array}
 * @param {string} [delimiter] - Element delimiter, default comma
 * @returns {ArrayText} Nested elements. `null` is SQL NULL
 * @throws {TypeError} When `text` is not an array literal or the delimiter
 * is invalid
 */
export function parseArrayText(text: string, delimiter = ','): ArrayText {
	validateArrayDelimiter(delimiter)
	let index = skipDimensionPrefix(text, 0)
	const parsed = parseLevel(text, index, delimiter)
	index = skipSpace(text, parsed.index)
	if (index !== text.length) {
		throw malformed(text)
	}
	return parsed.value
}

/** Validate a single ASCII delimiter that does not conflict with array syntax. */
export function validateArrayDelimiter(delimiter: string): void {
	if (
		delimiter.length !== 1 || delimiter.charCodeAt(0) > 126 ||
		delimiter.charCodeAt(0) < 33 || '{}"\\'.includes(delimiter)
	) {
		throw new TypeError('Invalid array delimiter')
	}
}

/** @internal Quote one converted element for an array literal. */
export function quoteArrayElement(text: string): string {
	return `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function malformed(text: string): TypeError {
	return new TypeError(`Malformed array literal: ${text}`)
}

function isSpace(char: string): boolean {
	return char === ' ' || char === '\t' || char === '\n' || char === '\r' ||
		char === '\v' || char === '\f'
}

function skipSpace(text: string, index: number): number {
	let next = index
	while (next < text.length && isSpace(text[next])) {
		next++
	}
	return next
}

function skipDimensionPrefix(text: string, index: number): number {
	let next = skipSpace(text, index)
	if (text[next] !== '[') {
		return next
	}
	while (text[next] === '[') {
		const close = text.indexOf(']', next + 1)
		if (close === -1) {
			throw malformed(text)
		}
		next = close + 1
	}
	if (text[next] !== '=') {
		throw malformed(text)
	}
	return skipSpace(text, next + 1)
}

function parseLevel(
	text: string,
	index: number,
	delimiter: string,
): { value: ArrayText; index: number } {
	if (text[index] !== '{') {
		throw malformed(text)
	}
	let next = skipSpace(text, index + 1)
	const value: ArrayText = []
	if (text[next] === '}') {
		return { value, index: next + 1 }
	}
	while (next < text.length) {
		if (text[next] === '{') {
			const nested = parseLevel(text, next, delimiter)
			value.push(nested.value)
			next = nested.index
		} else {
			const element = parseElement(text, next, delimiter)
			value.push(element.value)
			next = element.index
		}
		next = skipSpace(text, next)
		if (text[next] === delimiter) {
			next = skipSpace(text, next + 1)
			if (
				next >= text.length || text[next] === '}' ||
				text[next] === delimiter
			) {
				throw malformed(text)
			}
			continue
		}
		if (text[next] === '}') {
			return { value, index: next + 1 }
		}
		throw malformed(text)
	}
	throw malformed(text)
}

function parseElement(
	text: string,
	index: number,
	delimiter: string,
): { value: string | null; index: number } {
	if (index >= text.length) {
		throw malformed(text)
	}
	if (text[index] === '"') {
		return parseQuoted(text, index + 1, delimiter)
	}
	if (
		text[index] === '{' || text[index] === '}' || text[index] === delimiter
	) {
		throw malformed(text)
	}
	let raw = ''
	// Track where significant content ends: unescaped trailing whitespace
	// is syntax, escaped whitespace is data. An escape also makes NULL a string.
	let contentLength = 0
	let hasEscape = false
	let next = index
	while (next < text.length) {
		const char = text[next]
		if (char === '{' || char === '"') {
			throw malformed(text)
		}
		if (char === '\\') {
			next++
			if (next >= text.length) {
				throw malformed(text)
			}
			raw += text[next]
			contentLength = raw.length
			hasEscape = true
			next++
			continue
		}
		if (char === delimiter || char === '}') {
			const body = raw.slice(0, contentLength)
			if (!hasEscape && body.toLowerCase() === 'null') {
				return { value: null, index: next }
			}
			return { value: body, index: next }
		}
		raw += char
		if (!isSpace(char)) {
			contentLength = raw.length
		}
		next++
	}
	throw malformed(text)
}

function parseQuoted(
	text: string,
	index: number,
	delimiter: string,
): { value: string; index: number } {
	let raw = ''
	let next = index
	while (next < text.length) {
		const char = text[next]
		if (char === '\\') {
			next++
			if (next >= text.length) {
				throw malformed(text)
			}
			raw += text[next]
			next++
			continue
		}
		if (char === '"') {
			next++
			while (next < text.length && isSpace(text[next])) {
				next++
			}
			if (next >= text.length) {
				throw malformed(text)
			}
			const after = text[next]
			if (after !== delimiter && after !== '}' && after !== '{') {
				throw malformed(text)
			}
			return { value: raw, index: next }
		}
		raw += char
		next++
	}
	throw malformed(text)
}
