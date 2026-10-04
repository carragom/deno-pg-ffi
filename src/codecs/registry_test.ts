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
	const timeOnly = new TypeRegistry({ temporalTime: true })
	const intervalOnly = new TypeRegistry({ temporalInterval: true })
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
	const types = new TypeRegistry({
		temporalTime: true,
		temporalInterval: true,
	})
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
	const types = new TypeRegistry({
		temporalTime: true,
		temporalInterval: true,
	})
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
	const types = new TypeRegistry({
		temporalTime: true,
		temporalInterval: true,
	})
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

Deno.test('date, timestamp, and timestamptz options independently control scalar and array conversion', () => {
	const cases = [
		{
			key: 'temporalDate',
			oid: 1082,
			arrayOid: 1182,
			text: '2026-09-19',
			type: Temporal.PlainDate,
		},
		{
			key: 'temporalTimestamp',
			oid: 1114,
			arrayOid: 1115,
			text: '2026-09-19 12:00:00',
			type: Temporal.PlainDateTime,
		},
		{
			key: 'temporalTimestamptz',
			oid: 1184,
			arrayOid: 1185,
			text: '2026-09-19 12:00:00+00',
			type: Temporal.Instant,
		},
	] as const
	for (let mask = 0; mask < 8; mask++) {
		const options = {
			temporalDate: Boolean(mask & 1),
			temporalTimestamp: Boolean(mask & 2),
			temporalTimestamptz: Boolean(mask & 4),
		}
		const types = new TypeRegistry(options)
		for (const { key, oid, arrayOid, text, type } of cases) {
			const value = types.deserialize(oid, text)
			const array = types.deserialize(
				arrayOid,
				`{"${text}",NULL}`,
			) as unknown[]
			if (options[key]) {
				assertInstanceOf(value, type)
				assertInstanceOf(array[0], type)
			} else {
				assertEquals(value, text)
				assertEquals(array[0], text)
			}
			assertEquals(array[1], null)
		}
	}
})

Deno.test('disabled date converters preserve unsupported text and allow private scalar overrides', () => {
	const defaults = new TypeRegistry()
	const text = new TypeRegistry({
		temporalDate: false,
		temporalTimestamp: false,
		temporalTimestamptz: false,
	})
	for (
		const [oid, arrayOid, values] of [
			[1082, 1182, [
				'infinity',
				'-infinity',
				'0001-01-01 BC',
				'10000-01-01',
				'500000-01-01',
			]],
			[1114, 1115, [
				'infinity',
				'-infinity',
				'0001-01-01 00:00:00 BC',
				'10000-01-01 00:00:00',
				'280000-01-01 00:00:00',
			]],
			[1184, 1185, [
				'infinity',
				'-infinity',
				'0001-01-01 00:00:00+00 BC',
				'10000-01-01 00:00:00+00',
				'280000-01-01 00:00:00+00',
			]],
		] as const
	) {
		for (const value of values) {
			assertThrows(() => defaults.deserialize(oid, value), RangeError)
			assertEquals(text.deserialize(oid, value), value)
		}
		assertEquals(
			text.deserialize(
				arrayOid,
				`{${values.map((value) => `"${value}"`).join(',')},NULL}`,
			),
			[...values, null],
		)
	}
	text.registerScalar(1082, (value) => `date:${value}`)
	assertEquals(text.deserialize(1182, '{infinity,NULL}'), [
		'date:infinity',
		null,
	])
	assertInstanceOf(
		defaults.deserialize(1082, '2026-09-19'),
		Temporal.PlainDate,
	)
})

Deno.test('JSON and array opt-outs are independent and keep explicit converters private', () => {
	for (const parseJson of [false, true]) {
		for (const parseArrays of [false, true]) {
			const options = { parseJson, parseArrays }
			const types = new TypeRegistry(options)
			options.parseJson = !parseJson
			options.parseArrays = !parseArrays
			for (const [oid, arrayOid] of [[114, 199], [3802, 3807]]) {
				assertEquals(
					types.deserialize(oid, '9007199254740993'),
					parseJson ? 9007199254740992 : '9007199254740993',
				)
				assertEquals(
					types.deserialize(oid, 'null'),
					parseJson ? null : 'null',
				)
				assertEquals(
					types.deserialize(arrayOid, '{"null",NULL}'),
					parseArrays
						? [parseJson ? null : 'null', null]
						: '{"null",NULL}',
				)
				types.registerScalar(oid, (value) => `json:${value}`)
				assertEquals(types.deserialize(oid, 'null'), 'json:null')
				assertEquals(
					types.deserialize(arrayOid, '{"null",NULL}'),
					parseArrays ? ['json:null', null] : '{"null",NULL}',
				)
			}
			assertEquals(
				types.deserialize(1007, '[5:6]={1,2}'),
				parseArrays ? [1, 2] : '[5:6]={1,2}',
			)
		}
	}
	assertEquals(new TypeRegistry().deserialize(114, 'null'), null)
	assertEquals(new TypeRegistry().deserialize(1007, '{1,2}'), [1, 2])
})

Deno.test('disabled array parsing bypasses element converters until explicitly registered', () => {
	const types = new TypeRegistry({
		parseArrays: false,
		temporalTime: true,
		temporalInterval: true,
	})
	types.registerScalar(1082, () => {
		throw new Error('element converter must not run')
	})
	assertEquals(
		types.deserialize(1182, '[0:1]={infinity,NULL}'),
		'[0:1]={infinity,NULL}',
	)
	assertEquals(types.deserialize(1183, '{24:00:00,NULL}'), '{24:00:00,NULL}')
	assertEquals(types.deserialize(1187, '{infinity,NULL}'), '{infinity,NULL}')
	assertEquals(
		types.deserialize(1020, '{(1,1),(0,0);NULL}'),
		'{(1,1),(0,0);NULL}',
	)
	assertThrows(
		() => types.deserialize(1082, '2026-09-19'),
		Error,
		'element converter must not run',
	)
	assertThrows(() => types.registerScalar(1007, (value) => value), TypeError)
	types.registerScalar(23, (value) => `int:${value}`)
	types.registerArray(1007, 23)
	assertEquals(types.deserialize(1007, '[5:6]={1,2}'), ['int:1', 'int:2'])
	types.registerScalar(OID_CUSTOM_SCALAR, (value) => value.toUpperCase())
	types.registerArray(OID_CUSTOM_ARRAY, OID_CUSTOM_SCALAR)
	assertEquals(types.deserialize(OID_CUSTOM_ARRAY, '{a,NULL}'), ['A', null])
})

Deno.test('float4 reconstructs source precision and preserves boundary and special values', () => {
	const types = new TypeRegistry()
	for (
		const [text, expected] of [
			['0.1', 0.10000000149011612],
			['-0.1', -0.10000000149011612],
			['0', 0],
			['-0', -0],
			['1e-45', 1.401298464324817e-45],
			['1.1754944e-38', 1.1754943508222875e-38],
			['3.4028235e+38', 3.4028234663852886e38],
			['NaN', NaN],
			['Infinity', Infinity],
			['-Infinity', -Infinity],
		] as const
	) {
		assertEquals(
			Object.is(types.deserialize(700, text), expected),
			true,
			text,
		)
	}
	assertEquals(types.deserialize(701, '0.1'), 0.1)
})

Deno.test('float4 arrays use source precision while opt-outs and custom converters take precedence', () => {
	const types = new TypeRegistry()
	assertEquals(types.deserialize(1021, '{{0.1,NULL},{-0.1,1e-45}}'), [
		[0.10000000149011612, null],
		[-0.10000000149011612, 1.401298464324817e-45],
	])
	const text = new TypeRegistry({ parseArrays: false })
	assertEquals(text.deserialize(1021, '{0.1,NULL}'), '{0.1,NULL}')
	types.registerScalar(700, (value) => `float4:${value}`)
	assertEquals(types.deserialize(700, '0.1'), 'float4:0.1')
	assertEquals(types.deserialize(1021, '{0.1,NULL}'), ['float4:0.1', null])
	assertEquals(new TypeRegistry().deserialize(700, '0.1'), 0.10000000149011612)
})
