/**
 * thread: blocking libpq calls off the JavaScript thread.
 *
 * Deno FFI `nonblocking: true` runs the ordinary C functions (`PQconnectdb`,
 * `PQexec`, `PQexecParams`, `PQexecPrepared`, `PQprepare`, `PQreset`) off the
 * JavaScript thread and returns a Promise. Libpq still waits inside those
 * calls, so `connect_timeout` and the rest of blocking-connect semantics
 * still apply.
 *
 * Command helpers return a single `PGresult`. `PQexec` keeps only the last
 * command of a multi-statement string.
 *
 * @module
 */
import { ConnStatusType, type PGconn, type PGresult } from './types.ts'
import { ffi } from './load.ts'
import { errorMessage, finish, status } from './wrappers.ts'
import { type ConnectOptions, resolveConninfo } from '../conninfo.ts'
import { encodeTerminated, encodeTerminatedArray } from './strings.ts'

/**
 * Connect without blocking the JavaScript thread.
 *
 * On failure the handle is finished before throwing.
 *
 * @param {string | URL | ConnectOptions} [conninfo] - Connection string,
 * URL, or {@linkcode ConnectOptions}. When omitted, `PGURL` and libpq
 * defaults are used.
 * @returns {Promise<PGconn>} Connected handle. Caller must {@linkcode finish} it.
 * @throws {Error} When the connection cannot be established
 */
export async function connect(
	conninfo?: string | URL | ConnectOptions,
): Promise<PGconn> {
	conninfo = resolveConninfo(conninfo)
	const conn = await ffi.PQconnectdbAsync(
		encodeTerminated(conninfo),
	)

	if (conn !== null) {
		const connStatus = ffi.PQstatus(conn)

		if (connStatus === ConnStatusType.CONNECTION_OK) {
			return conn
		} else {
			const msg = errorMessage(conn)
			finish(conn)
			throw new Error(msg)
		}
	} else {
		throw new Error('Failed to create connection')
	}
}

/**
 * Reset the connection without blocking the JavaScript thread.
 *
 * Does not take ownership of `conn`. On throw the caller still
 * {@linkcode finish}es it.
 *
 * @param {PGconn} conn - Connection
 * @returns {Promise<void>}
 * @throws {Error} When the connection is not OK after reset
 */
export async function reset(conn: PGconn): Promise<void> {
	await ffi.PQresetAsync(conn)
	if (status(conn) !== ConnStatusType.CONNECTION_OK) {
		throw new Error(errorMessage(conn))
	}
}

/**
 * Run a command without blocking the JavaScript thread.
 *
 * A multi-statement string keeps only the last result. Connection-level
 * failure throws; SQL errors still return a `PGresult`.
 *
 * @param {PGconn} conn - Connection
 * @param {string} command - SQL to run
 * @returns {Promise<PGresult>} Command result. Caller must {@linkcode clear} it.
 * @throws {Error} When execution fails at connection level
 */
export async function exec(
	conn: PGconn,
	command: string,
): Promise<PGresult> {
	const r = await ffi.PQexecAsync(conn, encodeTerminated(command))
	return requireResult(conn, r)
}

/**
 * Run a parameterized command without blocking the JavaScript thread.
 *
 * Connection-level failure throws; SQL errors still return a `PGresult`.
 *
 * @param {PGconn} conn - Connection
 * @param {string} command - SQL to run
 * @param {string[]} [params] - Query parameters
 * @returns {Promise<PGresult>} Command result. Caller must {@linkcode clear} it.
 * @throws {Error} When execution fails at connection level
 */
export async function execParams(
	conn: PGconn,
	command: string,
	params?: string[],
): Promise<PGresult> {
	let nParams: number
	let paramValues: Uint8Array<ArrayBuffer> | null

	if (params === undefined) {
		nParams = 0
		paramValues = null
	} else {
		nParams = params.length
		paramValues = encodeTerminatedArray(params)
	}

	const r = await ffi.PQexecParamsAsync(
		conn,
		encodeTerminated(command),
		nParams,
		null, // paramTypes
		paramValues,
		null, // paramLengths
		null, // paramFormats
		0, // resultFormat
	)
	return requireResult(conn, r)
}

/**
 * Run a prepared statement without blocking the JavaScript thread.
 *
 * Connection-level failure throws; SQL errors still return a `PGresult`.
 *
 * @param {PGconn} conn - Connection
 * @param {string[]} [params] - Statement parameters
 * @param {string} [stmtName=''] - Prepared statement name. Empty is the unnamed statement
 * @returns {Promise<PGresult>} Command result. Caller must {@linkcode clear} it.
 * @throws {Error} When execution fails at connection level
 */
export async function execPrepared(
	conn: PGconn,
	params?: string[],
	stmtName: string = '',
): Promise<PGresult> {
	let nParams: number
	let paramValues: Uint8Array<ArrayBuffer> | null

	if (params === undefined) {
		nParams = 0
		paramValues = null
	} else {
		nParams = params.length
		paramValues = encodeTerminatedArray(params)
	}
	const name = encodeTerminated(stmtName)

	const r = await ffi.PQexecPreparedAsync(
		conn,
		name,
		nParams,
		paramValues,
		null,
		null,
		0,
	)
	return requireResult(conn, r)
}

/**
 * Prepare a statement without blocking the JavaScript thread.
 *
 * Connection-level failure throws; SQL errors still return a `PGresult`.
 *
 * @param {PGconn} conn - Connection
 * @param {string} query - SQL to prepare
 * @param {string} [stmtName=''] - Name to assign. Empty creates an unnamed statement
 * @returns {Promise<PGresult>} Prepare result. Caller must {@linkcode clear} it.
 * @throws {Error} When preparation fails at connection level
 */
export async function prepare(
	conn: PGconn,
	query: string,
	stmtName: string = '',
): Promise<PGresult> {
	const res = await ffi.PQprepareAsync(
		conn,
		encodeTerminated(stmtName),
		encodeTerminated(query),
		0,
		null,
	)
	return requireResult(conn, res)
}

function requireResult(conn: PGconn, result: Deno.PointerValue): PGresult {
	if (result !== null) {
		return result
	}
	throw new Error(errorMessage(conn))
}
