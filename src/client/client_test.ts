import {
	assert,
	assertEquals,
	assertInstanceOf,
	assertNotEquals,
	assertRejects,
	assertThrows,
} from '@std/assert'

import { PGURL } from '../constants.ts'
import {
	array,
	Client,
	type ClientOptions,
	json,
	Pool,
	PoolClient,
	PostgresError,
	type Result,
	Statement,
} from '../mod.ts'
import { Notifier } from './notifier.ts'
import { conninfoParamsFromUrl } from '../conninfo.ts'

const PG_ENV_KEYS = [
	'PGHOST',
	'PGPORT',
	'PGUSER',
	'PGPASSWORD',
	'PGDATABASE',
] as const
const DEFAULT_PGURL = 'postgresql://localhost'
const TIMEOUT_CONNINFO = 'host=127.100.100.100 connect_timeout=1'
let initialPgurl: string | undefined
let previousPgurl: string

Deno.test.beforeAll(() => {
	initialPgurl = Deno.env.get(PGURL)
	if (initialPgurl === undefined || initialPgurl.trim() === '') {
		Deno.env.set(PGURL, DEFAULT_PGURL)
	}
})

Deno.test.afterAll(() => {
	if (initialPgurl === undefined) {
		Deno.env.delete(PGURL)
	} else {
		Deno.env.set(PGURL, initialPgurl)
	}
})

Deno.test.beforeEach(() => {
	previousPgurl = Deno.env.get(PGURL)!
})

Deno.test.afterEach(() => {
	if (previousPgurl === undefined) {
		Deno.env.delete(PGURL)
	} else {
		Deno.env.set(PGURL, previousPgurl)
	}
})

function getPGURL(): string {
	const pgurl = Deno.env.get(PGURL)
	if (pgurl === undefined || pgurl.trim() === '') {
		throw new Error(`${PGURL} must be set for this test`)
	}

	return pgurl
}

function setOptionalEnv(key: string, value: string | undefined): void {
	if (value === undefined || value === '') {
		Deno.env.delete(key)
	} else {
		Deno.env.set(key, value)
	}
}

function isolateFromLibpqEnv(): Record<(typeof PG_ENV_KEYS)[number], string> {
	const previous = {} as Record<(typeof PG_ENV_KEYS)[number], string>
	for (const key of PG_ENV_KEYS) {
		previous[key] = Deno.env.get(key) ?? ''
		Deno.env.delete(key)
	}
	return previous
}

function restoreLibpqEnv(
	previous: Record<(typeof PG_ENV_KEYS)[number], string>,
): void {
	for (const key of PG_ENV_KEYS) {
		setOptionalEnv(key, previous[key])
	}
}

Deno.test('Client.connect accepts string, URL, and record', async () => {
	const previous = isolateFromLibpqEnv()
	try {
		const pgurl = getPGURL()
		const params = conninfoParamsFromUrl(new URL(pgurl))

		await using fromString = await Client.connect(pgurl)
		await using fromUrl = await Client.connect(new URL(pgurl))
		await using fromRecord = await Client.connect(params)

		await using a = await fromString.query<{ n: number }>(
			'SELECT 1::int4 AS n',
		)
		await using b = await fromUrl.query<{ n: number }>('SELECT 1::int4 AS n')
		await using c = await fromRecord.query<{ n: number }>(
			'SELECT 1::int4 AS n',
		)
		assertEquals(a.rows[0].n, 1)
		assertEquals(b.rows[0].n, 1)
		assertEquals(c.rows[0].n, 1)
	} finally {
		restoreLibpqEnv(previous)
	}
})

Deno.test({
	name: 'TLS-required connection negotiates encryption',
	ignore: Deno.env.get('LIBPQ_TEST_TLS') !== '1',
	async fn() {
		assertEquals(new URL(getPGURL()).searchParams.get('sslmode'), 'require')
		await using client = await Client.connect()
		await using result = await client.query<{ ssl: boolean }>(
			'SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()',
		)
		assertEquals(result.rows[0].ssl, true)
	},
})

Deno.test('Client.connect omits undefined connection options', async () => {
	const params = conninfoParamsFromUrl(new URL(getPGURL()))
	await using db = await Client.connect({ ...params, hostaddr: undefined })
	await using r = await db.query<{ n: number }>('SELECT 1::int4 AS n')
	assertEquals(r.rows[0].n, 1)
})

Deno.test('Client.connect uses PGURL when conninfo is omitted', async () => {
	await using db = await Client.connect()
	await using r = await db.query<{ n: number }>('SELECT 1::int4 AS n')
	assertEquals(r.rows[0].n, 1)
})

Deno.test('Client.connect throws on timeout and does not leak', async () => {
	await assertRejects(
		() => Client.connect(TIMEOUT_CONNINFO),
		Error,
	)
})

Deno.test('Client.close and asyncDispose finish the connection', async () => {
	const db = await Client.connect()
	await db.close()
	await assertRejects(() => db.query('SELECT 1'), Error, 'closed')

	await using db2 = await Client.connect()
	await db2[Symbol.asyncDispose]()
	await assertRejects(() => db2.query('SELECT 1'), Error, 'closed')
})

Deno.test('Client.close waits for an in-flight command', async () => {
	const db = await Client.connect()
	const pending = db.query<{ n: number }>(
		'SELECT 1::int4 AS n, pg_sleep(0.2)',
	)
	const closing = db.close()
	await using r = await pending
	assertEquals(r.rows[0].n, 1)
	await closing
	await assertRejects(() => db.query('SELECT 1'), Error, 'closed')
})

Deno.test('Client rejects overlapping commands', async () => {
	await using db = await Client.connect()
	const pending = db.query('SELECT pg_sleep(0.2)')
	await assertRejects(
		() => db.query('SELECT 1'),
		Error,
		'in progress',
	)
	await using r = await pending
	assertEquals(r.command, 'SELECT')
})

Deno.test('query binds primitive params and SQL NULL', async () => {
	await using db = await Client.connect()
	await using r = await db.query<{
		s: string
		n: number
		ok: boolean
		big: bigint
		empty: string | null
	}>(
		`SELECT
			$1::text AS s,
			$2::int4 AS n,
			$3::bool AS ok,
			$4::int8 AS big,
			$5::text AS empty`,
		['hi', 7, true, 10n, null],
	)
	assertEquals(r.rows[0].s, 'hi')
	assertEquals(r.rows[0].n, 7)
	assertEquals(r.rows[0].ok, true)
	assertEquals(r.rows[0].big, 10n)
	assertEquals(r.rows[0].empty, null)
})

Deno.test('query and prepared execution reject NUL in serialized text params', async () => {
	await using db = await Client.connect()
	await assertRejects(
		() => db.query('SELECT $1::text', ['before\0after']),
		TypeError,
		'NUL',
	)
	await assertRejects(
		() => db.query('SELECT $1::text[]', [array(['before\0after'])]),
		TypeError,
		'NUL',
	)
	await using afterQueryError = await db.query('SELECT 1::int4 AS n')
	assertEquals(afterQueryError.rows[0].n, 1)

	await using stmt = await db.prepare('SELECT $1::text AS value')
	await assertRejects(
		() => stmt.execute(['before\0after']),
		TypeError,
		'NUL',
	)
	await using afterPreparedError = await stmt.execute(['ok'])
	assertEquals(afterPreparedError.rows[0].value, 'ok')
})

Deno.test('query rejects unsupported parameter types', async () => {
	await using db = await Client.connect()
	await assertRejects(
		() => db.query('SELECT $1::text', [undefined as unknown as string]),
		TypeError,
		'undefined',
	)
	await assertRejects(
		() => db.query('SELECT $1::jsonb', [{ a: 1 } as unknown as string]),
		TypeError,
	)
	await assertRejects(
		() => db.query('SELECT $1::int4[]', [[1] as unknown as string]),
		TypeError,
		'Array',
	)
	await assertRejects(
		() =>
			db.query('SELECT $1::timestamptz', [
				new Date('2026-09-19T00:35:00.000Z') as unknown as string,
			]),
		TypeError,
	)
	await assertRejects(
		() =>
			db.query('SELECT $1::timestamptz', [
				Temporal.Now.zonedDateTimeISO() as unknown as string,
			]),
		TypeError,
	)
})

Deno.test('query Temporal params round-trip', async () => {
	await using db = await Client.connect()
	const instant = Temporal.Instant.from('2026-09-19T00:35:00Z')
	const plainDate = Temporal.PlainDate.from('2026-09-19')
	const plainDateTime = Temporal.PlainDateTime.from('2026-09-19T12:00:00')

	await using r = await db.query<{
		at: Temporal.Instant
		d: Temporal.PlainDate
		ts: Temporal.PlainDateTime
	}>(
		`SELECT
			$1::timestamptz AS at,
			$2::date AS d,
			$3::timestamp AS ts`,
		[instant, plainDate, plainDateTime],
	)
	assertEquals(r.rows[0].at.toString(), instant.toString())
	assertEquals(r.rows[0].d.toString(), '2026-09-19')
	assertEquals(r.rows[0].ts.toString(), '2026-09-19T12:00:00')
})

Deno.test('Client Temporal flags are independent and keep timetz as text', async () => {
	for (const temporalTime of [false, true]) {
		for (const temporalInterval of [false, true]) {
			const options: ClientOptions = { temporalTime, temporalInterval }
			await using db = await Client.connect(
				{
					...conninfoParamsFromUrl(new URL(getPGURL())),
					options: '-c intervalstyle=postgres_verbose',
				},
				options,
			)
			options.temporalTime = !temporalTime
			options.temporalInterval = !temporalInterval
			await using result = await db.query<{
				t: string | Temporal.PlainTime
				i: string | Temporal.Duration
				tz: string
				style: string
			}>(`SELECT time '12:34:56.123456' AS t,
				interval '1 month 2 days 24 hours' AS i,
				timetz '12:34:56+05:30' AS tz,
				current_setting('IntervalStyle') AS style`)
			const row = result.rows[0]
			if (temporalTime) {
				assertInstanceOf(row.t, Temporal.PlainTime)
			} else {
				assertEquals(row.t, '12:34:56.123456')
			}
			if (temporalInterval) {
				assertInstanceOf(row.i, Temporal.Duration)
				assertEquals(row.i.toString(), 'P1M2DT24H')
			} else {
				assertEquals(typeof row.i, 'string')
			}
			assertEquals(row.tz, '12:34:56+05:30')
			assertEquals(
				row.style,
				temporalInterval ? 'iso_8601' : 'postgres_verbose',
			)
		}
	}
})

Deno.test('Temporal parameters work without receive options and round at server precision', async () => {
	await using db = await Client.connect()
	const time = Temporal.PlainTime.from('12:34:56.123456789')
	const duration = Temporal.Duration.from('-P1Y2M3W4DT5H6M7.123456789S')
	await using result = await db.query<{
		t: string
		i: string
		months: number
		days: number
		seconds: number
	}>(
		`SELECT $1::time AS t, $2::interval AS i,
		EXTRACT(MONTH FROM $2::interval)::int4 AS months,
		EXTRACT(DAY FROM $2::interval)::int4 AS days,
		EXTRACT(SECOND FROM $2::interval)::float8 AS seconds`,
		[time, duration],
	)
	assertEquals(result.rows[0].t, '12:34:56.123457')
	assertEquals(typeof result.rows[0].i, 'string')
	assertEquals(result.rows[0].months, -2)
	assertEquals(result.rows[0].days, -25)
	assertEquals(result.rows[0].seconds, -7.123457)
})

Deno.test('Temporal codecs round-trip table columns, nested arrays, and prepared parameters', async () => {
	await using db = await Client.connect(undefined, {
		temporalTime: true,
		temporalInterval: true,
	})
	await using _table = await db.query(
		'CREATE TEMP TABLE temporal_codec_probe (t time, i interval, times time[], intervals interval[])',
	)
	const time = Temporal.PlainTime.from('12:34:56.123456')
	const duration = Temporal.Duration.from('-P1Y2M3DT24H5M6.123456S')
	await using stmt = await db.prepare(`INSERT INTO pg_temp.temporal_codec_probe
		VALUES ($1, $2, $3, $4) RETURNING *`)
	await using result = await stmt.execute<{
		t: Temporal.PlainTime
		i: Temporal.Duration
		times: (Temporal.PlainTime | null)[][]
		intervals: (Temporal.Duration | null)[]
	}>([
		time,
		duration,
		array([[time, null], [null, time]]),
		array([duration, new Temporal.Duration(), null]),
	])
	const row = result.rows[0]
	assertEquals(row.t.toString(), time.toString())
	assertEquals(row.i.toString(), duration.toString())
	assertEquals(
		row.times.map((times) => times.map((t) => t?.toString() ?? null)),
		[
			[time.toString(), null],
			[null, time.toString()],
		],
	)
	assertEquals(row.intervals.map((i) => i?.toString() ?? null), [
		duration.toString(),
		'PT0S',
		null,
	])
	await using positive = await stmt.execute<{
		i: Temporal.Duration
		times: unknown[]
		intervals: unknown[]
	}>([
		time,
		duration.abs(),
		array([]),
		array([]),
	])
	assertEquals(positive.rows[0].i.toString(), duration.abs().toString())
	assertEquals(positive.rows[0].times, [])
	assertEquals(positive.rows[0].intervals, [])
})

Deno.test('Unsupported Temporal values throw only on row access and allow text overrides', async () => {
	await using db = await Client.connect(undefined, {
		temporalTime: true,
		temporalInterval: true,
	})
	for (
		const [sql, expected] of [
			["SELECT time '24:00:00' AS value", 'PostgreSQL time "24:00:00"'],
			[
				"SELECT ARRAY[time '24:00:00'] AS value",
				'PostgreSQL time "24:00:00"',
			],
			[
				"SELECT interval '1 month -1 day' AS value",
				'PostgreSQL interval "P1M-1D"',
			],
			[
				"SELECT ARRAY[interval '-1 day 1 hour'] AS value",
				'PostgreSQL interval "P-1DT1H"',
			],
			['SELECT $1::time AS value', 'PostgreSQL time "24:00:00"'],
		]
	) {
		await using result = await db.query(
			sql,
			sql.includes('$1')
				? [Temporal.PlainTime.from('23:59:59.999999999')]
				: undefined,
		)
		assertEquals(result.rows.length, 1)
		const error = assertThrows(() => result.rows[0], RangeError, expected)
		assertInstanceOf(error.cause, RangeError)
	}
	// Interval infinities were introduced in PostgreSQL 17, independently of
	// this package's libpq 17 floor. Keep older server suites supported.
	await using version = await db.query<{ version: number }>(
		"SELECT current_setting('server_version_num')::int4 AS version",
	)
	if (version.rows[0].version >= 170000) {
		for (const text of ['infinity', '-infinity']) {
			await using result = await db.query('SELECT $1::interval AS value', [
				text,
			])
			assertThrows(() => result.rows[0], RangeError, text)
		}
	}
	await using text = await db.query<{ t: string; i: string }>(
		"SELECT time '24:00:00'::text AS t, interval '1 month -1 day'::text AS i",
	)
	assertEquals(text.rows[0], { t: '24:00:00', i: 'P1M-1D' })
	await using unread = await db.query<{ intervals: string[] }>(
		"SELECT ARRAY[interval '1 month -1 day'] AS intervals",
	)
	db.registerScalar(1186, (value) => value)
	assertEquals(unread.rows[0].intervals, ['P1M-1D'])
})

Deno.test('Changing IntervalStyle through SQL breaks opt-in interval decoding', async () => {
	await using db = await Client.connect(undefined, { temporalInterval: true })
	await using collected = await db.query<{ i: Temporal.Duration }>(
		"SELECT interval '1 month' AS i",
	)
	await using _setting = await db.exec('SET IntervalStyle = postgres')
	assertEquals(collected.rows[0].i.toString(), 'P1M')
	await using incompatible = await db.query("SELECT interval '1 month' AS i")
	assertThrows(
		() => incompatible.rows[0],
		RangeError,
		'PostgreSQL interval "1 mon"',
	)
})

Deno.test('query rejects multiple statements', async () => {
	await using db = await Client.connect()
	await assertRejects(
		() => db.query('SELECT 1; SELECT 2'),
		PostgresError,
	)
})

Deno.test('query converters cover ftypes', async () => {
	await using db = await Client.connect()
	await using r = await db.query<{
		i2: number
		i4: number
		i8: bigint
		ok: boolean
		f8: number
		txt: string
		num: string
		doc: { a: number }
		docb: { a: number }
		bin: Uint8Array
		net: string
	}>(
		`SELECT
			$1::int2 AS i2,
			$2::int4 AS i4,
			$3::int8 AS i8,
			$4::bool AS ok,
			$5::float8 AS f8,
			$6::text AS txt,
			$7::numeric AS num,
			$8::json AS doc,
			$9::jsonb AS docb,
			$10::bytea AS bin,
			$11::inet AS net`,
		[
			1,
			2,
			9007199254740993n,
			false,
			1.5,
			'x',
			'1.25',
			'{"a":1}',
			'{"a":1}',
			new Uint8Array([0xde, 0xad]),
			'127.0.0.1',
		],
	)
	const row = r.rows[0]
	assertEquals(typeof row.i2, 'number')
	assertEquals(row.i2, 1)
	assertEquals(row.i4, 2)
	assertEquals(row.i8, 9007199254740993n)
	assertEquals(row.ok, false)
	assertEquals(row.f8, 1.5)
	assertEquals(row.txt, 'x')
	assertEquals(row.num, '1.25')
	assertEquals(row.doc, { a: 1 })
	assertEquals(row.docb, { a: 1 })
	assertEquals(row.bin, new Uint8Array([0xde, 0xad]))
	assertEquals(typeof row.net, 'string')
	assert(row.net.startsWith('127.0.0.1'))
})

Deno.test('bytea escape output decodes for scalar and array results', async () => {
	await using db = await Client.connect()
	await using _setting = await db.exec("SET bytea_output = 'escape'")
	await using r = await db.query<{
		bytes: Uint8Array
		bins: Uint8Array[]
	}>(
		`SELECT
			$1::bytea AS bytes,
			$2::bytea[] AS bins`,
		[
			new Uint8Array([65, 92, 0, 255]),
			array([new Uint8Array([65, 92, 0, 255]), new Uint8Array()]),
		],
	)
	assertEquals(r.rows[0].bytes, new Uint8Array([65, 92, 0, 255]))
	assertEquals(r.rows[0].bins, [
		new Uint8Array([65, 92, 0, 255]),
		new Uint8Array(),
	])
})

Deno.test('query json and array helpers round-trip', async () => {
	await using db = await Client.connect()
	await using r = await db.query<{
		jnull: null
		absent: null
		nums: Array<number | null>
		nested: number[][]
		tags: string[]
		bins: Uint8Array[]
		docs: Array<{ a: number } | null>
		amounts: Array<string | null>
		ids: string[]
		shifted: number[]
	}>(
		`SELECT
			$1::jsonb AS jnull,
			$2::jsonb AS absent,
			$3::int4[] AS nums,
			$4::int4[] AS nested,
			$5::text[] AS tags,
			$6::bytea[] AS bins,
			$7::jsonb[] AS docs,
			$8::numeric[] AS amounts,
			$9::uuid[] AS ids,
			'[0:1]={10,20}'::int4[] AS shifted`,
		[
			json(null),
			null,
			array([1, null, 3]),
			array([[1, 2], [3, 4]]),
			array(['NULL', '']),
			array([new Uint8Array([1, 2, 255])]),
			array([json({ a: 1 }), json(null)]),
			array(['1.25', null]),
			'{a4a70900-a4a7-4a4a-a4a7-a4a70900a4a7}',
		],
	)
	const row = r.rows[0]
	assertEquals(row.jnull, null)
	assertEquals(row.absent, null)
	assertEquals(row.nums, [1, null, 3])
	assertEquals(row.nested, [[1, 2], [3, 4]])
	assertEquals(row.tags, ['NULL', ''])
	assertEquals(row.bins, [new Uint8Array([1, 2, 255])])
	assertEquals(row.docs, [{ a: 1 }, null])
	assertEquals(row.amounts, ['1.25', null])
	assertEquals(row.ids, ['a4a70900-a4a7-4a4a-a4a7-a4a70900a4a7'])
	assertEquals(row.shifted, [10, 20])
})

Deno.test('query box arrays preserves coordinates, nulls, and rank', async () => {
	await using db = await Client.connect()
	await using r = await db.query<{
		boxes: string[]
		raw: string
		nested: Array<Array<string | null>>
		empty: string[]
		absent: null
	}>(`WITH boxes AS (
		SELECT box(point(1,2),point(3,4)) AS a,
			box(point(5,6),point(7,8)) AS b
	)
	SELECT ARRAY[a,b] AS boxes, ARRAY[a,b]::text AS raw,
		ARRAY[ARRAY[a,NULL::box],ARRAY[NULL::box,b]] AS nested,
		ARRAY[]::box[] AS empty, NULL::box[] AS absent
	FROM boxes`)
	assertEquals(r.rows[0], {
		boxes: ['(3,4),(1,2)', '(7,8),(5,6)'],
		raw: '{(3,4),(1,2);(7,8),(5,6)}',
		nested: [['(3,4),(1,2)', null], [null, '(7,8),(5,6)']],
		empty: [],
		absent: null,
	})
	db.registerScalar(603, (text) => `box:${text}`)
	db.registerArray(1020, 603, ';')
	await using mapped = await db.query<{ boxes: string[] }>(
		'SELECT ARRAY[box(point(1,2),point(3,4))] AS boxes',
	)
	assertEquals(mapped.rows[0].boxes, ['box:(3,4),(1,2)'])
})

Deno.test('registerScalar uuid does not change uuid[] until registerArray', async () => {
	const uuid = 'a4a70900-a4a7-4a4a-a4a7-a4a70900a4a7'
	await using db = await Client.connect()
	db.registerScalar(2950, (text) => text.toUpperCase())
	await using scalar = await db.query<{ id: string }>(
		`SELECT $1::uuid AS id`,
		[uuid],
	)
	assertEquals(scalar.rows[0].id, uuid.toUpperCase())
	await using arrayOnly = await db.query<{ ids: string[] }>(
		`SELECT $1::uuid[] AS ids`,
		[`{${uuid}}`],
	)
	assertEquals(arrayOnly.rows[0].ids, [uuid])
	db.registerArray(2951, 2950)
	await using both = await db.query<{ ids: string[] }>(
		`SELECT $1::uuid[] AS ids`,
		[`{${uuid}}`],
	)
	assertEquals(both.rows[0].ids, [uuid.toUpperCase()])
})

Deno.test('Client type registration is per client', async () => {
	const uuid = 'a4a70900-a4a7-4a4a-a4a7-a4a70900a4a7'
	await using left = await Client.connect()
	await using right = await Client.connect()
	left.registerScalar(2950, (text) => text.toUpperCase())
	await using a = await left.query<{ id: string }>(
		`SELECT $1::uuid AS id`,
		[uuid],
	)
	await using b = await right.query<{ id: string }>(
		`SELECT $1::uuid AS id`,
		[uuid],
	)
	assertEquals(a.rows[0].id, uuid.toUpperCase())
	assertEquals(b.rows[0].id, uuid)
})

Deno.test('query Result metadata and lazy rows', async () => {
	await using db = await Client.connect()
	await using r = await db.query<{ n: number }>(
		'SELECT 1::int4 AS n UNION ALL SELECT 2::int4',
	)
	assertEquals(r.command, 'SELECT')
	assertEquals(r.rowCount, 2)
	assertEquals(r.affectedRows, 0)
	assertEquals(r.fields[0]?.name, 'n')
	assertEquals(r.fields[0]?.dataTypeID, 23)
	assertEquals(r.rows.length, 2)
	assertEquals(r.rows[0].n, 1)
	assertEquals(r.rows[0], r.rows[0])
	assertEquals(r.rows.at(1)?.n, 2)
	assertEquals(r.rows.at(-1)?.n, 2)
	assertEquals(r.rows.at(99), undefined)

	const copied = Array.from(r.rows)
	assertEquals(copied.map((row) => row.n), [1, 2])
	assertEquals('map' in r.rows, false)

	const seen: number[] = []
	for (const row of r.rows) {
		seen.push(row.n)
	}
	assertEquals(seen, [1, 2])
})

Deno.test('query INSERT reports affectedRows', async () => {
	await using db = await Client.connect()
	await using results = await db.exec(`
		CREATE TEMP TABLE client_aff (id int);
		INSERT INTO pg_temp.client_aff VALUES (1), (2);
	`)
	assertEquals(results[1].command, 'INSERT')
	assertEquals(results[1].affectedRows, 2)
})

Deno.test('exec returns a disposable array-like batch', async () => {
	await using db = await Client.connect()
	await using results = await db.exec(
		'SELECT 1::int4 AS n; SELECT 2::int4 AS n; SELECT 3::int4 AS n',
	)
	assertEquals(results.length, 3)
	assertEquals(results[0].rows[0].n, 1)
	assertEquals(results.at(1)?.rows[0].n, 2)
	assertEquals(results.at(-1)?.rows[0].n, 3)

	const commands: string[] = []
	for (const item of results) {
		commands.push(item.command)
	}
	assertEquals(commands, ['SELECT', 'SELECT', 'SELECT'])
	assertEquals(Array.from(results).length, 3)
})

Deno.test('exec with one statement still returns a batch', async () => {
	await using db = await Client.connect()
	await using results = await db.exec('SELECT 1::int4 AS n')
	assertEquals(results.length, 1)
	assertEquals(results[0].rows[0].n, 1)
})

Deno.test('exec await using disposes inner results', async () => {
	await using db = await Client.connect()
	let first: Result | undefined
	{
		await using results = await db.exec('SELECT 1::int4 AS n')
		first = results[0]
		assertEquals(first.rows[0].n, 1)
	}
	assertThrows(() => first!.rows[0], Error, 'disposed')
})

Deno.test('prepare unnamed execute and overwrite', async () => {
	await using db = await Client.connect()
	await using first = await db.prepare('SELECT 1::int4 AS n')
	assertEquals(first.name, '')
	assertEquals(first.sql, 'SELECT 1::int4 AS n')
	await using a = await first.execute()
	assertEquals(a.rows[0].n, 1)

	await using second = await db.prepare('SELECT 2::int4 AS n')
	await using b = await first.execute()
	assertEquals(b.rows[0].n, 2)
	await using c = await second.execute()
	assertEquals(c.rows[0].n, 2)
})

Deno.test('prepare named execute reuse and DEALLOCATE', async () => {
	await using db = await Client.connect()
	const name = `client_stmt_${crypto.randomUUID().replaceAll('-', '')}`
	const stmt = await db.prepare('SELECT $1::int4 AS n', name)
	assertEquals(stmt.name, name)
	await using r1 = await stmt.execute([1])
	await using r2 = await stmt.execute([2])
	assertEquals(r1.rows[0].n, 1)
	assertEquals(r2.rows[0].n, 2)
	await stmt.close()
	await assertRejects(() => stmt.execute([3]), Error, 'closed')

	await using check = await db.query<{ n: number }>(
		'SELECT count(*)::int4 AS n FROM pg_prepared_statements WHERE name = $1',
		[name],
	)
	assertEquals(check.rows[0].n, 0)
})

Deno.test('unnamed dispose does not DEALLOCATE ALL', async () => {
	await using db = await Client.connect()
	const name = `client_keep_${crypto.randomUUID().replaceAll('-', '')}`
	await using named = await db.prepare('SELECT 9::int4 AS n', name)
	{
		await using unnamed = await db.prepare('SELECT 1::int4 AS n')
		await using r = await unnamed.execute()
		assertEquals(r.rows[0].n, 1)
	}
	await using still = await named.execute()
	assertEquals(still.rows[0].n, 9)
})

Deno.test('PostgresError has sqlstate and no result property', async () => {
	await using db = await Client.connect()
	const error = await assertRejects(
		() => db.query('SELECT * FROM missing_client_table_xyz'),
		PostgresError,
	)
	assertInstanceOf(error, PostgresError)
	assertEquals(error.sqlstate, '42P01')
	assertNotEquals(error.message, '')
	assertNotEquals(error.severity, '')
	assertEquals('result' in error, false)
})

Deno.test('PostgresError unique violation includes constraint when present', async () => {
	await using db = await Client.connect()
	await using _setup = await db.exec(`
		CREATE TEMP TABLE client_uniq (id int PRIMARY KEY);
		INSERT INTO pg_temp.client_uniq VALUES (1);
	`)
	const error = await assertRejects(
		() => db.query('INSERT INTO pg_temp.client_uniq VALUES ($1)', [1]),
		PostgresError,
	)
	assertEquals(error.sqlstate, '23505')
	assert(error.constraint === undefined || error.constraint.length > 0)
})

Deno.test('root barrel exports Client, PoolClient, Statement, and PostgresError', async () => {
	const root = await import('../mod.ts')
	assertEquals(root.Client, Client)
	assertEquals(root.PoolClient, PoolClient)
	assertEquals(root.Statement, Statement)
	assertEquals(root.Pool, Pool)
	assertEquals(root.Notifier, Notifier)
	assertEquals(root.PostgresError, PostgresError)
	assertEquals(root.json, json)
	assertEquals(root.array, array)
})

Deno.test('libpq barrel exports named raw functions and enums', async () => {
	const raw = await import('../libpq.ts')
	const { ffi } = await import('../native/load.ts')
	assertEquals(raw.PQconnectdb, ffi.PQconnectdb)
	assertEquals('libpq' in raw, false)
	assertEquals(typeof raw.PQconnectdb, 'function')
	assertEquals(typeof raw.PQexec, 'function')
	assertEquals(typeof raw.PQclear, 'function')
	assertEquals(typeof raw.PQsocketPollAsync, 'function')
	assertEquals(raw.ConnStatusType.CONNECTION_OK, 0)
	assertEquals('connectdb' in raw, false)
	assertEquals('exec' in raw, false)
	assertEquals('clear' in raw, false)
	assertEquals('ffi' in raw, false)
})

Deno.test('Client captures independent date conversion options without changing Temporal parameters', async () => {
	for (let mask = 0; mask < 8; mask++) {
		const flags = [Boolean(mask & 1), Boolean(mask & 2), Boolean(mask & 4)]
		const options = {
			temporalDate: flags[0],
			temporalTimestamp: flags[1],
			temporalTimestamptz: flags[2],
		}
		await using db = await Client.connect(undefined, options)
		options.temporalDate = !options.temporalDate
		options.temporalTimestamp = !options.temporalTimestamp
		options.temporalTimestamptz = !options.temporalTimestamptz
		await using result = await db.query(
			`SELECT $1::date AS d, $2::timestamp AS ts, $3::timestamptz AS at,
			$1::date::text AS d_text, $2::timestamp::text AS ts_text,
			$3::timestamptz::text AS at_text,
			ARRAY[$1::date, NULL] AS dates,
			ARRAY[$2::timestamp, NULL] AS timestamps,
			ARRAY[$3::timestamptz, NULL] AS instants`,
			[
				Temporal.PlainDate.from('2026-09-19'),
				Temporal.PlainDateTime.from('2026-09-19T12:00:00'),
				Temporal.Instant.from('2026-09-19T12:00:00Z'),
			],
		)
		const row = result.rows[0]
		for (
			const [index, scalar, array, type] of [
				[0, 'd', 'dates', Temporal.PlainDate],
				[1, 'ts', 'timestamps', Temporal.PlainDateTime],
				[2, 'at', 'instants', Temporal.Instant],
			] as const
		) {
			const values = row[array] as unknown[]
			if (flags[index]) {
				assertInstanceOf(row[scalar], type)
				assertInstanceOf(values[0], type)
			} else {
				assertEquals(row[scalar], row[`${scalar}_text`])
				assertEquals(values[0], row[`${scalar}_text`])
			}
			assertEquals(values[1], null)
		}
	}
})

Deno.test('Client JSON and array options preserve text independently without changing parameters', async () => {
	for (const parseJson of [false, true]) {
		for (const parseArrays of [false, true]) {
			const options = { parseJson, parseArrays }
			await using db = await Client.connect(undefined, options)
			options.parseJson = !parseJson
			options.parseArrays = !parseArrays
			await using result = await db.query(
				`SELECT
				'9007199254740993'::json AS j, '9007199254740993'::jsonb AS jb,
				'null'::json AS j_null, NULL::json AS sql_null,
				ARRAY['null'::json, NULL] AS jsons,
				ARRAY['null'::jsonb, NULL] AS jsonbs,
				'[5:6]={1,2}'::int4[] AS shifted,
				$1::jsonb AS json_param, $1::jsonb::text AS json_param_text,
				$2::int4[] AS array_param`,
				[json({ n: 7 }), array([1, 2])],
			)
			const row = result.rows[0]
			assertEquals(row.j, parseJson ? 9007199254740992 : '9007199254740993')
			assertEquals(row.jb, row.j)
			assertEquals(row.j_null, parseJson ? null : 'null')
			assertEquals(row.sql_null, null)
			assertEquals(
				row.jsons,
				parseArrays ? [parseJson ? null : 'null', null] : '{"null",NULL}',
			)
			assertEquals(row.jsonbs, row.jsons)
			assertEquals(row.shifted, parseArrays ? [1, 2] : '[5:6]={1,2}')
			assertEquals(
				row.json_param,
				parseJson ? { n: 7 } : row.json_param_text,
			)
			assertEquals(row.array_param, parseArrays ? [1, 2] : '{1,2}')
		}
	}
})

Deno.test('Client float4 scalars and arrays match PostgreSQL float8 promotion', async () => {
	await using db = await Client.connect({
		...conninfoParamsFromUrl(new URL(getPGURL())),
		options: '-c extra_float_digits=0',
	})
	await using settings = await db.query<{ digits: number }>(
		"SELECT current_setting('extra_float_digits')::int4 AS digits",
	)
	assertEquals(settings.rows[0].digits, 3)
	await using result = await db.query<{
		value: number
		promoted: number
		values: (number | null)[]
		text: string
	}>(
		`SELECT value AS value, value::float8 AS promoted,
		ARRAY[value, NULL] AS values, value::text AS text
		FROM (SELECT input::float4 AS value
			FROM unnest($1::text[]) AS samples(input)) AS floats`,
		[
			array([
				'0.1',
				'-0.1',
				'0',
				'-0',
				'1.401298464324817e-45',
				'1.1754943508222875e-38',
				'3.4028234663852886e38',
				'NaN',
				'Infinity',
				'-Infinity',
			]),
		],
	)
	assertEquals(result.rows.length, 10)
	for (const row of result.rows) {
		assert(Object.is(row.value, row.promoted), row.text)
		assert(Object.is(row.values[0], row.promoted), row.text)
		assertEquals(row.values[1], null)
	}
})
