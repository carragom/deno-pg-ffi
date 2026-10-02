/** UTF-8 C strings and pointer arrays with retained backing buffers. @module */
const enc = new TextEncoder()
/* WeakMap to hold references to encoded string arrays to prevent garbage collection */
const TO_STR_ARRAY_MAP = new WeakMap<Uint8Array, Uint8Array[]>()

/**
 * Converts a string into a Uint8Array using UTF-8 encoding
 * @param str The string to encode
 * @returns The encoded string as a Uint8Array
 */
export function encode(str: string): Uint8Array<ArrayBuffer> {
	return enc.encode(str)
}

/**
 * Converts a string into a Uint8Array with a terminator appended using UTF-8 encoding. Useful when interacting
 * with C functions
 * @param str The string to encode
 * @param terminator The terminator to append, defaults to null character
 * @returns The encoded string as a Uint8Array
 */
export function encodeTerminated(
	str: string,
	terminator: string = '\0',
): Uint8Array<ArrayBuffer> {
	return encode(str + terminator)
}

/**
 * Encodes an array of strings into a Uint8Array containing pointers to each encoded string.
 * Each string is null-terminated for C interoperability. The function maintains references
 * to the encoded chunks to prevent garbage collection
 *
 * @param strs - Optional array of strings or SQL NULLs to encode
 * @returns A Uint8Array containing 64-bit pointers to each encoded string, or null if no values provided
 * @remarks
 * - Each string is encoded as UTF-8 with a null terminator appended
 * - A `null` entry is a NULL C pointer (SQL NULL), not the string `"null"`
 * - The returned Uint8Array is an 8-bit view of a BigUint64Array containing the pointers
 * - A WeakMap maintains references to prevent the encoded chunks from being garbage collected
 * - Useful for passing string arrays (char**) to C functions via FFI
 */
export function encodeTerminatedArray(
	strs?: Array<string | null> | null,
): Uint8Array<ArrayBuffer> | null {
	if (strs === undefined || strs === null || strs.length === 0) {
		return null
	}

	const chunks: Uint8Array<ArrayBuffer>[] = []
	const ptrs = new BigUint64Array(strs.length)

	for (const [index, str] of strs.entries()) {
		if (str === null) {
			ptrs[index] = 0n
			continue
		}

		const chunk = encodeTerminated(str)
		chunks.push(chunk)
		const ptr = Deno.UnsafePointer.of(chunk)
		ptrs[index] = Deno.UnsafePointer.value(ptr)
	}

	const r = new Uint8Array(ptrs.buffer)
	TO_STR_ARRAY_MAP.set(r, chunks)
	return r
}
