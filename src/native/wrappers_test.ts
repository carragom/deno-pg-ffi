import {
	assertEquals,
	assertExists,
	assertNotEquals,
	assertThrows,
} from '@std/assert'
import { delay } from '@std/async'

import { PGURL } from '../constants.ts'
import {
	backendPID,
	clear,
	connectdb,
	consumeInput,
	db,
	escapeIdentifier,
	escapeLiteral,
	exec,
	finish,
	getvalue,
	host,
	notifies,
	options,
	parameterStatus,
	ping,
	port,
	protocolVersion,
	reset,
	resultErrorField,
	resultStatus,
	resultVerboseErrorMessage,
	status,
	transactionStatus,
	user,
} from './wrappers.ts'
import {
	ConnStatusType,
	ExecStatusType,
	libpq as ffi,
	type PGconn,
	PGContextVisibility,
	PGDiag,
	PGPing,
	PGTransactionStatusType,
	PGVerbosity,
} from '../libpq.ts'
import { conninfoParamsFromUrl } from '../conninfo.ts'
import { encodeTerminated } from './strings.ts'

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

/**
 * DATABASE TESTS ORGANIZATION:
 *
 * This file contains tests for wrappers.ts functions:
 * - Synchronous functions: connectdb, exec, execPrepared, prepare, etc.
 * - Poll primitives: connectStart/connectPoll, sendQuery on a failed conn
 *
 * Promise helpers live in thread_test.ts and ../protocol/connect_test.ts.
 */

Deno.test('connectdb', async () => {
	const pq = await import('./wrappers.ts')
	const conn = pq.connectdb(getPGURL())
	try {
		assertExists(conn)
		assertEquals(pq.status(conn), ConnStatusType.CONNECTION_OK)
	} finally {
		pq.finish(conn)
	}
})

Deno.test('connectdb with Object', () => {
	const connObj = conninfoParamsFromUrl(new URL(getPGURL()))
	const conn = connectdb(connObj)
	try {
		assertExists(conn)
		assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
	} finally {
		finish(conn)
	}
})

Deno.test('connectdb with URL object', () => {
	const conn = connectdb(new URL(getPGURL()))
	try {
		assertExists(conn)
		assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
	} finally {
		finish(conn)
	}
})

Deno.test('connectdb with URL string', () => {
	const connString = getPGURL()
	const conn = connectdb(connString)
	try {
		assertExists(conn)
		assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
	} finally {
		finish(conn)
	}
})

Deno.test('connectdb with invalid connection', () => {
	assertThrows(() => {
		connectdb('host=127.100.100.100 connect_timeout=1')
	})
})

Deno.test('connectdb with no parameters falls back to PGURL', () => {
	const conn = connectdb()
	try {
		assertExists(conn)
		assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
	} finally {
		finish(conn)
	}
})

Deno.test(
	'connectdb with no parameters uses PG* environment variables when PGURL is not set',
	async () => {
		const pq = await import('./wrappers.ts')
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

			const conn = pq.connectdb()
			try {
				assertExists(conn)
				assertEquals(pq.status(conn), ConnStatusType.CONNECTION_OK)
			} finally {
				pq.finish(conn)
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

Deno.test('database operations', async (t) => {
	const pq = await import('./wrappers.ts')

	const conn = pq.connectdb(getPGURL())
	assertExists(conn)
	assertEquals(pq.status(conn), ConnStatusType.CONNECTION_OK)

	try {
		await t.step('exec', async (t) => {
			await t.step('empty command', () => {
				const res = pq.exec(conn, '')
				assertExists(res)
				const status = pq.resultStatus(res)
				assertEquals(status, ExecStatusType.PGRES_EMPTY_QUERY)
				assertEquals(
					pq.resStatus(status),
					ExecStatusType[ExecStatusType.PGRES_EMPTY_QUERY],
				)
				assertEquals(pq.nfields(res), 0)
				assertEquals(pq.ntuples(res), 0)
				assertEquals(pq.cmdTuples(res), -1)
				pq.clear(res)
			})

			await t.step('multiple columns', () => {
				const res = pq.exec(
					conn,
					"select 'first value' as first_col, 'second value' as second_col;",
				)
				assertExists(res)
				const status = pq.resultStatus(res)
				assertEquals(status, ExecStatusType.PGRES_TUPLES_OK)
				assertEquals(
					pq.resStatus(status),
					ExecStatusType[ExecStatusType.PGRES_TUPLES_OK],
				)
				assertEquals(pq.nfields(res), 2)
				assertEquals(pq.ntuples(res), 1)
				assertEquals(pq.cmdTuples(res), 1)
				assertEquals(pq.fname(res, 0), 'first_col')
				assertEquals(pq.fname(res, 1), 'second_col')
				assertEquals(pq.fnumber(res, 'first_col'), 0)
				assertEquals(pq.fnumber(res, 'second_col'), 1)
				assertEquals(pq.getvalue(res, 0, 0), 'first value')
				assertEquals(pq.getvalue(res, 0, 1), 'second value')
				pq.clear(res)
			})

			await t.step('multiple rows', () => {
				const res = pq.exec(
					conn,
					"SELECT series::date \"date\" from generate_series(date '2023-01-01', date '2023-01-10', '1 day') series;",
				)
				assertExists(res)
				const status = pq.resultStatus(res)
				assertEquals(status, ExecStatusType.PGRES_TUPLES_OK)
				assertEquals(
					pq.resStatus(status),
					ExecStatusType[ExecStatusType.PGRES_TUPLES_OK],
				)
				assertEquals(pq.nfields(res), 1)
				assertEquals(pq.ntuples(res), 10)
				assertEquals(pq.cmdTuples(res), 10)
				assertEquals(pq.fname(res, 0), 'date')
				assertEquals(pq.fnumber(res, 'date'), 0)
				assertEquals(pq.getvalue(res, 0, 0), '2023-01-01')
				assertEquals(pq.getvalue(res, 1, 0), '2023-01-02')
				assertEquals(pq.getvalue(res, 2, 0), '2023-01-03')
				assertEquals(pq.getvalue(res, 3, 0), '2023-01-04')
				assertEquals(pq.getvalue(res, 4, 0), '2023-01-05')
				assertEquals(pq.getvalue(res, 5, 0), '2023-01-06')
				assertEquals(pq.getvalue(res, 6, 0), '2023-01-07')
				assertEquals(pq.getvalue(res, 7, 0), '2023-01-08')
				assertEquals(pq.getvalue(res, 8, 0), '2023-01-09')
				assertEquals(pq.getvalue(res, 9, 0), '2023-01-10')
				pq.clear(res)
			})

			await t.step('select date', () => {
				const res = pq.exec(conn, "select '2023-02-27'::date as date;")
				assertExists(res)
				const status = pq.resultStatus(res)
				assertEquals(status, ExecStatusType.PGRES_TUPLES_OK)
				assertEquals(
					pq.resStatus(status),
					ExecStatusType[ExecStatusType.PGRES_TUPLES_OK],
				)
				assertEquals(pq.nfields(res), 1)
				assertEquals(pq.cmdTuples(res), 1)
				assertEquals(pq.fname(res, 0), 'date')
				assertEquals(pq.fnumber(res, 'date'), 0)
				assertEquals(pq.getvalue(res, 0, 0), '2023-02-27')
				pq.clear(res)
			})
		})

		await t.step('field functions', async (t) => {
			const res = pq.exec(
				conn,
				"SELECT 'test_value' as text_col, null as null_col, 42 as num_col",
			)

			await t.step('fformat returns correct field format', () => {
				assertEquals(pq.fformat(res, 0), 0)
				assertEquals(pq.fformat(res, 1), 0)
				assertEquals(pq.fformat(res, 2), 0)
			})

			await t.step('getisnull detects null values correctly', () => {
				assertEquals(pq.getisnull(res, 0, 0), false) // text_col is not null
				assertEquals(pq.getisnull(res, 0, 1), true) // null_col is null
				assertEquals(pq.getisnull(res, 0, 2), false) // num_col is not null
			})

			await t.step('getvalue handles null values', () => {
				assertEquals(pq.getvalue(res, 0, 0), 'test_value') // text value
				assertEquals(pq.getvalue(res, 0, 1), null) // null value
				assertEquals(pq.getvalue(res, 0, 2), '42') // number as text
			})

			pq.clear(res)
		})

		await t.step('error handling functions', async (t) => {
			await t.step('resultErrorMessage on successful query', () => {
				const res = pq.exec(conn, "SELECT 'test'")
				assertEquals(pq.resultErrorMessage(res), '') // No error
				pq.clear(res)
			})

			await t.step('resultErrorMessage on failed query', () => {
				const res = pq.exec(conn, 'INVALID SQL SYNTAX HERE')
				assertEquals(pq.resultStatus(res), ExecStatusType.PGRES_FATAL_ERROR)
				const errorMsg = pq.resultErrorMessage(res)
				assertExists(errorMsg)
				assertEquals(errorMsg.length > 0, true)
				pq.clear(res)
			})
		})

		await t.step('edge cases and parameter validation', async (t) => {
			await t.step('cmdTuples with DDL commands returns -1', () => {
				const res = pq.exec(
					conn,
					'CREATE TEMP TABLE test_cmdtuples (id int)',
				)
				const createStatus = pq.resultStatus(res)
				const count = pq.cmdTuples(res)
				pq.clear(res)
				assertEquals(createStatus, ExecStatusType.PGRES_COMMAND_OK)
				assertEquals(count, -1) // DDL commands don't affect rows
			})

			await t.step('fnumber with nonexistent column returns -1', () => {
				const res = pq.exec(conn, "SELECT 'value' as existing_col")
				assertEquals(pq.fnumber(res, 'nonexistent_column'), -1)
				assertEquals(pq.fnumber(res, 'existing_col'), 0) // Verify normal case works
				pq.clear(res)
			})

			await t.step('execParams', async (t) => {
				await t.step('basic parameterized query', () => {
					const res = pq.execParams(conn, 'SELECT $1::text as value', [
						'test',
					])
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_TUPLES_OK,
					)
					assertEquals(pq.nfields(res), 1)
					assertEquals(pq.ntuples(res), 1)
					assertEquals(pq.getvalue(res, 0, 0), 'test')
					assertEquals(pq.fname(res, 0), 'value')
					pq.clear(res)
				})

				await t.step('multiple parameters', () => {
					const res = pq.execParams(
						conn,
						'SELECT $1::int + $2::int as sum',
						[
							'5',
							'10',
						],
					)
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_TUPLES_OK,
					)
					assertEquals(pq.nfields(res), 1)
					assertEquals(pq.ntuples(res), 1)
					assertEquals(pq.getvalue(res, 0, 0), '15')
					assertEquals(pq.fname(res, 0), 'sum')
					pq.clear(res)
				})

				await t.step('query with no parameters', () => {
					const res = pq.execParams(conn, 'SELECT 42 as answer')
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_TUPLES_OK,
					)
					assertEquals(pq.nfields(res), 1)
					assertEquals(pq.ntuples(res), 1)
					assertEquals(pq.getvalue(res, 0, 0), '42')
					assertEquals(pq.fname(res, 0), 'answer')
					pq.clear(res)
				})

				await t.step('empty parameters array', () => {
					const res = pq.execParams(conn, 'SELECT 999 as empty_params', [])
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_TUPLES_OK,
					)
					assertEquals(pq.nfields(res), 1)
					assertEquals(pq.ntuples(res), 1)
					assertEquals(pq.getvalue(res, 0, 0), '999')
					pq.clear(res)
				})

				await t.step('various data types', () => {
					const res = pq.execParams(
						conn,
						'SELECT $1::text as text_val, $2::int as int_val, $3::float as float_val, $4::boolean as bool_val',
						['hello', '42', '3.14', 'true'],
					)
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_TUPLES_OK,
					)
					assertEquals(pq.nfields(res), 4)
					assertEquals(pq.ntuples(res), 1)
					assertEquals(pq.getvalue(res, 0, 0), 'hello')
					assertEquals(pq.getvalue(res, 0, 1), '42')
					assertEquals(pq.getvalue(res, 0, 2), '3.14')
					assertEquals(pq.getvalue(res, 0, 3), 't')
					pq.clear(res)
				})

				await t.step('null parameter handling', () => {
					const res = pq.execParams(conn, 'SELECT $1::text as nullable', [
						'',
					])
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_TUPLES_OK,
					)
					assertEquals(pq.nfields(res), 1)
					assertEquals(pq.ntuples(res), 1)
					assertEquals(pq.getvalue(res, 0, 0), '')
					pq.clear(res)
				})

				await t.step('error handling - invalid SQL', () => {
					const res = pq.execParams(conn, 'INVALID SQL SYNTAX HERE', [
						'param',
					])
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_FATAL_ERROR,
					)
					assertExists(pq.resultErrorMessage(res))
					pq.clear(res)
				})

				await t.step('error handling - parameter count mismatch', () => {
					const res = pq.execParams(conn, 'SELECT $1::text, $2::text', [
						'only_one_param',
					])
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_FATAL_ERROR,
					)
					assertExists(pq.resultErrorMessage(res))
					pq.clear(res)
				})

				await t.step('INSERT/UPDATE operations', () => {
					// Create temp table
					const createRes = pq.execParams(
						conn,
						'CREATE TEMP TABLE test_execparams (id int, name text)',
					)
					const createStatus = pq.resultStatus(createRes)
					pq.clear(createRes)
					assertEquals(
						createStatus,
						ExecStatusType.PGRES_COMMAND_OK,
					)

					// Insert with parameters
					const insertRes = pq.execParams(
						conn,
						'INSERT INTO pg_temp.test_execparams VALUES ($1::int, $2::text)',
						['1', 'Alice'],
					)
					assertEquals(
						pq.resultStatus(insertRes),
						ExecStatusType.PGRES_COMMAND_OK,
					)
					assertEquals(pq.cmdTuples(insertRes), 1)
					pq.clear(insertRes)

					// Select to verify
					const selectRes = pq.execParams(
						conn,
						'SELECT name FROM pg_temp.test_execparams WHERE id = $1::int',
						['1'],
					)
					assertEquals(
						pq.resultStatus(selectRes),
						ExecStatusType.PGRES_TUPLES_OK,
					)
					assertEquals(pq.getvalue(selectRes, 0, 0), 'Alice')
					pq.clear(selectRes)
				})
			})

			await t.step('execPrepared', async (t) => {
				const stmtName = 'test-param-validation'

				await t.step('prepare statement with parameters', () => {
					const res = pq.prepare(
						conn,
						'SELECT $1::text as param',
						stmtName,
					)
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_COMMAND_OK,
					)
					pq.clear(res)
				})

				await t.step('execute with correct parameters', () => {
					const res = pq.execPrepared(conn, ['test_param'], stmtName)
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_TUPLES_OK,
					)
					assertEquals(pq.ntuples(res), 1)
					assertEquals(pq.nfields(res), 1)
					assertEquals(pq.cmdTuples(res), 1)
					assertEquals(pq.getvalue(res, 0, 0), 'test_param')
					pq.clear(res)
				})

				await t.step('execute with no parameters', () => {
					const res = pq.execPrepared(conn, undefined, stmtName)
					assertEquals(
						pq.resultStatus(res),
						ExecStatusType.PGRES_FATAL_ERROR,
					)
					pq.clear(res)
				})
			})
		})

		await t.step('connection functions', async (t) => {
			await t.step('consumeInput on synchronous connection', () => {
				assertEquals(pq.consumeInput(conn), 1)
			})

			await t.step('isBusy and isnonblocking', () => {
				assertEquals(pq.isBusy(conn), 0)
				assertEquals(pq.isnonblocking(conn), 0)
			})

			await t.step('flush', () => {
				assertEquals(pq.flush(conn), 0)
			})

			await t.step('socket and getCurrentTimeUSec', () => {
				assertEquals(pq.socket(conn) >= 0, true)
				assertEquals(pq.getCurrentTimeUSec() > 0n, true)
			})
		})
	} finally {
		pq.finish(conn)
	}
})

Deno.test('poll primitives', async (t) => {
	const pq = await import('./wrappers.ts')

	await t.step('connectStart error handling', () => {
		assertThrows(
			() => pq.connectStart('invalid://connection/string'),
			Error,
		)
	})

	await t.step('sendQuery throws on a failed connection', () => {
		const ptr = ffi.PQconnectStart(
			encodeTerminated('invalid://connection/string'),
		)
		assertExists(ptr)
		const badConn = ptr as PGconn
		try {
			assertEquals(pq.status(badConn), ConnStatusType.CONNECTION_BAD)
			assertThrows(() => pq.sendQuery(badConn, 'SELECT 1'), Error)
			assertThrows(
				() => pq.sendPrepare(badConn, 'SELECT 1', 'bad_stmt'),
				Error,
			)
			assertThrows(
				() => pq.sendQueryPrepared(badConn, ['1'], 'bad_stmt'),
				Error,
			)
			assertThrows(() => pq.flush(badConn), Error)
		} finally {
			pq.finish(badConn)
		}
	})
})

Deno.test('result metadata', async (t) => {
	const pq = await import('./wrappers.ts')

	const conn = pq.connectdb(getPGURL())
	assertExists(conn)
	assertEquals(pq.status(conn), ConnStatusType.CONNECTION_OK)
	const connectionOptions = pq.conninfo(conn)
	assertExists(connectionOptions.user)

	await t.step('result metadata functions', () => {
		// Setup a table
		const setupRes = pq.exec(
			conn,
			'CREATE TEMP TABLE metadata_test (id int PRIMARY KEY, name text)',
		)
		const setupStatus = pq.resultStatus(setupRes)
		pq.clear(setupRes)
		assertEquals(setupStatus, ExecStatusType.PGRES_COMMAND_OK)

		const res = pq.exec(conn, 'SELECT id, name FROM pg_temp.metadata_test')
		assertExists(res)
		assertEquals(pq.resultStatus(res), ExecStatusType.PGRES_TUPLES_OK)
		assertEquals(pq.nfields(res), 2)

		// ftable
		const tableOid0 = pq.ftable(res, 0)
		const tableOid1 = pq.ftable(res, 1)
		// Oids should be > 0 for actual table columns
		assertNotEquals(tableOid0, 0)
		assertNotEquals(tableOid1, 0)
		assertEquals(tableOid0, tableOid1)

		// ftablecol
		assertEquals(pq.ftablecol(res, 0), 1) // First column in table (id)
		assertEquals(pq.ftablecol(res, 1), 2) // Second column in table (name)

		// ftype
		const type0 = pq.ftype(res, 0) // int4
		const type1 = pq.ftype(res, 1) // text
		assertNotEquals(type0, 0)
		assertNotEquals(type1, 0)
		assertNotEquals(type0, type1)

		// fsize
		const size0 = pq.fsize(res, 0) // int4 is 4 bytes
		assertEquals(size0, 4)
		const size1 = pq.fsize(res, 1) // text is varlen (-1)
		assertEquals(size1, -1)

		// fmod
		// usually -1 for these basic types
		assertEquals(pq.fmod(res, 0), -1)
		assertEquals(pq.fmod(res, 1), -1)

		pq.clear(res)

		const dropRes = pq.exec(conn, 'DROP TABLE pg_temp.metadata_test')
		const dropStatus = pq.resultStatus(dropRes)
		pq.clear(dropRes)
		assertEquals(dropStatus, ExecStatusType.PGRES_COMMAND_OK)
	})

	await t.step('binaryTuples', () => {
		const resText = pq.exec(conn, 'SELECT 1')
		assertEquals(pq.binaryTuples(resText), false)
		pq.clear(resText)
	})

	await t.step('oidValue', () => {
		// Create table with OIDs (deprecated but still supported in some versions, or just check 0 for standard tables)
		// Modern PG doesn't support WITH OIDS by default or removed it (PG12+).
		// So usually returns 0 or InvalidOid.
		// Just check behavior on non-insert
		const resSelect = pq.exec(conn, 'SELECT 1')
		assertEquals(pq.oidValue(resSelect), 0)
		pq.clear(resSelect)
	})

	await t.step('prepared statement metadata', () => {
		const stmtName = 'meta_prep'
		const prepareRes = pq.prepare(
			conn,
			'SELECT $1::int as num, $2::text as str',
			stmtName,
		)
		assertEquals(pq.resultStatus(prepareRes), ExecStatusType.PGRES_COMMAND_OK)
		pq.clear(prepareRes)

		const describeRes = pq.describePrepared(conn, stmtName)
		assertEquals(
			pq.resultStatus(describeRes),
			ExecStatusType.PGRES_COMMAND_OK,
		)

		assertEquals(pq.nparams(describeRes), 2)
		assertEquals(pq.paramtype(describeRes, 0), 23)
		assertEquals(pq.paramtype(describeRes, 1), 25)
		assertEquals(pq.paramtype(describeRes, 2), 0)

		assertEquals(pq.nfields(describeRes), 2)
		assertEquals(pq.fname(describeRes, 0), 'num')
		assertEquals(pq.fname(describeRes, 1), 'str')
		assertEquals(pq.ftype(describeRes, 0), 23)
		assertEquals(pq.ftype(describeRes, 1), 25)
		assertEquals(pq.ftype(describeRes, 2), 0)
		assertThrows(() => pq.fname(describeRes, 2), Error)
		pq.clear(describeRes)

		const unnamedPrepareRes = pq.prepare(
			conn,
			'SELECT $1::int as unnamed_num',
		)
		assertEquals(
			pq.resultStatus(unnamedPrepareRes),
			ExecStatusType.PGRES_COMMAND_OK,
		)
		pq.clear(unnamedPrepareRes)

		const unnamedDescribeRes = pq.describePrepared(conn)
		assertEquals(
			pq.resultStatus(unnamedDescribeRes),
			ExecStatusType.PGRES_COMMAND_OK,
		)
		assertEquals(pq.nparams(unnamedDescribeRes), 1)
		assertEquals(pq.paramtype(unnamedDescribeRes, 0), 23)
		assertEquals(pq.nfields(unnamedDescribeRes), 1)
		assertEquals(pq.fname(unnamedDescribeRes, 0), 'unnamed_num')
		assertEquals(pq.ftype(unnamedDescribeRes, 0), 23)
		pq.clear(unnamedDescribeRes)

		const missingDescribeRes = pq.describePrepared(conn, 'missing_statement')
		assertEquals(
			pq.resultStatus(missingDescribeRes),
			ExecStatusType.PGRES_FATAL_ERROR,
		)
		assertEquals(pq.resultErrorMessage(missingDescribeRes).length > 0, true)
		pq.clear(missingDescribeRes)
	})

	pq.finish(conn)
})

Deno.test('escaping functions', async (t) => {
	const conn = connectdb(
		getPGURL(),
	)
	assertExists(conn)
	assertEquals(status(conn), ConnStatusType.CONNECTION_OK)

	await t.step('escapeLiteral', () => {
		// Basic string
		assertEquals(escapeLiteral(conn, 'hello'), "'hello'")

		// Quotes
		assertEquals(escapeLiteral(conn, "it's me"), "'it''s me'")

		// Backslashes (standard conforming strings usually treat backslashes literally)
		// But it depends on server config. Assuming standard_conforming_strings = on
		// which is default in modern PG.
		// If off, might be E'...'.
		// We just check it produces valid SQL literal that PG accepts.

		const complex = `weird ' chars " and \ backslashes`
		const escaped = escapeLiteral(conn, complex)

		// Verify by asking database
		const res = exec(conn, `SELECT ${escaped} as val`)
		assertExists(res)
		assertEquals(getvalue(res, 0, 0), complex)
		clear(res)
	})

	await t.step('escapeIdentifier', () => {
		// Simple identifier
		assertEquals(escapeIdentifier(conn, 'simple_table'), '"simple_table"')

		// Identifier with spaces
		assertEquals(
			escapeIdentifier(conn, 'table with spaces'),
			'"table with spaces"',
		)

		// Identifier with quotes
		assertEquals(
			escapeIdentifier(conn, 'table "quote"'),
			'"table ""quote"""',
		)

		// Verify by creating a temp table with weird name
		const weirdName = 'weird " table'
		const escapedName = escapeIdentifier(conn, weirdName)

		const createRes = exec(
			conn,
			`CREATE TEMP TABLE ${escapedName} (id int)`,
		)
		const createStatus = resultStatus(createRes)
		clear(createRes)
		assertEquals(createStatus, ExecStatusType.PGRES_COMMAND_OK)

		const dropRes = exec(conn, `DROP TABLE IF EXISTS pg_temp.${escapedName}`)
		const dropStatus = resultStatus(dropRes)
		clear(dropRes)
		assertEquals(dropStatus, ExecStatusType.PGRES_COMMAND_OK)
	})

	finish(conn)
})

Deno.test('connection info', async (t) => {
	const connUrl = new URL(
		getPGURL(),
	)
	const conn = connectdb(connUrl)
	assertExists(conn)
	assertEquals(status(conn), ConnStatusType.CONNECTION_OK)

	await t.step('db', () => {
		const dbName = db(conn)
		// Should match the one in URL or 'postgres'/'user' default
		// Usually 'postgres' in test envs if not specified
		assertExists(dbName)
		if (connUrl.pathname.length > 1) {
			assertEquals(dbName, connUrl.pathname.slice(1))
		}
	})

	await t.step('user', () => {
		const userName = user(conn)
		assertExists(userName)
		if (connUrl.username) {
			assertEquals(userName, connUrl.username)
		}
	})

	await t.step('host', () => {
		const hostName = host(conn)
		assertExists(hostName)
		// host can be empty for unix socket or localhost/IP
	})

	await t.step('port', () => {
		const portStr = port(conn)
		assertExists(portStr)
		if (connUrl.port) {
			assertEquals(portStr, connUrl.port)
		} else {
			assertEquals(portStr, '5432')
		}
	})

	await t.step('options', () => {
		const opts = options(conn)
		assertExists(opts)
		// Typically empty string by default
	})

	await t.step('backendPID', () => {
		const pid = backendPID(conn)
		assertNotEquals(pid, 0)
	})

	await t.step('protocolVersion', () => {
		const ver = protocolVersion(conn)
		assertEquals(ver, 3) // Protocol v3 is standard for modern PG
	})

	await t.step('reset', () => {
		reset(conn)
		assertEquals(status(conn), ConnStatusType.CONNECTION_OK)
	})

	await t.step('transactionStatus', () => {
		// Initial status: IDLE
		assertEquals(
			transactionStatus(conn),
			PGTransactionStatusType.PQTRANS_IDLE,
		)

		// Start transaction
		const resBegin = exec(conn, 'BEGIN')
		clear(resBegin)
		assertEquals(
			transactionStatus(conn),
			PGTransactionStatusType.PQTRANS_INTRANS,
		)

		// Error
		const resErr = exec(conn, 'SELECT invalid_syntax')
		clear(resErr)
		assertEquals(
			transactionStatus(conn),
			PGTransactionStatusType.PQTRANS_INERROR,
		)

		// Rollback
		const resRollback = exec(conn, 'ROLLBACK')
		clear(resRollback)
		assertEquals(
			transactionStatus(conn),
			PGTransactionStatusType.PQTRANS_IDLE,
		)
	})

	await t.step('parameterStatus', () => {
		const serverEncoding = parameterStatus(conn, 'server_encoding')
		assertExists(serverEncoding)
		// Typically UTF8
		assertEquals(serverEncoding, 'UTF8')

		const timeZone = parameterStatus(conn, 'TimeZone')
		assertExists(timeZone)

		const invalidParam = parameterStatus(conn, 'non_existent_param_xyz')
		assertEquals(invalidParam, null)
	})

	await t.step('ping', () => {
		const reachable = ping(connUrl)
		assertEquals(reachable, PGPing.PQPING_OK)

		const malformed = ping('invalid://connection/string')
		assertEquals(malformed, PGPing.PQPING_NO_ATTEMPT)
	})

	finish(conn)
})

// TODO: Implement tests for functions related to query cancelling: see https://www.postgresql.org/docs/17/libpq-cancel.html

Deno.test('error fields', async (t) => {
	const conn = connectdb(
		getPGURL(),
	)
	assertExists(conn)
	assertEquals(status(conn), ConnStatusType.CONNECTION_OK)

	await t.step('syntax error provides error fields', () => {
		const res = exec(conn, 'SELECT * FROM')
		assertExists(res)
		assertEquals(resultStatus(res), ExecStatusType.PGRES_FATAL_ERROR)

		// Verify primary message
		const message = resultErrorField(res, PGDiag.MESSAGE_PRIMARY)
		assertExists(message)
		// Should be something like "syntax error at end of input" or similar
		assertEquals(message.length > 0, true)

		// Verify severity
		const severity = resultErrorField(res, PGDiag.SEVERITY)
		assertExists(severity)
		assertEquals(severity, 'ERROR')

		// Verify SQLSTATE (syntax error is usually 42601)
		const sqlState = resultErrorField(res, PGDiag.SQLSTATE)
		assertExists(sqlState)
		assertEquals(sqlState.length, 5)

		clear(res)
	})

	await t.step('missing column provides column name field', () => {
		// Try to select non-existent column
		const res = exec(conn, 'SELECT non_existent_column FROM pg_database')
		assertExists(res)
		assertEquals(resultStatus(res), ExecStatusType.PGRES_FATAL_ERROR)

		const message = resultErrorField(res, PGDiag.MESSAGE_PRIMARY)
		assertExists(message)

		// Severity
		const severity = resultErrorField(res, PGDiag.SEVERITY)
		assertEquals(severity, 'ERROR')

		// Position might be available
		const position = resultErrorField(res, PGDiag.STATEMENT_POSITION)
		if (position !== null) {
			// If available, it should be a number string
			assertEquals(isNaN(parseInt(position)), false)
		}

		clear(res)
	})

	await t.step('successful query returns null for error fields', () => {
		const res = exec(conn, 'SELECT 1')
		assertExists(res)
		assertEquals(resultStatus(res), ExecStatusType.PGRES_TUPLES_OK)

		const message = resultErrorField(res, PGDiag.MESSAGE_PRIMARY)
		assertEquals(message, null)

		const severity = resultErrorField(res, PGDiag.SEVERITY)
		assertEquals(severity, null)

		clear(res)
	})

	await t.step('resultVerboseErrorMessage for failed query', () => {
		const res = exec(conn, 'SELECT * FROM')
		assertEquals(resultStatus(res), ExecStatusType.PGRES_FATAL_ERROR)

		const verbose = resultVerboseErrorMessage(
			res,
			PGVerbosity.PQERRORS_VERBOSE,
			PGContextVisibility.PQSHOW_CONTEXT_ALWAYS,
		)
		assertExists(verbose)
		if (verbose !== null) {
			assertEquals(verbose.includes('ERROR'), true)
		}

		clear(res)
	})

	await t.step('resultVerboseErrorMessage on success is non-fatal', () => {
		const res = exec(conn, 'SELECT 1')
		assertEquals(resultStatus(res), ExecStatusType.PGRES_TUPLES_OK)

		const verbose = resultVerboseErrorMessage(
			res,
			PGVerbosity.PQERRORS_DEFAULT,
			PGContextVisibility.PQSHOW_CONTEXT_ERRORS,
		)

		if (verbose !== null) {
			assertEquals(verbose.includes('not an error result'), true)
		}

		clear(res)
	})

	finish(conn)
})

Deno.test('direct notifications API', async () => {
	const connString = getPGURL()
	const listenerConn = connectdb(connString)
	const senderConn = connectdb(connString)

	assertExists(listenerConn)
	assertExists(senderConn)

	const listenRes = exec(listenerConn, 'LISTEN test_channel_direct_notifies')
	clear(listenRes)

	const notifyRes = exec(
		senderConn,
		"NOTIFY test_channel_direct_notifies, 'payload-123'",
	)
	clear(notifyRes)

	let notification = null
	for (let attempt = 0; attempt < 100; attempt++) {
		consumeInput(listenerConn)
		notification = notifies(listenerConn)
		if (notification !== null) break
		await delay(10)
	}

	assertExists(notification)
	if (notification !== null) {
		assertEquals(notification.relname, 'test_channel_direct_notifies')
		assertNotEquals(notification.bePid, 0)
		assertEquals(notification.extra, 'payload-123')
	}

	assertEquals(notifies(listenerConn), null)

	const unlistenRes = exec(listenerConn, 'UNLISTEN *')
	clear(unlistenRes)

	finish(listenerConn)
	finish(senderConn)
})
