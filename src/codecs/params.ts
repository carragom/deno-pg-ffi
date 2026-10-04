/**
 * Parameter converters for JavaScript values, JSON, and Postgres arrays.
 *
 * These helpers return strings for a `params` list. The SQL cast selects
 * the type. No parameter OID is sent.
 *
 * @module
 */

import { quoteArrayElement } from './array_text.ts'

/**
 * JS values accepted as `$1`, `$2`, … bind parameters.
 *
 * A plain array or object is rejected. {@linkcode array} and {@linkcode json}
 * build parameter text; `undefined` is rejected too. Strings can represent any
 * SQL type when PostgreSQL accepts their text. Casts such as `$1::int4` select
 * the type; parameter OIDs are not sent.
 *
 * Numbers must be finite. Converted text cannot contain NUL (`\0`), while
 * bytea Uint8Array values can contain zero bytes. A bare `null` means SQL NULL.
 * Convert Date with `.toTemporalInstant()` and Temporal.ZonedDateTime with
 * `.toInstant()` before sending; neither is accepted directly.
 *
 * Temporal.PlainTime and Temporal.Duration are accepted regardless of receive
 * options, including through {@linkcode array}. PostgreSQL applies its precision
 * and range rules: nanoseconds can round to microseconds (or lower column
 * precision), even to `24:00:00`. Years/months may combine and weeks become days,
 * so a Duration's original field layout need not round-trip. Negative durations
 * use PostgreSQL's signs on individual ISO components, such as `P-1DT-2H`.
 */
export type Param =
	| string
	| number
	| boolean
	| bigint
	| Temporal.Instant
	| Temporal.PlainDate
	| Temporal.PlainDateTime
	| Temporal.PlainTime
	| Temporal.Duration
	| Uint8Array
	| null

export function serializeNumber(value: unknown): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		throw new TypeError('Expected a finite number')
	}
	return String(value)
}

export function serializeBigint(value: unknown): string {
	if (typeof value !== 'bigint') {
		throw new TypeError('Expected a bigint')
	}
	return String(value)
}

export function serializeBoolean(value: unknown): string {
	if (typeof value !== 'boolean') {
		throw new TypeError('Expected a boolean')
	}
	return value ? 'true' : 'false'
}

export function serializeBytea(value: unknown): string {
	if (!(value instanceof Uint8Array)) {
		throw new TypeError('Expected a Uint8Array')
	}
	let hex = ''
	for (const byte of value) {
		hex += byte.toString(16).padStart(2, '0')
	}
	return `\\x${hex}`
}

export function serializePlainDate(value: unknown): string {
	if (!(value instanceof Temporal.PlainDate)) {
		throw new TypeError('Expected a Temporal.PlainDate')
	}
	return value.toString()
}

export function serializePlainDateTime(value: unknown): string {
	if (!(value instanceof Temporal.PlainDateTime)) {
		throw new TypeError('Expected a Temporal.PlainDateTime')
	}
	return value.toString()
}

export function serializeInstant(value: unknown): string {
	if (!(value instanceof Temporal.Instant)) {
		throw new TypeError('Expected a Temporal.Instant')
	}
	return value.toString()
}

/** @internal Convert a clock time to text without rounding it in JavaScript. */
export function serializePlainTime(value: unknown): string {
	if (!(value instanceof Temporal.PlainTime)) {
		throw new TypeError('Expected a Temporal.PlainTime')
	}
	return value.toString()
}

/** @internal Convert a duration to PostgreSQL's signed ISO component text. */
export function serializeDuration(value: unknown): string {
	if (!(value instanceof Temporal.Duration)) {
		throw new TypeError('Expected a Temporal.Duration')
	}
	const text = value.toString()
	// PostgreSQL requires P first and a sign on each negative component.
	return value.sign < 0 ? text.slice(1).replace(/\d+(?:\.\d+)?/g, '-$&') : text
}

/**
 * Build the text of a `json` or `jsonb` parameter.
 *
 * The result is `JSON.stringify(value)`, including when `value` is already
 * a string. Pass JSON text that is already a string as a plain parameter.
 * The SQL cast selects `json` or `jsonb` (`$1::jsonb`). This function does
 * not send a type OID.
 *
 * `json(null)` is the four characters `null`. A bare `null` parameter is
 * SQL `NULL`. `json(undefined)` throws. As with `JSON.stringify`, non-finite
 * numbers become JSON null, undefined object properties are omitted, and
 * undefined array elements become JSON null. Bigints and cyclic objects throw.
 *
 * @param value A JSON value.
 * @returns JSON text for a parameter; JSON null and SQL NULL both receive as null.
 * @throws {TypeError} When `value` is `undefined`, a bigint, or a cyclic
 * object, or when it does not encode to a string
 *
 * @example
 * ```ts
 * import { json } from '@carragom/deno-pg-ffi'
 *
 * if (json({ a: 1 }) !== '{"a":1}') {
 * 	throw new Error('expected object text')
 * }
 * if (json(null) !== 'null') {
 * 	throw new Error('expected JSON null')
 * }
 * console.log(json({ a: 1 })) // {"a":1}
 * console.log(json(null)) // null
 * ```
 */
export function json(value: unknown): string {
	if (value === undefined) {
		throw new TypeError('undefined is not a valid JSON value')
	}
	const text = JSON.stringify(value)
	if (typeof text !== 'string') {
		throw new TypeError('Value cannot be encoded as JSON')
	}
	return text
}

/**
 * Build the text of a Postgres array parameter.
 *
 * Pass the result in a params list with a cast such as `$1::int4[]` or
 * `$1::text[]`. No parameter type OID is sent. Nested arrays determine rank;
 * `int4[]` and `int4[][]` share one OID. `array([])` produces `{}`.
 *
 * Scalar conversion follows {@linkcode Param}. SQL NULL becomes the unquoted
 * token `NULL`; numbers, bigints, and booleans are also unquoted. Strings,
 * Temporal values, and bytea are double-quoted with quotes/backslashes escaped.
 * These quotes are array syntax, not SQL identifier quotes. The empty string
 * and string `NULL` remain strings.
 *
 * {@linkcode json} returns a string, so `array([json({ a: 1 })])` is one
 * quoted element and is valid for `$1::jsonb[]`. `array([{ a: 1 }])` throws.
 * Mixed and jagged lists are sent as written. Postgres accepts or rejects
 * them against the cast. Cycles throw; repeating an array object is allowed.
 * This helper always uses commas. Types such as `box[]` that require another
 * delimiter must use manually formatted string parameters instead.
 *
 * @param value Scalar or nested array elements.
 * @returns Array text, for example `{1,NULL,"a"}`.
 * @throws {TypeError} When `value` is not an array, an element is an object
 * or `undefined`, a number is not finite, or an array cycle is found
 *
 * @example
 * ```ts
 * import { array } from '@carragom/deno-pg-ffi'
 *
 * if (array([1, null, 3]) !== '{1,NULL,3}') {
 * 	throw new Error('expected null token')
 * }
 * if (array(['NULL', '']) !== '{"NULL",""}') {
 * 	throw new Error('expected quoted NULL and empty string')
 * }
 * if (array([[1, 2], [3, 4]]) !== '{{1,2},{3,4}}') {
 * 	throw new Error('expected nested braces')
 * }
 * console.log(array([1, null, 3])) // {1,NULL,3}
 * console.log(array(['NULL', ''])) // {"NULL",""}
 * console.log(array([[1, 2], [3, 4]])) // {{1,2},{3,4}}
 * ```
 */
export function array(value: unknown[]): string {
	if (!Array.isArray(value)) {
		throw new TypeError('Expected an array')
	}
	return writeArray(value, new Set())
}

function writeArray(value: unknown[], stack: Set<unknown[]>): string {
	// Only active ancestors are cycles; a sibling can reuse the same array.
	if (stack.has(value)) {
		throw new TypeError('Cyclic array')
	}
	stack.add(value)
	try {
		const parts: string[] = []
		for (const element of value) {
			parts.push(writeElement(element, stack))
		}
		return `{${parts.join(',')}}`
	} finally {
		stack.delete(value)
	}
}

function writeElement(value: unknown, stack: Set<unknown[]>): string {
	if (value === null) {
		return 'NULL'
	}
	if (value === undefined) {
		throw new TypeError('undefined is not a valid array element')
	}
	if (Array.isArray(value)) {
		return writeArray(value, stack)
	}
	if (typeof value === 'boolean') {
		return serializeBoolean(value)
	}
	if (typeof value === 'bigint') {
		return serializeBigint(value)
	}
	if (typeof value === 'number') {
		return serializeNumber(value)
	}
	if (typeof value === 'string') {
		return quoteArrayElement(value)
	}
	if (value instanceof Temporal.Instant) {
		return quoteArrayElement(serializeInstant(value))
	}
	if (value instanceof Temporal.PlainDate) {
		return quoteArrayElement(serializePlainDate(value))
	}
	if (value instanceof Temporal.PlainDateTime) {
		return quoteArrayElement(serializePlainDateTime(value))
	}
	if (value instanceof Temporal.PlainTime) {
		return quoteArrayElement(serializePlainTime(value))
	}
	if (value instanceof Temporal.Duration) {
		return quoteArrayElement(serializeDuration(value))
	}
	if (value instanceof Uint8Array) {
		return quoteArrayElement(serializeBytea(value))
	}
	throw new TypeError(
		`Unsupported array element: ${Object.prototype.toString.call(value)}`,
	)
}

function serializeParam(value: Param): string | null {
	if (value === null) {
		return null
	}
	if (value === undefined) {
		throw new TypeError('undefined is not a valid query parameter')
	}
	if (typeof value === 'string') {
		return value
	}
	if (typeof value === 'boolean') {
		return serializeBoolean(value)
	}
	if (typeof value === 'bigint') {
		return serializeBigint(value)
	}
	if (typeof value === 'number') {
		return serializeNumber(value)
	}
	if (value instanceof Temporal.Instant) {
		return serializeInstant(value)
	}
	if (value instanceof Temporal.PlainDate) {
		return serializePlainDate(value)
	}
	if (value instanceof Temporal.PlainDateTime) {
		return serializePlainDateTime(value)
	}
	if (value instanceof Temporal.PlainTime) {
		return serializePlainTime(value)
	}
	if (value instanceof Temporal.Duration) {
		return serializeDuration(value)
	}
	if (value instanceof Uint8Array) {
		return serializeBytea(value)
	}
	if (Array.isArray(value)) {
		throw new TypeError('Array parameters are not supported')
	}
	throw new TypeError(
		`Unsupported parameter type: ${Object.prototype.toString.call(value)}`,
	)
}

/** @internal Convert query parameters to text and reject embedded NULs. */
export function serializeParams(
	params?: Param[],
): Array<string | null> | undefined {
	if (params === undefined) {
		return undefined
	}
	return params.map((param) => {
		const text = serializeParam(param)
		if (text?.includes('\0')) {
			throw new TypeError('Text query parameters cannot contain NUL')
		}
		return text
	})
}
