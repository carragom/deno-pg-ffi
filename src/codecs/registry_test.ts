import { assertEquals, assertInstanceOf, assertThrows } from '@std/assert'

import { TypeRegistry } from './registry.ts'

const OID_INT4 = 23
const OID_BYTEA = 17
const OID_BYTEA_ARRAY = 1001
const OID_UUID = 2950
const OID_UUID_ARRAY = 2951
const OID_CUSTOM_ARRAY = 90001
const OID_CUSTOM_SCALAR = 90002

Deno.test('bytea decodes hex and escape text, including through bytea[]', () => {
	const types = new TypeRegistry()
	const expected = new Uint8Array([65, 92, 0, 255])
	assertEquals(types.deserialize(OID_BYTEA, '\\x415c00ff'), expected)
	assertEquals(types.deserialize(OID_BYTEA, 'A\\\\\\000\\377'), expected)
	assertEquals(types.deserialize(OID_BYTEA, ''), new Uint8Array())
	assertEquals(types.deserialize(OID_BYTEA, '\\x'), new Uint8Array())
	assertEquals(
		types.deserialize(OID_BYTEA_ARRAY, '{"A",""}'),
		[new Uint8Array([65]), new Uint8Array()],
	)
})

Deno.test('registerArray rejects an unknown element OID', () => {
	const types = new TypeRegistry()
	assertThrows(
		() => types.registerArray(OID_CUSTOM_ARRAY, OID_CUSTOM_SCALAR),
		TypeError,
		'no scalar deserializer',
	)
})

Deno.test('registerScalar rejects a built-in array OID', () => {
	const types = new TypeRegistry()
	assertThrows(
		() => types.registerScalar(OID_UUID_ARRAY, (text) => text),
		TypeError,
		'already registered as an array',
	)
})

Deno.test('registerArray rejects a built-in scalar OID', () => {
	const types = new TypeRegistry()
	assertThrows(
		() => types.registerArray(OID_INT4),
		TypeError,
		'already registered as a scalar',
	)
})

Deno.test('registerScalar replaces a previous override', () => {
	const types = new TypeRegistry()
	types.registerScalar(OID_UUID, (text) => `a:${text}`)
	assertEquals(types.deserialize(OID_UUID, 'x'), 'a:x')
	types.registerScalar(OID_UUID, (text) => `b:${text}`)
	assertEquals(types.deserialize(OID_UUID, 'x'), 'b:x')
})

Deno.test('uuid[] leaves stay text until registerArray pairs the scalar', () => {
	const types = new TypeRegistry()
	assertEquals(types.deserialize(OID_UUID_ARRAY, '{abc}'), ['abc'])
	types.registerScalar(OID_UUID, (text) => text.toUpperCase())
	assertEquals(types.deserialize(OID_UUID_ARRAY, '{abc}'), ['abc'])
	types.registerArray(OID_UUID_ARRAY, OID_UUID)
	assertEquals(types.deserialize(OID_UUID_ARRAY, '{abc}'), ['ABC'])
})

Deno.test('registerArray without elementOid keeps string leaves', () => {
	const types = new TypeRegistry()
	types.registerArray(OID_CUSTOM_ARRAY)
	assertEquals(types.deserialize(OID_CUSTOM_ARRAY, '{a,NULL}'), ['a', null])
})

Deno.test('built-in box arrays preserve coordinates, nulls, and rank', () => {
	const types = new TypeRegistry()
	assertEquals(types.deserialize(1020, '{(3,4),(1,2);(7,8),(5,6)}'), [
		'(3,4),(1,2)',
		'(7,8),(5,6)',
	])
	assertEquals(types.deserialize(1020, '{}'), [])
	assertEquals(
		types.deserialize(1020, '{{(3,4),(1,2);NULL};{NULL;(7,8),(5,6)}}'),
		[
			['(3,4),(1,2)', null],
			[null, '(7,8),(5,6)'],
		],
	)
})

Deno.test('custom array delimiters support string and mapped leaves', () => {
	const types = new TypeRegistry()
	types.registerArray(OID_CUSTOM_ARRAY, undefined, ';')
	assertEquals(types.deserialize(OID_CUSTOM_ARRAY, '{a,b;NULL}'), [
		'a,b',
		null,
	])
	types.registerScalar(OID_CUSTOM_SCALAR, (text) => text.toUpperCase())
	types.registerArray(OID_CUSTOM_ARRAY, OID_CUSTOM_SCALAR, ';')
	assertEquals(types.deserialize(OID_CUSTOM_ARRAY, '{{a,b;NULL};{c;d}}'), [
		['A,B', null],
		['C', 'D'],
	])
	types.registerArray(OID_CUSTOM_ARRAY)
	assertEquals(types.deserialize(OID_CUSTOM_ARRAY, '{a;b,c}'), ['a;b', 'c'])
})

Deno.test('box array overrides retain the built-in delimiter and stay private', () => {
	const types = new TypeRegistry()
	const other = new TypeRegistry()
	types.registerScalar(603, (text) => `box:${text}`)
	types.registerArray(1020, 603)
	assertEquals(types.deserialize(1020, '{(3,4),(1,2);NULL}'), [
		'box:(3,4),(1,2)',
		null,
	])
	types.registerArray(1020, undefined, '|')
	assertEquals(types.deserialize(1020, '{a|b}'), ['a', 'b'])
	types.registerArray(1020)
	assertEquals(types.deserialize(1020, '{(3,4),(1,2);NULL}'), [
		'(3,4),(1,2)',
		null,
	])
	assertEquals(other.deserialize(1020, '{(3,4),(1,2);NULL}'), [
		'(3,4),(1,2)',
		null,
	])
	assertEquals(other.deserialize(OID_CUSTOM_ARRAY, '{a;b}'), '{a;b}')
})

Deno.test('an invalid delimiter does not replace an array registration', () => {
	const types = new TypeRegistry()
	types.registerArray(OID_CUSTOM_ARRAY, undefined, ';')
	assertThrows(
		() => types.registerArray(OID_CUSTOM_ARRAY, undefined, ';;'),
		TypeError,
	)
	assertEquals(types.deserialize(OID_CUSTOM_ARRAY, '{a;b}'), ['a', 'b'])
})

Deno.test('Temporal codecs and their array pairings are opt-in and private', () => {
	const defaults = new TypeRegistry()
	const timeOnly = new TypeRegistry(true)
	const intervalOnly = new TypeRegistry(false, true)
	assertEquals(defaults.deserialize(1083, '24:00:00'), '24:00:00')
	assertEquals(defaults.deserialize(1186, 'P1M-1D'), 'P1M-1D')
	assertEquals(defaults.deserialize(1183, '{24:00:00,NULL}'), [
		'24:00:00',
		null,
	])
	assertEquals(defaults.deserialize(1187, '{infinity,NULL}'), [
		'infinity',
		null,
	])
	assertEquals(timeOnly.deserialize(1186, 'P1M-1D'), 'P1M-1D')
	assertEquals(intervalOnly.deserialize(1083, '24:00:00'), '24:00:00')
	assertThrows(() => timeOnly.deserialize(1083, '24:00:00'), RangeError)
	assertThrows(() => intervalOnly.deserialize(1187, '{infinity}'), RangeError)

	const times = timeOnly.deserialize(
		1183,
		'{{12:00:00,NULL},{00:00:00,01:00:00}}',
	) as (Temporal.PlainTime | null)[][]
	assertEquals(
		times.map((row) => row.map((time) => time?.toString() ?? null)),
		[
			['12:00:00', null],
			['00:00:00', '01:00:00'],
		],
	)
	const intervals = intervalOnly.deserialize(
		1187,
		'{P1D,PT24H,NULL}',
	) as (Temporal.Duration | null)[]
	assertEquals(intervals.map((duration) => duration?.toString() ?? null), [
		'P1D',
		'PT24H',
		null,
	])
	intervalOnly.registerScalar(1186, (text) => text)
	assertEquals(intervalOnly.deserialize(1187, '{P1M-1D,NULL}'), [
		'P1M-1D',
		null,
	])
	assertThrows(() => defaults.registerArray(1183, 1083), TypeError)
	defaults.registerScalar(1083, (text) => text)
	defaults.registerArray(1183, 1083)
	assertEquals(defaults.deserialize(1183, '{24:00:00}'), ['24:00:00'])
})

Deno.test('time decoder preserves microseconds and rejects end of day', () => {
	const types = new TypeRegistry(true, true)
	assertEquals(
		(types.deserialize(1083, '12:34:56.123456') as Temporal.PlainTime)
			.toString(),
		'12:34:56.123456',
	)
	assertEquals(
		(types.deserialize(1083, '00:00:00') as Temporal.PlainTime).toString(),
		'00:00:00',
	)
	const error = assertThrows(
		() => (types.deserialize(1083, '24:00:00') as Temporal.PlainTime),
		RangeError,
		'PostgreSQL time "24:00:00"',
	)
	assertInstanceOf(error.cause, RangeError)
})

Deno.test('interval decoder preserves calendar units, large hours, and signed fractions', () => {
	const types = new TypeRegistry(true, true)
	for (
		const [text, expected] of [
			['PT0S', 'PT0S'],
			['P1Y2M3DT4H5M6.123456S', 'P1Y2M3DT4H5M6.123456S'],
			['P-1Y-2M-3DT-4H-5M-6.123456S', '-P1Y2M3DT4H5M6.123456S'],
			['PT-0.000001S', '-PT0.000001S'],
			['PT-0.001S', '-PT0.001S'],
			['P1D', 'P1D'],
			['PT24H', 'PT24H'],
			['PT2562047788H', 'PT2562047788H'],
			['P178956970Y7M', 'P178956970Y7M'],
			['P2147483647D', 'P2147483647D'],
		]
	) {
		assertEquals(
			(types.deserialize(1186, text) as Temporal.Duration).toString(),
			expected,
		)
	}
})

Deno.test('interval decoder rejects unsupported values with the text and cause', () => {
	const types = new TypeRegistry(true, true)
	for (
		const text of [
			'P1M-1D',
			'P-1DT1H',
			'P1DT-0.000001S',
			'infinity',
			'-infinity',
			'P4294967296Y',
			'PT999999999999999999H',
			'1 mon',
			'-P1D',
			'P',
			'PT',
			'P1DT',
			'PT1.1234567S',
			'P1Dgarbage',
		]
	) {
		const error = assertThrows(
			() => (types.deserialize(1186, text) as Temporal.Duration),
			RangeError,
			`PostgreSQL interval ${JSON.stringify(text)}`,
		)
		assertInstanceOf(error.cause, RangeError)
	}
})
