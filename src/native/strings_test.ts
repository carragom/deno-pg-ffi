import { assertEquals, assertExists } from '@std/assert'
import { encode, encodeTerminated, encodeTerminatedArray } from './strings.ts'

Deno.test('encode', () => {
	const str = 'hello'
	const expected = new TextEncoder().encode(str)
	const actual = encode(str)
	assertEquals(actual, expected)
})

Deno.test('encodeTerminated', () => {
	const str = 'hello'
	const expected = new TextEncoder().encode(str + '\0')
	const actual = encodeTerminated(str)
	assertEquals(actual, expected)
})

Deno.test('encodeTerminatedArray', async (t) => {
	await t.step('should return null for an empty array', () => {
		const result = encodeTerminatedArray([])
		assertEquals(result, null)
	})

	await t.step('should return null for null input', () => {
		const result = encodeTerminatedArray(undefined)
		assertEquals(result, null)
	})

	await t.step('should return null for undefined input', () => {
		const result = encodeTerminatedArray(undefined)
		assertEquals(result, null)
	})

	await t.step('should return null for zero lenght input', () => {
		const result = encodeTerminatedArray([])
		assertEquals(result, null)
	})

	await t.step(
		'should return a Uint8Array for an array with one string',
		() => {
			const result = encodeTerminatedArray(['hello'])
			assertExists(result)
			assertEquals(result instanceof Uint8Array, true)
			assertEquals(result.length > 0, true)
		},
	)

	await t.step(
		'should return a Uint8Array for an array with multiple strings',
		() => {
			const result = encodeTerminatedArray(['hello', 'world'])
			assertExists(result)
			assertEquals(result instanceof Uint8Array, true)
			assertEquals(result.length > 0, true)
		},
	)

	await t.step('should correctly encode and map the strings', () => {
		const strings = ['hello', 'world']
		const result = encodeTerminatedArray(strings)
		assertExists(result)
		assertEquals(result instanceof Uint8Array, true)
		assertEquals(result.length > 0, true)
		// 1 pointer per string
		// each pointer is 8 bytes long
		// 8 bytes * number of strings = total length of the buffer
		assertEquals(result.length, strings.length * 8)
	})

	await t.step('should encode a null slot as a zero pointer', () => {
		const result = encodeTerminatedArray(['hello', null])
		assertExists(result)
		assertEquals(result.length, 16)
		const ptrs = new BigUint64Array(result.buffer)
		assertEquals(ptrs[1], 0n)
		assertEquals(ptrs[0] !== 0n, true)
	})

	await t.step('should encode an array of only nulls', () => {
		const result = encodeTerminatedArray([null])
		assertExists(result)
		assertEquals(result.length, 8)
		const ptrs = new BigUint64Array(result.buffer)
		assertEquals(ptrs[0], 0n)
	})
})
