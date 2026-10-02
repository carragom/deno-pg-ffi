import { assertEquals, assertThrows } from '@std/assert'
import { array, serializeParams } from './params.ts'

Deno.test('array rejects an object element', () => {
	assertThrows(
		() => array([{ a: 1 }]),
		TypeError,
		'Unsupported array element',
	)
})

Deno.test('Temporal time and duration parameters use PostgreSQL-compatible text', () => {
	const time = Temporal.PlainTime.from('12:34:56.123456789')
	const duration = Temporal.Duration.from('P1Y2M3W4DT5H6M7.123456789S')
	assertEquals(
		serializeParams([
			time,
			duration,
			duration.negated(),
			new Temporal.Duration(),
		]),
		[
			'12:34:56.123456789',
			'P1Y2M3W4DT5H6M7.123456789S',
			'P-1Y-2M-3W-4DT-5H-6M-7.123456789S',
			'PT0S',
		],
	)
	assertEquals(
		serializeParams([Temporal.Duration.from('-PT0.000000001S')]),
		['PT-0.000000001S'],
	)
	assertEquals(
		array([[time, null], [time, time]]),
		'{{"12:34:56.123456789",NULL},{"12:34:56.123456789","12:34:56.123456789"}}',
	)
	assertEquals(
		array([duration.negated(), null]),
		'{"P-1Y-2M-3W-4DT-5H-6M-7.123456789S",NULL}',
	)
})
