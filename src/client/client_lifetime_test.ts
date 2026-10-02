import {
	assertEquals,
	assertNotEquals,
	assertRejects,
	assertThrows,
} from '@std/assert'

import { PGURL } from '../constants.ts'
import { Client, Pool, PostgresError } from '../mod.ts'

let initialPgurl: string | undefined
let previousPgurl: string

Deno.test.beforeAll(() => {
	initialPgurl = Deno.env.get(PGURL)
	if (initialPgurl === undefined || initialPgurl.trim() === '') {
		Deno.env.set(PGURL, 'postgresql://localhost')
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

function uniqueName(prefix: string): string {
	return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`
}

Deno.test('rows accessors throw after Result.close', async () => {
	await using db = await Client.connect()
	const r = await db.query<{ n: number }>('SELECT 1::int4 AS n')
	const rows = r.rows
	r.close()
	assertThrows(() => rows[0], Error, 'disposed')
	assertThrows(() => rows.at(0), Error, 'disposed')
	assertThrows(() => [...rows], Error, 'disposed')
})

Deno.test('extracted batch result throws after Results.close', async () => {
	await using db = await Client.connect()
	const results = await db.exec('SELECT 1::int4 AS n')
	const first = results[0]
	results.close()
	assertThrows(() => first.rows[0], Error, 'disposed')
})

Deno.test('Result.close then Results.close is a no-op', async () => {
	await using db = await Client.connect()
	const results = await db.exec('SELECT 1::int4 AS n')
	results[0].close()
	results.close()
	assertThrows(() => results[0], Error, 'disposed')
})

Deno.test('Result.close is idempotent', async () => {
	await using db = await Client.connect()
	const r = await db.query<{ n: number }>('SELECT 1::int4 AS n')
	r.close()
	r.close()
	assertThrows(() => r.rows[0], Error, 'disposed')
})

Deno.test('materialized row survives Result.close', async () => {
	await using db = await Client.connect()
	const r = await db.query<{ n: number }>('SELECT 1::int4 AS n')
	const row = r.rows[0]
	r.close()
	assertEquals(row.n, 1)
})

Deno.test('close waits for an in-flight exec', async () => {
	const db = await Client.connect()
	const pending = db.exec(
		'SELECT pg_sleep(0.2); SELECT 1::int4 AS n',
	)
	const closing = db.close()
	await using results = await pending
	assertEquals(results.at(-1)?.rows[0].n, 1)
	await closing
	await assertRejects(() => db.query('SELECT 1'), Error, 'closed')
})

Deno.test('close waits for an in-flight prepared execute', async () => {
	const db = await Client.connect()
	const name = uniqueName('lifetime_sleep')
	const stmt = await db.prepare(
		'SELECT 1::int4 AS n, pg_sleep(0.2)',
		name,
	)
	const pending = stmt.execute()
	const closing = db.close()
	await using r = await pending
	assertEquals(r.rows[0].n, 1)
	await closing
	await assertRejects(() => stmt.execute(), Error, 'closed')
	await stmt.close()
})

Deno.test('stmt.close during execute throws and client still closes', async () => {
	await using db = await Client.connect()
	const name = uniqueName('lifetime_stmt_close')
	const stmt = await db.prepare(
		'SELECT 1::int4 AS n, pg_sleep(0.2)',
		name,
	)
	const pending = stmt.execute()
	await assertRejects(() => stmt.close(), Error, 'in progress')
	await using r = await pending
	assertEquals(r.rows[0].n, 1)
})

Deno.test('overlapping close while idle does not crash', async () => {
	const db = await Client.connect()
	await Promise.all([db.close(), db.close()])
	await assertRejects(() => db.query('SELECT 1'), Error, 'closed')
})

Deno.test('overlapping close during pg_sleep does not crash', async () => {
	const db = await Client.connect()
	const pending = db.query<{ n: number }>(
		'SELECT 1::int4 AS n, pg_sleep(0.2)',
	)
	const closing = Promise.all([db.close(), db.close()])
	await using r = await pending
	assertEquals(r.rows[0].n, 1)
	await closing
	await assertRejects(() => db.query('SELECT 1'), Error, 'closed')
})

Deno.test('close then stmt.execute and stmt.close', async () => {
	const db = await Client.connect()
	const name = uniqueName('lifetime_after_close')
	const stmt = await db.prepare('SELECT 1::int4 AS n', name)
	await db.close()
	await assertRejects(() => stmt.execute(), Error, 'closed')
	await stmt.close()
})

Deno.test('failed query then close then a new connect', async () => {
	const db = await Client.connect()
	await assertRejects(
		() => db.query('SELECT * FROM missing_lifetime_xyz'),
		PostgresError,
	)
	await db.close()
	await using db2 = await Client.connect()
	await using r = await db2.query<{ n: number }>('SELECT 1::int4 AS n')
	assertEquals(r.rows[0].n, 1)
})

Deno.test('exec fatal mid-batch clears results and leaves client usable', async () => {
	await using db = await Client.connect()
	await assertRejects(
		() => db.exec('SELECT 1; SELECT 1/0; SELECT 2'),
		PostgresError,
	)
	await using r = await db.query<{ n: number }>('SELECT 1::int4 AS n')
	assertEquals(r.rows[0].n, 1)
})

Deno.test('missing-table query then a successful query on the same client', async () => {
	await using db = await Client.connect()
	await assertRejects(
		() => db.query('SELECT * FROM missing_lifetime_table'),
		PostgresError,
	)
	await using r = await db.query<{ n: number }>('SELECT 1::int4 AS n')
	assertEquals(r.rows[0].n, 1)
})

Deno.test('pg_terminate_backend during sleep then close is safe', async () => {
	await using victim = await Client.connect()
	await using killer = await Client.connect()
	await using pidResult = await victim.query<{ pid: number }>(
		'SELECT pg_backend_pid()::int4 AS pid',
	)
	const pid = pidResult.rows[0].pid
	const pending = victim.query('SELECT pg_sleep(5)')
	// Termination may reject before the killer command resolves. Attach a
	// handler now; assertRejects below still checks the original promise.
	void pending.catch(() => {})
	await using _term = await killer.query(
		'SELECT pg_terminate_backend($1::int4)',
		[pid],
	)
	await assertRejects(() => pending, Error)
	await victim.close()
})

Deno.test('exec empty statements produce extra results that dispose', async () => {
	await using db = await Client.connect()
	await using skipped = await db.exec(
		'SELECT 1::int4 AS n;;SELECT 2::int4 AS n',
	)
	assertEquals(skipped.length, 2)
	assertEquals(skipped[0].rows[0].n, 1)
	assertEquals(skipped[1].rows[0].n, 2)

	// `;;` is skipped by the simple protocol; a 0-row SELECT still yields
	// an extra PGresult that the batch must clear.
	await using results = await db.exec(
		'SELECT 1::int4 AS n; SELECT 1::int4 AS n WHERE false; SELECT 2::int4 AS n',
	)
	assertEquals(results.length, 3)
	assertEquals(results[0].rows[0].n, 1)
	assertEquals(results[1].rows.length, 0)
	assertEquals(results[2].rows[0].n, 2)
})

Deno.test('soak connect query dispose', async () => {
	const text = 'x'.repeat(1000)
	for (let i = 0; i < 200; i++) {
		await using db = await Client.connect()
		await using r = await db.query<{ n: number }>(
			'SELECT generate_series(1, 100)::int4 AS n, $1::text AS s',
			[text],
		)
		assertEquals(r.rows.at(-1)?.n, 100)
	}
})

Deno.test('soak exec five-statement batches', async () => {
	await using db = await Client.connect()
	for (let i = 0; i < 100; i++) {
		await using results = await db.exec(
			'SELECT 1::int4 AS n; SELECT 2::int4 AS n; SELECT 3::int4 AS n; SELECT 4::int4 AS n; SELECT 5::int4 AS n',
		)
		assertEquals(results.length, 5)
		assertEquals(results[4].rows[0].n, 5)
	}
})

Deno.test('soak named prepare execute close leaves no statements', async () => {
	await using db = await Client.connect()
	for (let i = 0; i < 50; i++) {
		const name = uniqueName('lifetime_soak')
		const stmt = await db.prepare('SELECT $1::int4 AS n', name)
		await using r = await stmt.execute([i])
		assertEquals(r.rows[0].n, i)
		await stmt.close()
	}
	await using check = await db.query<{ n: number }>(
		`SELECT count(*)::int4 AS n FROM pg_prepared_statements
			WHERE name LIKE 'lifetime_soak_%'`,
	)
	assertEquals(check.rows[0].n, 0)
})

Deno.test('soak failed query clearAll on one client', async () => {
	await using db = await Client.connect()
	for (let i = 0; i < 50; i++) {
		await assertRejects(
			() => db.query('SELECT * FROM missing_lifetime_soak'),
			PostgresError,
		)
	}
	await using r = await db.query<{ n: number }>('SELECT 1::int4 AS n')
	assertEquals(r.rows[0].n, 1)
})

Deno.test('Pool.close waits for an in-flight query', async () => {
	const pool = await Pool.create(undefined, { max: 1 })
	const pending = pool.query<{ n: number }>(
		'SELECT 1::int4 AS n, pg_sleep(0.2)',
	)
	const closing = pool.close()
	await using r = await pending
	assertEquals(r.rows[0].n, 1)
	await closing
	await assertRejects(() => pool.query('SELECT 1'), Error, 'closed')
})

Deno.test('Pool checkout dispose returns the same connection', async () => {
	await using pool = await Pool.create(undefined, { max: 1 })
	let pid: number
	{
		await using db = await pool.acquire()
		await using r = await db.query<{ pid: number }>(
			'SELECT pg_backend_pid()::int4 AS pid',
		)
		pid = r.rows[0].pid
	}
	await using db = await pool.acquire()
	await using r = await db.query<{ pid: number }>(
		'SELECT pg_backend_pid()::int4 AS pid',
	)
	assertEquals(r.rows[0].pid, pid)
})

Deno.test('Pool release replaces a terminated backend safely', async () => {
	await using pool = await Pool.create(undefined, { max: 1 })
	await using killer = await Client.connect()
	await using db = await pool.acquire()
	await using before = await db.query<{ pid: number }>(
		'SELECT pg_backend_pid()::int4 AS pid',
	)
	await using terminated = await killer.query<{ terminated: boolean }>(
		'SELECT pg_terminate_backend($1::int4) AS terminated',
		[before.rows[0].pid],
	)
	assertEquals(terminated.rows[0].terminated, true)
	await db.close()
	await db.close()
	await using after = await pool.query<{ pid: number }>(
		'SELECT pg_backend_pid()::int4 AS pid',
	)
	assertNotEquals(after.rows[0].pid, before.rows[0].pid)
})

Deno.test('Pool overlapping close does not double-finish', async () => {
	const pool = await Pool.create()
	await using _r = await pool.query<{ n: number }>('SELECT 1::int4 AS n')
	await Promise.all([pool.close(), pool.close()])
	await assertRejects(() => pool.query('SELECT 1'), Error, 'closed')
})

Deno.test('Pool.close during checkout finishes on release', async () => {
	const pool = await Pool.create(undefined, { max: 1 })
	const db = await pool.acquire()
	const closing = pool.close()
	await using r = await db.query<{ n: number }>('SELECT 1::int4 AS n')
	assertEquals(r.rows[0].n, 1)
	await db.close()
	await closing
	await assertRejects(() => pool.acquire(), Error, 'closed')
})

Deno.test('Pool.close waits for successful release reset and finishes client', async () => {
	const originalReset = Client.prototype.resetAfterCheckout
	const originalClose = Client.prototype.close
	const resetEntered = Promise.withResolvers<void>()
	const resumeReset = Promise.withResolvers<void>()
	let finishCount = 0
	Client.prototype.resetAfterCheckout = async function () {
		resetEntered.resolve()
		await resumeReset.promise
		return await originalReset.call(this)
	}
	Client.prototype.close = async function () {
		finishCount++
		return await originalClose.call(this)
	}

	const pool = await Pool.create(undefined, { max: 1 })
	const db = await pool.acquire()
	let released = false
	const release = db.close().then(() => {
		released = true
	})
	try {
		await resetEntered.promise
		const closing = pool.close()
		assertEquals(released, false)
		resumeReset.resolve()
		await release
		await closing
		assertEquals(finishCount, 1)
	} finally {
		resumeReset.resolve()
		await release
		Client.prototype.resetAfterCheckout = originalReset
		Client.prototype.close = originalClose
		await pool.close()
	}
})

Deno.test('Pool.close waits for failed reset disposal', async () => {
	const originalReset = Client.prototype.resetAfterCheckout
	const originalClose = Client.prototype.close
	const resetEntered = Promise.withResolvers<void>()
	const resumeReset = Promise.withResolvers<void>()
	const finishEntered = Promise.withResolvers<void>()
	const resumeFinish = Promise.withResolvers<void>()
	Client.prototype.resetAfterCheckout = async function () {
		resetEntered.resolve()
		await resumeReset.promise
		return false
	}
	Client.prototype.close = async function () {
		finishEntered.resolve()
		await resumeFinish.promise
		return await originalClose.call(this)
	}

	const pool = await Pool.create(undefined, { max: 1 })
	const db = await pool.acquire()
	let released = false
	const release = db.close().then(() => {
		released = true
	})
	try {
		await resetEntered.promise
		const closing = pool.close()
		resumeReset.resolve()
		await finishEntered.promise
		assertEquals(released, false)
		resumeFinish.resolve()
		await release
		await closing
	} finally {
		resumeReset.resolve()
		resumeFinish.resolve()
		await release
		Client.prototype.resetAfterCheckout = originalReset
		Client.prototype.close = originalClose
		await pool.close()
	}
})

Deno.test('wide result exercises per-index getters', async () => {
	await using db = await Client.connect()
	const cols: string[] = []
	for (let i = 0; i < 80; i++) {
		cols.push(`${i + 1}::int4 AS c${i}`)
	}
	await using r = await db.query<Record<string, number>>(
		`SELECT ${cols.join(', ')}`,
	)
	assertEquals(r.rows.length, 1)
	assertEquals(r.rows[0].c0, 1)
	assertEquals(r.rows[0].c79, 80)
	assertEquals(r.fields.length, 80)
})
