import {
	assert,
	assertEquals,
	assertInstanceOf,
	assertRejects,
} from '@std/assert'
import { deadline } from '@std/async'
import { Pool, PoolClient } from './pool.ts'
import { Client } from './client.ts'
import { PostgresError } from './error.ts'
import { PGURL } from '../constants.ts'
import { conninfoParamsFromUrl } from '../conninfo.ts'

const PG_ENV_KEYS = [
	'PGHOST',
	'PGPORT',
	'PGUSER',
	'PGPASSWORD',
	'PGDATABASE',
] as const
const DEFAULT_PGURL = 'postgresql://localhost'
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

Deno.test('Pool forwards array delimiters to its shared registry', async () => {
	await using pool = await Pool.create()
	pool.registerScalar(603, (text) => `box:${text}`)
	pool.registerArray(1020, 603, ';')
	await using r = await pool.query<{ boxes: string[] }>(
		'SELECT ARRAY[box(point(1,2),point(3,4))] AS boxes',
	)
	assertEquals(r.rows[0].boxes, ['box:(3,4),(1,2)'])
	await using db = await pool.acquire()
	await using checkedOut = await db.query<{ boxes: string[] }>(
		'SELECT ARRAY[box(point(5,6),point(7,8))] AS boxes',
	)
	assertEquals(checkedOut.rows[0].boxes, ['box:(7,8),(5,6)'])
})

Deno.test('Pool type registration is visible to pool.query', async () => {
	const uuid = 'a4a70900-a4a7-4a4a-a4a7-a4a70900a4a7'
	await using pool = await Pool.create()
	pool.registerScalar(2950, (text) => text.toUpperCase())
	await using r = await pool.query<{ id: string }>(
		`SELECT $1::uuid AS id`,
		[uuid],
	)
	assertEquals(r.rows[0].id, uuid.toUpperCase())
})

Deno.test('Pool.create accepts omitted, string, URL, and record', async () => {
	const previous = isolateFromLibpqEnv()
	try {
		const pgurl = getPGURL()
		const params = conninfoParamsFromUrl(new URL(pgurl))

		await using omitted = await Pool.create()
		await using fromString = await Pool.create(pgurl)
		await using fromUrl = await Pool.create(new URL(pgurl))
		await using fromRecord = await Pool.create(params)

		await using a = await omitted.query<{ n: number }>('SELECT 1::int4 AS n')
		await using b = await fromString.query<{ n: number }>(
			'SELECT 1::int4 AS n',
		)
		await using c = await fromUrl.query<{ n: number }>('SELECT 1::int4 AS n')
		await using d = await fromRecord.query<{ n: number }>(
			'SELECT 1::int4 AS n',
		)
		assertEquals(a.rows[0].n, 1)
		assertEquals(b.rows[0].n, 1)
		assertEquals(c.rows[0].n, 1)
		assertEquals(d.rows[0].n, 1)
	} finally {
		restoreLibpqEnv(previous)
	}
})

Deno.test('Pool.query and exec match client result shape', async () => {
	await using pool = await Pool.create()
	await using r = await pool.query<{ name: string }>(
		'SELECT $1::text AS name',
		['Ada'],
	)
	assertEquals(r.command, 'SELECT')
	assertEquals(r.rowCount, 1)
	assertEquals(r.affectedRows, 0)
	assertEquals(r.fields[0]?.name, 'name')
	assertEquals(r.rows[0].name, 'Ada')

	await using results = await pool.exec(
		'SELECT 1::int4 AS n; SELECT 2::int4 AS n',
	)
	assertEquals(results.length, 2)
	assertEquals(results[0].rows[0].n, 1)
	assertEquals(results[1].rows[0].n, 2)
	assertEquals(results.at(-1)?.command, 'SELECT')
})

Deno.test('Pool.query Promise.all succeeds at max 2', async () => {
	await using pool = await Pool.create(undefined, { max: 2 })
	const [left, right] = await Promise.all([
		pool.query<{ n: number }>('SELECT 1::int4 AS n'),
		pool.query<{ n: number }>('SELECT 2::int4 AS n'),
	])
	await using a = left
	await using b = right
	assertEquals(a.rows[0].n, 1)
	assertEquals(b.rows[0].n, 2)
})

Deno.test('Pool.query result stays readable after a second query', async () => {
	await using pool = await Pool.create(undefined, { max: 1 })
	await using first = await pool.query<{ n: number }>('SELECT 1::int4 AS n')
	await using second = await pool.query<{ n: number }>('SELECT 2::int4 AS n')
	assertEquals(first.rows[0].n, 1)
	assertEquals(second.rows[0].n, 2)
})

Deno.test('Pool query and exec reuse the same backend', async () => {
	await using pool = await Pool.create(undefined, { max: 1 })
	await using first = await pool.query<{ pid: number }>(
		'SELECT pg_backend_pid()::int4 AS pid',
	)
	await using second = await pool.query<{ pid: number }>(
		'SELECT pg_backend_pid()::int4 AS pid',
	)
	await using third = await pool.exec('SELECT pg_backend_pid()::int4 AS pid')
	await using fourth = await pool.exec('SELECT pg_backend_pid()::int4 AS pid')
	assertEquals(second.rows[0].pid, first.rows[0].pid)
	assertEquals(third[0].rows[0].pid, first.rows[0].pid)
	assertEquals(fourth[0].rows[0].pid, first.rows[0].pid)
})

Deno.test('Pool.acquire checkout prepare and execute', async () => {
	await using pool = await Pool.create()
	await using db = await pool.acquire()
	const name = `pool_stmt_${crypto.randomUUID().replaceAll('-', '')}`
	await using stmt = await db.prepare('SELECT $1::int4 AS n', name)
	await using r = await stmt.execute([3])
	assertEquals(r.rows[0].n, 3)
})

Deno.test('Pool max 1 sequential query and queued checkout', async () => {
	await using pool = await Pool.create(undefined, { max: 1 })
	await using first = await pool.query<{ n: number }>('SELECT 1::int4 AS n')
	await using second = await pool.query<{ n: number }>('SELECT 2::int4 AS n')
	assertEquals(first.rows[0].n, 1)
	assertEquals(second.rows[0].n, 2)

	const holding = Promise.withResolvers<void>()
	const canRelease = Promise.withResolvers<void>()
	const firstCheckout = (async () => {
		await using _db = await pool.acquire()
		holding.resolve()
		await canRelease.promise
	})()
	await holding.promise

	let secondReady = false
	const secondCheckout = (async () => {
		await using db = await pool.acquire()
		secondReady = true
		await using r = await db.query<{ n: number }>('SELECT 3::int4 AS n')
		assertEquals(r.rows[0].n, 3)
	})()

	await Promise.resolve()
	await Promise.resolve()
	assertEquals(secondReady, false)

	canRelease.resolve()
	await firstCheckout
	await secondCheckout
	assertEquals(secondReady, true)
})

Deno.test('Pool.create rejects invalid max', async (t) => {
	for (const max of [NaN, Infinity, -Infinity, 0, -0, -1, 0.5, 1.5]) {
		const name = Object.is(max, -0) ? '-0' : String(max)
		await t.step(name, async () => {
			await assertRejects(
				() => Pool.create(undefined, { max }),
				Error,
				'Pool max must be a positive finite integer',
			)
		})
	}
})

Deno.test('Pool.create accepts positive integer max without connecting', async (t) => {
	for (const max of [1, 2, 10]) {
		await t.step(String(max), async () => {
			await using pool = await Pool.create('invalid connection string', {
				max,
			})
			assert(pool instanceof Pool)
		})
	}
})

Deno.test('Pool defaults to max 10 when max is omitted', async (t) => {
	const cases = [
		['omitted options', undefined],
		['empty options', {}],
		['undefined max', { max: undefined }],
	] as const
	for (const [name, options] of cases) {
		await t.step(name, async () => {
			const pool = await Pool.create(undefined, options)
			const acquisitions: Promise<PoolClient>[] = []
			try {
				for (let i = 0; i < 10; i++) {
					acquisitions.push(pool.acquire())
				}
				const clients = await deadline(Promise.all(acquisitions), 5_000)
				await using first = await clients[0].query<{ pid: number }>(
					'SELECT pg_backend_pid()::int4 AS pid',
				)
				const waiting = pool.acquire()
				acquisitions.push(waiting)
				const error = await assertRejects(
					() => deadline(waiting, 20),
					DOMException,
				)
				assertEquals(error.name, 'TimeoutError')

				await clients[0].close()
				const next = await deadline(waiting, 5_000)
				await using reused = await next.query<{ pid: number }>(
					'SELECT pg_backend_pid()::int4 AS pid',
				)
				assertEquals(reused.rows[0].pid, first.rows[0].pid)
			} finally {
				const closing = pool.close()
				try {
					await Promise.all(acquisitions.map(async (acquisition) => {
						const client = await acquisition.catch(() => undefined)
						await client?.close()
					}))
				} finally {
					await closing
				}
			}
		})
	}
})

Deno.test('Pool rejects query exec and acquire after close', async () => {
	const pool = await Pool.create()
	await pool.close()
	await assertRejects(() => pool.query('SELECT 1'), Error, 'closed')
	await assertRejects(() => pool.exec('SELECT 1'), Error, 'closed')
	await assertRejects(() => pool.acquire(), Error, 'closed')
	await pool.close()
})

Deno.test('Pool.query SQL error still returns the client', async () => {
	await using pool = await Pool.create(undefined, { max: 1 })
	await assertRejects(
		() => pool.query('SELECT * FROM missing_pool_table_xyz'),
		PostgresError,
	)
	await using r = await pool.query<{ n: number }>('SELECT 1::int4 AS n')
	assertEquals(r.rows[0].n, 1)
})

Deno.test('Pool.acquire returns PoolClient', async () => {
	await using pool = await Pool.create()
	await using db = await pool.acquire()
	assertInstanceOf(db, PoolClient)
})

Deno.test('Pool checkout prepare is discarded on release', async () => {
	await using pool = await Pool.create(undefined, { max: 1 })
	const name = `pool_discard_${crypto.randomUUID().replaceAll('-', '')}`
	await using db = await pool.acquire()
	await using pid = await db.query<{ pid: number }>(
		'SELECT pg_backend_pid()::int4 AS pid',
	)
	await using stmt = await db.prepare('SELECT $1::int4 AS n', name)
	await db.close()
	await assertRejects(() => stmt.execute([1]), Error, 'closed')

	await using next = await pool.acquire()
	await using r = await next.query<{ n: number; pid: number }>(
		`SELECT count(*)::int4 AS n, pg_backend_pid()::int4 AS pid FROM pg_prepared_statements WHERE name = $1`,
		[name],
	)
	assertEquals(r.rows[0].n, 0)
	assertEquals(r.rows[0].pid, pid.rows[0].pid)
})

Deno.test('Pool checkout transactions are rolled back on the same backend', async (t) => {
	for (const failed of [false, true]) {
		await t.step(
			failed ? 'aborted transaction' : 'open transaction',
			async () => {
				await using pool = await Pool.create(undefined, { max: 1 })
				await using before = await pool.query<{ pid: number }>(
					'SELECT pg_backend_pid()::int4 AS pid',
				)
				{
					await using db = await pool.acquire()
					await using _begin = await db.exec('BEGIN')
					await using _temp = await db.exec(
						'CREATE TEMP TABLE pool_txn_probe (id int)',
					)
					if (failed) {
						await assertRejects(
							() => db.query('SELECT 1 / 0'),
							PostgresError,
						)
					}
				}
				await using next = await pool.acquire()
				await using after = await next.query<
					{ pid: number; missing: boolean }
				>(
					"SELECT pg_backend_pid()::int4 AS pid, to_regclass('pg_temp.pool_txn_probe') IS NULL AS missing",
				)
				assertEquals(after.rows[0].pid, before.rows[0].pid)
				assertEquals(after.rows[0].missing, true)
			},
		)
	}
})

Deno.test('Pool checkout resets session settings and restores DateStyle', async () => {
	await using pool = await Pool.create(undefined, { max: 1 })
	await using before = await pool.query<{ pid: number; app: string }>(
		"SELECT pg_backend_pid()::int4 AS pid, current_setting('application_name') AS app",
	)
	{
		await using db = await pool.acquire()
		await using _settings = await db.exec(
			"SET application_name = 'pool_reset_probe'; SET DateStyle = 'SQL, DMY'",
		)
	}
	await using after = await pool.query<
		{ pid: number; app: string; style: string }
	>(
		"SELECT pg_backend_pid()::int4 AS pid, current_setting('application_name') AS app, current_setting('DateStyle') AS style",
	)
	assertEquals(after.rows[0].pid, before.rows[0].pid)
	assertEquals(after.rows[0].app, before.rows[0].app)
	assertEquals(after.rows[0].style, 'ISO, YMD')
})

Deno.test('Pool Temporal options apply to simultaneous connections and survive reset', async () => {
	const options = { max: 2, temporalTime: true, temporalInterval: true }
	await using pool = await Pool.create({
		...conninfoParamsFromUrl(new URL(getPGURL())),
		options: '-c intervalstyle=postgres_verbose',
	}, options)
	options.temporalTime = false
	options.temporalInterval = false
	{
		await using first = await pool.acquire()
		await using second = await pool.acquire()
		for (const db of [first, second]) {
			await using result = await db.query<
				{ t: Temporal.PlainTime; i: Temporal.Duration }
			>(
				"SELECT time '01:02:03' AS t, interval '-1 day' AS i",
			)
			assertEquals(result.rows[0].t.toString(), '01:02:03')
			assertEquals(result.rows[0].i.toString(), '-P1D')
		}
		await using _settings = await first.exec(
			"SET DateStyle = 'SQL, DMY'; SET IntervalStyle = postgres; BEGIN",
		)
	}
	for (let i = 0; i < 2; i++) {
		await using result = await pool.query<
			{ style: string; date_style: string; intervals: Temporal.Duration[] }
		>(
			`SELECT current_setting('IntervalStyle') AS style,
			current_setting('DateStyle') AS date_style,
			ARRAY[interval '1 month'] AS intervals`,
		)
		assertEquals(result.rows[0].style, 'iso_8601')
		assertEquals(result.rows[0].date_style, 'ISO, YMD')
		assertEquals(result.rows[0].intervals[0].toString(), 'P1M')
	}
	pool.registerScalar(1186, (text) => text)
	await using overridden = await pool.query<{ intervals: string[] }>(
		"SELECT ARRAY[interval '1 month -1 day'] AS intervals",
	)
	assertEquals(overridden.rows[0].intervals, ['P1M-1D'])
})

Deno.test('Pool date conversion opt-outs survive simultaneous checkouts and reset', async () => {
	const options = {
		max: 2,
		temporalDate: false,
		temporalTimestamp: false,
		temporalTimestamptz: false,
	}
	await using pool = await Pool.create(undefined, options)
	options.temporalDate = true
	options.temporalTimestamp = true
	options.temporalTimestamptz = true
	const sql = `SELECT date '0001-01-01 BC' AS d,
		timestamp '10000-01-01 00:00:00' AS ts,
		timestamptz '-infinity' AS at,
		ARRAY[date 'infinity', NULL] AS dates,
		ARRAY[timestamp 'infinity', NULL] AS timestamps,
		ARRAY[timestamptz 'infinity', NULL] AS instants`
	const expected = {
		d: '0001-01-01 BC',
		ts: '10000-01-01 00:00:00',
		at: '-infinity',
		dates: ['infinity', null],
		timestamps: ['infinity', null],
		instants: ['infinity', null],
	}
	{
		await using first = await pool.acquire()
		await using second = await pool.acquire()
		for (const db of [first, second]) {
			await using result = await db.query(sql)
			assertEquals(result.rows[0], expected)
			await using _settings = await db.exec(
				"SET DateStyle = 'SQL, DMY'; BEGIN",
			)
		}
	}
	for (let i = 0; i < 2; i++) {
		await using result = await pool.query(sql)
		assertEquals(result.rows[0], expected)
	}
	pool.registerScalar(1082, (value) => `date:${value}`)
	await using overridden = await pool.query(
		"SELECT ARRAY[date 'infinity'] AS dates",
	)
	assertEquals(overridden.rows[0].dates, ['date:infinity'])
})

Deno.test('Pool JSON and array opt-outs survive reset and honor shared explicit overrides', async () => {
	const options = { max: 2, parseJson: false, parseArrays: false }
	await using pool = await Pool.create(undefined, options)
	options.parseJson = true
	options.parseArrays = true
	const sql = `SELECT '9007199254740993'::json AS j,
		'9007199254740993'::jsonb AS jb, '[5:6]={1,2}'::int4[] AS a,
		NULL::json AS missing`
	const expected = {
		j: '9007199254740993',
		jb: '9007199254740993',
		a: '[5:6]={1,2}',
		missing: null,
	}
	{
		await using first = await pool.acquire()
		await using second = await pool.acquire()
		for (const db of [first, second]) {
			await using result = await db.query(sql)
			assertEquals(result.rows[0], expected)
		}
	}
	await using after = await pool.query(sql)
	assertEquals(after.rows[0], expected)
	pool.registerScalar(114, (value) => `json:${value}`)
	pool.registerScalar(23, (value) => `int:${value}`)
	pool.registerArray(1007, 23)
	await using overridden = await pool.query(sql)
	assertEquals(overridden.rows[0], {
		...expected,
		j: 'json:9007199254740993',
		a: ['int:1', 'int:2'],
	})
	await using defaults = await Client.connect()
	await using normal = await defaults.query(sql)
	assertEquals(normal.rows[0].j, 9007199254740992)
	assertEquals(normal.rows[0].a, [1, 2])
})
