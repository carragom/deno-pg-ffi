import { assertEquals, assertExists, assertRejects } from '@std/assert'

import { PGURL } from '../constants.ts'
import { ConnStatusType, ExecStatusType } from '../libpq.ts'
import {
	clear,
	finish,
	fname,
	getvalue,
	isnonblocking,
	nfields,
	ntuples,
	resultStatus,
	status,
} from './wrappers.ts'
import {
	connect,
	exec,
	execParams,
	execPrepared,
	prepare,
	reset,
} from './thread.ts'
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

Deno.test('thread connect with Object', async () => {
	const connObj = conninfoParamsFromUrl(new URL(getPGURL()))
	const conn = await connect(connObj)
	try {
		assertExists(conn)
		assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
		assertEquals(isnonblocking(conn), 0)
	} finally {
		finish(conn)
	}
})

Deno.test('thread connect with URL object', async () => {
	const conn = await connect(new URL(getPGURL()))
	try {
		assertExists(conn)
		assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
		assertEquals(isnonblocking(conn), 0)
	} finally {
		finish(conn)
	}
})

Deno.test('thread connect with URL string', async () => {
	const conn = await connect(getPGURL())
	try {
		assertExists(conn)
		assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
		assertEquals(isnonblocking(conn), 0)
	} finally {
		finish(conn)
	}
})

Deno.test('thread connect with invalid connection', async () => {
	await assertRejects(async () => {
		await connect(TIMEOUT_CONNINFO)
	})
})

Deno.test(
	'thread connect with no parameters falls back to PGURL',
	async () => {
		const conn = await connect()
		try {
			assertExists(conn)
			assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
		} finally {
			finish(conn)
		}
	},
)

Deno.test(
	'thread connect with no parameters uses PG* environment variables when PGURL is not set',
	async () => {
		const pq = await import('./thread.ts')
		const conninfo = conninfoParamsFromUrl(new URL(getPGURL()))

		const previous = {
			PGURL: Deno.env.get(PGURL),
			PGHOST: Deno.env.get('PGHOST'),
			PGPORT: Deno.env.get('PGPORT'),
			PGUSER: Deno.env.get('PGUSER'),
			PGPASSWORD: Deno.env.get('PGPASSWORD'),
			PGDATABASE: Deno.env.get('PGDATABASE'),
		}

		try {
			Deno.env.delete(PGURL)
			setOptionalEnv('PGHOST', conninfo.host)
			setOptionalEnv('PGPORT', conninfo.port)
			setOptionalEnv('PGDATABASE', conninfo.dbname)
			setOptionalEnv('PGUSER', conninfo.user)
			setOptionalEnv('PGPASSWORD', conninfo.password)

			const conn = await pq.connect()
			try {
				assertExists(conn)
				assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
			} finally {
				finish(conn)
			}
		} finally {
			if (previous.PGURL === undefined) {
				Deno.env.delete(PGURL)
			} else {
				Deno.env.set(PGURL, previous.PGURL)
			}

			for (const key of PG_ENV_KEYS) {
				const value = previous[key]
				if (value === undefined) {
					Deno.env.delete(key)
				} else {
					Deno.env.set(key, value)
				}
			}
		}
	},
)

Deno.test('thread connect concurrent connections', async () => {
	const connString = getPGURL()

	const connections = await Promise.all([
		connect(connString),
		connect(connString),
		connect(connString),
	])

	try {
		for (const conn of connections) {
			assertExists(conn)
			assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
		}
	} finally {
		for (const conn of connections) {
			finish(conn)
		}
	}
})

Deno.test('thread connect promise rejection on failure', async () => {
	await assertRejects(
		async () => await connect('invalid-connection-string'),
		Error,
	)
})

Deno.test('thread exec SELECT 1', async () => {
	const conn = await connect(getPGURL())
	try {
		const result = await exec(conn, 'SELECT 1 as test_column')
		assertEquals(resultStatus(result), ExecStatusType.PGRES_TUPLES_OK)
		assertEquals(ntuples(result), 1)
		assertEquals(nfields(result), 1)
		assertEquals(fname(result, 0), 'test_column')
		assertEquals(getvalue(result, 0, 0), '1')
		clear(result)

		const errorResult = await exec(
			conn,
			'SELECT * FROM nonexistent_table',
		)
		assertEquals(
			resultStatus(errorResult),
			ExecStatusType.PGRES_FATAL_ERROR,
		)
		clear(errorResult)
	} finally {
		finish(conn)
	}
})

Deno.test('thread exec keeps last result of multiple commands', async () => {
	const conn = await connect(getPGURL())
	try {
		const result = await exec(conn, 'SELECT 1 as a; SELECT 2 as b')
		assertEquals(resultStatus(result), ExecStatusType.PGRES_TUPLES_OK)
		assertEquals(getvalue(result, 0, 0), '2')
		clear(result)
	} finally {
		finish(conn)
	}
})

Deno.test('thread execParams', async () => {
	const conn = await connect(getPGURL())
	try {
		const result = await execParams(
			conn,
			'SELECT $1::integer as param_value, $2::text as param_text',
			['42', 'hello'],
		)
		assertEquals(resultStatus(result), ExecStatusType.PGRES_TUPLES_OK)
		assertEquals(ntuples(result), 1)
		assertEquals(nfields(result), 2)
		assertEquals(getvalue(result, 0, 0), '42')
		assertEquals(getvalue(result, 0, 1), 'hello')
		clear(result)

		const result2 = await execParams(conn, 'SELECT 1 as no_params')
		assertEquals(resultStatus(result2), ExecStatusType.PGRES_TUPLES_OK)
		assertEquals(ntuples(result2), 1)
		assertEquals(getvalue(result2, 0, 0), '1')
		clear(result2)

		const errorResult = await execParams(conn, 'SELECT $1::badtype', [
			'invalid',
		])
		assertEquals(
			resultStatus(errorResult),
			ExecStatusType.PGRES_FATAL_ERROR,
		)
		clear(errorResult)
	} finally {
		finish(conn)
	}
})

Deno.test('thread prepare and execPrepared', async () => {
	const conn = await connect(getPGURL())
	try {
		const prepareResult = await prepare(
			conn,
			'SELECT $1::integer as prepared_value',
			'test_stmt',
		)
		assertEquals(
			resultStatus(prepareResult),
			ExecStatusType.PGRES_COMMAND_OK,
		)
		clear(prepareResult)

		const execResult = await execPrepared(conn, ['123'], 'test_stmt')
		assertEquals(resultStatus(execResult), ExecStatusType.PGRES_TUPLES_OK)
		assertEquals(ntuples(execResult), 1)
		assertEquals(getvalue(execResult, 0, 0), '123')
		clear(execResult)

		const unnamedPrepare = await prepare(
			conn,
			'SELECT $1::text as unnamed_value',
		)
		assertEquals(
			resultStatus(unnamedPrepare),
			ExecStatusType.PGRES_COMMAND_OK,
		)
		clear(unnamedPrepare)

		const unnamedExec = await execPrepared(conn, ['test'])
		assertEquals(resultStatus(unnamedExec), ExecStatusType.PGRES_TUPLES_OK)
		assertEquals(getvalue(unnamedExec, 0, 0), 'test')
		clear(unnamedExec)

		const badPrepare = await prepare(conn, 'SELECT * FROM bad_table')
		assertEquals(
			resultStatus(badPrepare),
			ExecStatusType.PGRES_FATAL_ERROR,
		)

		const badExec = await execPrepared(conn)
		assertEquals(resultStatus(badExec), ExecStatusType.PGRES_FATAL_ERROR)
		clear(badExec)
		clear(badPrepare)
	} finally {
		finish(conn)
	}
})

Deno.test('thread reset', async () => {
	const conn = await connect(getPGURL())
	try {
		await reset(conn)
		assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
		assertEquals(isnonblocking(conn), 0)
		const result = await exec(conn, 'SELECT 1')
		assertEquals(getvalue(result, 0, 0), '1')
		clear(result)
	} finally {
		finish(conn)
	}
})
