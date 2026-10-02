/**
 * Blocking libpq wrappers.
 *
 * Each function links to its C counterpart with `@see`. Functions tagged
 * `libpq-deviation` do not match C return or error semantics; read the
 * **Differs from C** sentence in that comment.
 *
 * @module
 */
import type { Notify, Oid, PGcancel, PGconn, PGresult } from './types.ts'
import {
	ConnStatusType,
	type ExecStatusType,
	type PGContextVisibility,
	type PGDiag,
	type PGPing,
	type PGTransactionStatusType,
	type PGVerbosity,
	type PostgresPollingStatusType,
} from './types.ts'
import { ffi } from './load.ts'
import { type ConnectOptions, resolveConninfo } from '../conninfo.ts'
import { encode, encodeTerminated, encodeTerminatedArray } from './strings.ts'

/**
 * Frees the storage associated with a PGresult. Should be called when done with a query result.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQCLEAR | PQclear}
 * @param {PGresult} res - Result
 * @returns {void}
 */
export function clear(res: PGresult): void {
	ffi.PQclear(res)
}

/**
 * Read the command-tag count, including SELECT counts. This is not a count of
 * rows written; managed Result.affectedRows filters the command verb separately.
 *
 * **Differs from C:** `PQcmdTuples` returns a string. This wrapper returns a
 * number, or `-1` when the C string is empty or not a number.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQCMDTUPLES | PQcmdTuples}
 * @param {PGresult} res - Result
 * @returns {number} The reported count, or -1 when absent or invalid.
 */
export function cmdTuples(res: PGresult): number {
	const b = ffi.PQcmdTuples(res)

	if (b !== null) {
		const r = new Deno.UnsafePointerView(b)
		const v = Number.parseInt(r.getCString())
		if (Number.isNaN(v)) {
			return -1
		} else {
			return v
		}
	} else {
		return -1
	}
}

/**
 * Command tag of a result (`SELECT 2`, `INSERT 0 1`, …).
 *
 * **Differs from C:** copies the borrowed C string into a JavaScript string;
 * a NULL pointer becomes an empty string. The caller owns no native allocation.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQCMDSTATUS | PQcmdStatus}
 * @param {PGresult} res - Result
 * @returns {string} The command tag, or empty string if none
 */
export function cmdStatus(res: PGresult): string {
	const b = ffi.PQcmdStatus(res)

	if (b !== null) {
		return new Deno.UnsafePointerView(b).getCString()
	}

	return ''
}

/**
 * Makes a new connection to the database server.
 *
 * **Differs from C:** `PQconnectdb` can return a `PGconn` with
 * `CONNECTION_BAD`. This wrapper calls {@linkcode finish} and throws, so the
 * caller never holds a failed handle.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTDB | PQconnectdb}
 * @param {string | URL | ConnectOptions} [conninfo] - Connection string,
 * URL, or {@linkcode ConnectOptions}. When omitted, `PGURL` and libpq
 * defaults are used.
 * @returns {PGconn} Connected handle. Caller must {@linkcode finish} it.
 * @throws {Error} When the connection cannot be established
 */
export function connectdb(
	conninfo?: string | URL | ConnectOptions,
): PGconn {
	conninfo = resolveConninfo(conninfo)
	const conn = ffi.PQconnectdb(encodeTerminated(conninfo))

	if (conn !== null) {
		const status = ffi.PQstatus(conn)

		if (status === ConnStatusType.CONNECTION_OK) {
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
 * Queries a connection for its polling status. Use after {@linkcode connectStart}.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTPOLL | PQconnectPoll}
 * @param {PGconn} conn - Connection
 * @returns {PostgresPollingStatusType} Polling status - caller checks for PGRES_POLLING_OK, PGRES_POLLING_FAILED, etc.
 */
export function connectPoll(conn: PGconn): PostgresPollingStatusType {
	return ffi.PQconnectPoll(conn)
}

/**
 * Return the connection options used by libpq, keyed by option name.
 *
 * Copies each option's current `val`. Options without a value are included as
 * `null`.
 *
 * **Differs from C:** returns a JavaScript object and frees the native option
 * array. Throws when libpq returns `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNINFO | PQconninfo}
 * @param {PGconn} conn - Connection
 * @returns {Record<string, string | null>} Current option values
 * @throws {Error} When libpq cannot allocate the option array
 */
export function conninfo(conn: PGconn): Record<string, string | null> {
	const options = ffi.PQconninfo(conn)
	if (options === null) {
		const message = errorMessage(conn)
		throw new Error(message || 'Failed to get connection options')
	}

	// PQconninfoOption on the supported 64-bit ABI has six pointers and an
	// int dispsize, followed by padding to pointer alignment (56 bytes total).
	const pointerSize = 8
	const optionSize = Math.ceil((pointerSize * 6 + 4) / pointerSize) *
		pointerSize
	const values: Record<string, string | null> = {}

	try {
		const view = new Deno.UnsafePointerView(options)
		let offset = 0
		let keywordPointer = view.getPointer(offset)
		while (keywordPointer !== null) {
			const keyword = new Deno.UnsafePointerView(keywordPointer)
				.getCString()
			const valuePointer = view.getPointer(offset + pointerSize * 3)
			values[keyword] = valuePointer === null
				? null
				: new Deno.UnsafePointerView(valuePointer).getCString()
			offset += optionSize
			keywordPointer = view.getPointer(offset)
		}
	} finally {
		ffi.PQconninfoFree(options)
	}

	return values
}

/**
 * Begin a nonblocking connection. Complete it with {@linkcode connectPoll},
 *
 * **Differs from C:** `PQconnectStart` can return a `PGconn` that is already
 * `CONNECTION_BAD`. This wrapper calls {@linkcode finish} and throws, so the
 * caller never holds that handle. In-progress statuses are returned for polling.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTSTARTPARAMS | PQconnectStart}
 * @param {string | URL | ConnectOptions} [conninfo] - Connection string,
 * URL, or {@linkcode ConnectOptions}. When omitted, `PGURL` and libpq
 * defaults are used.
 * @returns {PGconn} Handle for polling. Caller must {@linkcode finish} it.
 * @throws {Error} When allocation fails or status is already CONNECTION_BAD
 */
export function connectStart(
	conninfo?: string | URL | ConnectOptions,
): PGconn {
	conninfo = resolveConninfo(conninfo)
	const conn = ffi.PQconnectStart(encodeTerminated(conninfo))

	if (conn === null) {
		throw new Error('Failed to start connection')
	}

	if (ffi.PQstatus(conn) === ConnStatusType.CONNECTION_BAD) {
		const msg = errorMessage(conn)
		finish(conn)
		throw new Error(msg)
	}

	return conn
}

/**
 * Consume input if available on the connection.
 *
 * **Differs from C:** throws instead of returning 0 on failure.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQCONSUMEINPUT | PQconsumeInput}
 * @param {PGconn} conn - Connection
 * @returns {1} Always returns 1 on success
 * @throws {Error} When input consumption fails
 */
export function consumeInput(conn: PGconn): 1 {
	const r = ffi.PQconsumeInput(conn)

	switch (r) {
		case 0: {
			const msg = errorMessage(conn)
			throw new Error(msg)
		}
		default:
			return 1
	}
}
/**
 * Escape an identifier (table name, column name, etc.) for use in SQL.
 *
 * **Differs from C:** returns a JavaScript string and calls `PQfreemem`.
 * Throws instead of returning `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQESCAPEIDENTIFIER | PQescapeIdentifier}
 * @param {PGconn} conn - Connection
 * @param {string} str - The identifier to escape
 * @returns {string} Escaped identifier. The caller does not free C memory.
 * @throws {Error} When escaping fails
 */
export function escapeIdentifier(conn: PGconn, str: string): string {
	const encoded = encode(str)

	const result = ffi.PQescapeIdentifier(conn, encoded, BigInt(encoded.length))

	if (result !== null) {
		const escaped = new Deno.UnsafePointerView(result).getCString()
		ffi.PQfreemem(result) // Free the libpq-allocated memory
		return escaped
	} else {
		throw new Error(errorMessage(conn))
	}
}

/**
 * Escape a string literal for use in SQL.
 *
 * **Differs from C:** returns a JavaScript string and calls `PQfreemem` on
 * the C string. Throws instead of returning `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQESCAPELITERAL | PQescapeLiteral}
 * @param {PGconn} conn - Connection
 * @param {string} str - The string to escape
 * @returns {string} Escaped literal. The caller does not free C memory.
 * @throws {Error} When allocation fails or escaping fails
 */
export function escapeLiteral(conn: PGconn, str: string): string {
	const encoded = encode(str)

	const result = ffi.PQescapeLiteral(conn, encoded, BigInt(encoded.length))

	if (result !== null) {
		const escaped = new Deno.UnsafePointerView(result).getCString()
		ffi.PQfreemem(result) // Free the libpq-allocated memory
		return escaped
	} else {
		throw new Error(errorMessage(conn))
	}
}

/**
 * Decode PostgreSQL's escape-format bytea text into bytes.
 *
 * **Differs from C:** copies the returned bytes and calls `PQfreemem` on the
 * libpq allocation.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-misc.html#LIBPQ-PQUNESCAPEBYTEA | PQunescapeBytea}
 * @param {string} text - Escape-format bytea text
 * @returns {Uint8Array} Decoded bytes
 */
export function unescapeBytea(text: string): Uint8Array {
	const input = encodeTerminated(text)
	const length = new BigUint64Array(1)
	const result = ffi.PQunescapeBytea(input, Deno.UnsafePointer.of(length))
	if (result === null) throw new TypeError(`Invalid bytea text: ${text}`)

	try {
		const byteLength = Number(length[0])
		return new Uint8Array(
			new Deno.UnsafePointerView(result).getArrayBuffer(byteLength),
		).slice()
	} finally {
		ffi.PQfreemem(result)
	}
}

/**
 * Get the database name of the connection.
 *
 * **Differs from C:** throws instead of returning `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQDB | PQdb}
 * @param {PGconn} conn - Connection
 * @returns {string} The database name
 * @throws {Error} When libpq returns NULL
 */
export function db(conn: PGconn): string {
	const result = ffi.PQdb(conn)
	if (result !== null) {
		return new Deno.UnsafePointerView(result).getCString()
	} else {
		throw new Error('PQdb: Unexpected null value returned from libpq')
	}
}

/**
 * Get the user name of the connection.
 *
 * **Differs from C:** throws instead of returning `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQUSER | PQuser}
 * @param {PGconn} conn - Connection
 * @returns {string} The user name
 * @throws {Error} When libpq returns NULL
 */
export function user(conn: PGconn): string {
	const result = ffi.PQuser(conn)
	if (result !== null) {
		return new Deno.UnsafePointerView(result).getCString()
	} else {
		throw new Error('PQuser: Unexpected null value returned from libpq')
	}
}

/**
 * Get the server host name of the connection.
 *
 * **Differs from C:** throws instead of returning `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQHOST | PQhost}
 * @param {PGconn} conn - Connection
 * @returns {string} The host name
 * @throws {Error} When libpq returns NULL
 */
export function host(conn: PGconn): string {
	const result = ffi.PQhost(conn)

	if (result !== null) {
		return new Deno.UnsafePointerView(result).getCString()
	} else {
		throw new Error('PQhost: Unexpected null value returned from libpq')
	}
}

/**
 * Get the port of the connection.
 *
 * **Differs from C:** throws instead of returning `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQPORT | PQport}
 * @param {PGconn} conn - Connection
 * @returns {string} The port number as a string
 * @throws {Error} When libpq returns NULL
 */
export function port(conn: PGconn): string {
	const result = ffi.PQport(conn)
	if (result !== null) {
		return new Deno.UnsafePointerView(result).getCString()
	} else {
		throw new Error('PQport: Unexpected null value returned from libpq')
	}
}

/**
 * Get the command-line options passed in the connection request.
 *
 * **Differs from C:** throws instead of returning `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQOPTIONS | PQoptions}
 * @param {PGconn} conn - Connection
 * @returns {string} The options string
 * @throws {Error} When libpq returns NULL
 */
export function options(conn: PGconn): string {
	const result = ffi.PQoptions(conn)
	if (result !== null) {
		return new Deno.UnsafePointerView(result).getCString()
	} else {
		throw new Error('PQoptions: Unexpected null value returned from libpq')
	}
}

/**
 * Get the OID of the inserted row (for INSERT commands with RETURNING oid).
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQOIDVALUE | PQoidValue}
 * @param {PGresult} res - Result
 * @returns {Oid} The OID of the inserted row, or 0 if not applicable
 */
export function oidValue(res: PGresult): Oid {
	return ffi.PQoidValue(res)
}

/**
 * Get the process ID of the backend server process.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQBACKENDPID | PQbackendPID}
 * @param {PGconn} conn - Connection
 * @returns {number} The backend process ID
 */
export function backendPID(conn: PGconn): number {
	return ffi.PQbackendPID(conn)
}

/**
 * Check if all fields in the result are in binary format.
 *
 * **Differs from C:** returns a boolean instead of 1 or 0.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQBINARYTUPLES | PQbinaryTuples}
 * @param {PGresult} res - Result
 * @returns {boolean} true if all fields are binary
 */
export function binaryTuples(res: PGresult): boolean {
	return ffi.PQbinaryTuples(res) === 1
}

/**
 * Request cancellation of a query.
 *
 * **Differs from C:** throws instead of returning 0. The error buffer is not
 * exposed; its contents are used as the thrown message.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-cancel.html#LIBPQ-PQCANCEL | PQcancel}
 * @param {PGcancel} cancel - Cancel handle
 * @returns {void}
 * @throws {Error} When cancellation request fails
 */
export function cancel(cancel: PGcancel): void {
	const errbuf = new Uint8Array(256)
	const result = ffi.PQcancel(cancel, errbuf, errbuf.length)

	if (result !== 1) {
		const decoder = new TextDecoder()
		const errMsg = decoder.decode(errbuf).split('\0')[0]
		throw new Error(`Cancel failed: ${errMsg}`)
	}
}

/**
 * Free a cancel structure.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-cancel.html#LIBPQ-PQFREECANCEL | PQfreeCancel}
 * @param {PGcancel} cancel - Cancel handle
 * @returns {void}
 */
export function freeCancel(cancel: PGcancel): void {
	ffi.PQfreeCancel(cancel)
}

/**
 * Create a cancel structure for the given connection.
 *
 * **Differs from C:** throws instead of returning `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-cancel.html#LIBPQ-PQGETCANCEL | PQgetCancel}
 * @param {PGconn} conn - Connection
 * @returns {PGcancel} Cancel handle. Caller must {@linkcode freeCancel} it.
 * @throws {Error} When cancel handle creation fails
 */
export function getCancel(conn: PGconn): PGcancel {
	const cancel = ffi.PQgetCancel(conn)
	if (cancel !== null) {
		return cancel
	} else {
		throw new Error('PQgetCancel: Unexpected null value returned from libpq')
	}
}

/**
 * Get the current in-transaction status of the server.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQTRANSACTIONSTATUS | PQtransactionStatus}
 * @param {PGconn} conn - Connection
 * @returns {PGTransactionStatusType} The transaction status
 */
export function transactionStatus(conn: PGconn): PGTransactionStatusType {
	return ffi.PQtransactionStatus(conn)
}

/**
 * Get the current value of a server parameter.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQPARAMETERSTATUS | PQparameterStatus}
 * @param {PGconn} conn - Connection
 * @param {string} paramName - The name of the parameter to query
 * @returns {string | null} The parameter value, or null if unknown
 */
export function parameterStatus(
	conn: PGconn,
	paramName: string,
): string | null {
	const result = ffi.PQparameterStatus(conn, encodeTerminated(paramName))
	return result !== null
		? new Deno.UnsafePointerView(result).getCString()
		: null
}

/**
 * Get the data type OID of a parameter in a prepared statement.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQPARAMTYPE | PQparamtype}
 * @param {PGresult} res - Result
 * @param {number} paramNumber - The parameter number (0-based)
 * @returns {Oid} The OID of the parameter's data type
 */
export function paramtype(res: PGresult, paramNumber: number): Oid {
	return ffi.PQparamtype(res, paramNumber)
}

/**
 * Get the protocol version being used by the connection.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQPROTOCOLVERSION | PQprotocolVersion}
 * @param {PGconn} conn - Connection
 * @returns {number} The protocol version (typically 3)
 */
export function protocolVersion(conn: PGconn): number {
	return ffi.PQprotocolVersion(conn)
}

/**
 * Submits a command to the server and waits for the result.
 *
 * **Differs from C:** throws instead of returning `NULL` on connection-level
 * failure. SQL errors still return a `PGresult`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXEC | PQexec}
 * @param {PGconn} conn - Connection
 * @param {string} command - SQL to run
 * @returns {PGresult} Command result. Caller must {@linkcode clear} it.
 * @throws {Error} When execution fails at connection level
 */
export function exec(conn: PGconn, command: string): PGresult {
	const r = ffi.PQexec(conn, encodeTerminated(command))

	if (r !== null) {
		return r
	} else {
		const msg = errorMessage(conn)
		throw new Error(msg)
	}
}

/**
 * Submits a parameterized command to the server and waits for the result.
 *
 * **Differs from C:** throws instead of returning `NULL` on connection-level
 * failure. SQL errors still return a `PGresult`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXECPARAMS | PQexecParams}
 * @param {PGconn} conn - Connection
 * @param {string} command - SQL to run
 * @param {Array<string | null>} [params] - Query parameters. `null` is SQL NULL
 * @returns {PGresult} Command result. Caller must {@linkcode clear} it.
 * @throws {Error} When execution fails at connection level
 */
export function execParams(
	conn: PGconn,
	command: string,
	params?: Array<string | null>,
): PGresult {
	let nParams: number
	let paramValues: Uint8Array<ArrayBuffer> | null

	if (params === undefined) {
		nParams = 0
		paramValues = null
	} else {
		nParams = params.length
		paramValues = encodeTerminatedArray(params)
	}

	const r = ffi.PQexecParams(
		conn,
		encodeTerminated(command),
		nParams,
		null, // paramTypes
		paramValues,
		null, // paramLengths
		null, // paramFormats
		0, // resultFormat
	)

	if (r !== null) {
		return r
	} else {
		const msg = errorMessage(conn)
		throw new Error(msg)
	}
}

/**
 * Execute a prepared statement with given parameters.
 *
 * **Differs from C:** throws instead of returning `NULL` on connection-level
 * failure. SQL errors still return a `PGresult`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXECPREPARED | PQexecPrepared}
 * @param {PGconn} conn - Connection
 * @param {Array<string | null>} [params] - Statement parameters. `null` is SQL NULL
 * @param {string} [stmtName=''] - Prepared statement name. Empty is the unnamed statement
 * @returns {PGresult} Command result. Caller must {@linkcode clear} it.
 * @throws {Error} When execution fails at connection level
 */
export function execPrepared(
	conn: PGconn,
	params?: Array<string | null>,
	stmtName: string = '',
): PGresult {
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

	const r = ffi.PQexecPrepared(
		conn,
		name,
		nParams,
		paramValues,
		null,
		null,
		0,
	)

	if (r !== null) {
		return r
	} else {
		const msg = errorMessage(conn)
		throw new Error(msg)
	}
}

/**
 * Get the type-specific modifier for the field.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFMOD | PQfmod}
 * @param {PGresult} res - Result
 * @param {number} columnNumber - The column number (0-based)
 * @returns {number} The type modifier (-1 if no information is available, this is normal for most data types)
 */
export function fmod(res: PGresult, columnNumber: number): number {
	return ffi.PQfmod(res, columnNumber)
}

/**
 * Get the size in bytes of the field type (negative value for variable-length types).
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFSIZE | PQfsize}
 * @param {PGresult} res - Result
 * @param {number} columnNumber - The column number (0-based)
 * @returns {number} The field size in bytes
 */
export function fsize(res: PGresult, columnNumber: number): number {
	return ffi.PQfsize(res, columnNumber)
}

/**
 * Get the OID of the table from which the given field was fetched.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFTABLE | PQftable}
 * @param {PGresult} res - Result
 * @param {number} columnNumber - The column number (0-based)
 * @returns {Oid} The table OID, or 0 if columnNumber is out of range or not a simple reference
 */
export function ftable(res: PGresult, columnNumber: number): Oid {
	return ffi.PQftable(res, columnNumber)
}

/**
 * Get the column number within the source table for the given field.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFTABLECOL | PQftablecol}
 * @param {PGresult} res - Result
 * @param {number} columnNumber - The column number (0-based)
 * @returns {number} The column number (1-based), or 0 if columnNumber is out of range or not a simple reference
 */
export function ftablecol(res: PGresult, columnNumber: number): number {
	return ffi.PQftablecol(res, columnNumber)
}

/**
 * Returns the format code indicating the format of the given column.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFFORMAT | PQfformat}
 * @param {PGresult} res - Result
 * @param {number} columnNumber - The column number (0-based)
 * @returns {number} Format code indicating the format of the given column: 0 for text format, 1 for binary format. Other values are reserved for future use.
 */
export function fformat(res: PGresult, columnNumber: number): number {
	return ffi.PQfformat(res, columnNumber)
}

/**
 * Get the field type OID for a given field.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFTYPE | PQftype}
 * @param {PGresult} res - Result
 * @param {number} columnNumber - The column number (0-based)
 * @returns {Oid} The OID of the field's data type
 */
export function ftype(res: PGresult, columnNumber: number): Oid {
	return ffi.PQftype(res, columnNumber)
}

/**
 * Close the connection to the server and free the PGconn data structure.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQFINISH | PQfinish}
 * @param {PGconn} conn - Connection
 * @returns {void}
 */
export function finish(conn: PGconn): void {
	ffi.PQfinish(conn)
}

/**
 * Force-flush any queued output data to the server.
 *
 * **Differs from C:** throws instead of returning `-1`. Still returns 0 or 1.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQFLUSH | PQflush}
 * @param {PGconn} conn - Connection
 * @returns {number} 1 if unable to send all data yet, 0 if flushed
 * @throws {Error} When flush fails
 */
export function flush(conn: PGconn): number {
	const result = ffi.PQflush(conn)
	if (result === -1) {
		throw new Error(errorMessage(conn))
	}
	return result
}

/**
 * Returns the column name associated with the given column number.
 *
 * **Differs from C:** throws instead of returning `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFNAME | PQfname}
 * @param {PGresult} res - Result
 * @param {number} columnNumber - The column number (0-based)
 * @returns {string} The column name
 * @throws {Error} When column number is invalid or result is null
 */
export function fname(res: PGresult, columnNumber: number): string {
	const r = ffi.PQfname(res, columnNumber)
	if (r !== null) {
		return new Deno.UnsafePointerView(r).getCString()
	} else {
		throw new Error('PQfname: Unexpected null value returned from database')
	}
}

/**
 * Returns the column number associated with the given column name.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFNUMBER | PQfnumber}
 * @param {PGresult} res - Result
 * @param {string} columnName - The column name to look up
 * @returns {number} The column number (0-based) or -1 if not found
 */
export function fnumber(res: PGresult, columnName: string): number {
	const column = encodeTerminated(columnName)
	return ffi.PQfnumber(res, column)
}

/**
 * Tests a field for a null value. Row and column numbers start at 0.
 *
 * **Differs from C:** returns a boolean instead of 1 or 0.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQGETISNULL | PQgetisnull}
 * @param {PGresult} res - Result
 * @param {number} rowNumber - The row number (0-based)
 * @param {number} columnNumber - The column number (0-based)
 * @returns {boolean} true when field is null, false otherwise
 */
export function getisnull(
	res: PGresult,
	rowNumber: number,
	columnNumber: number,
): boolean {
	const r = ffi.PQgetisnull(res, rowNumber, columnNumber)

	return r === 0 ? false : true
}

/**
 * Waits for and returns the next result available on a connection.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQGETRESULT | PQgetResult}
 * @param {PGconn} conn - Connection
 * @returns {PGresult | null} Next result, or null when no more results.
 * Caller must {@linkcode clear} a non-null result.
 */
export function getResult(conn: PGconn): PGresult | null {
	return ffi.PQgetResult(conn)
}

/**
 * Returns a single field value of one row of a PGresult. Row and column
 * numbers start at 0.
 *
 * **Differs from C:** returns `string`, `ArrayBuffer`, or `null` instead of
 * `char*`. SQL NULL is JavaScript `null`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQGETVALUE | PQgetvalue}
 * @param {PGresult} res - Result
 * @param {number} rowNumber - The row number (0-based)
 * @param {number} columnNumber - The column number (0-based)
 * @returns {string | ArrayBuffer | null} String for text values, ArrayBuffer for binary values, null for NULL values
 * @throws {Error} When field access fails
 */
export function getvalue(
	res: PGresult,
	rowNumber: number,
	columnNumber: number,
): string | ArrayBuffer | null {
	if (getisnull(res, rowNumber, columnNumber)) {
		return null
	}

	const r = ffi.PQgetvalue(res, rowNumber, columnNumber)
	if (r !== null) {
		const view = new Deno.UnsafePointerView(r)
		const format = fformat(res, columnNumber)

		switch (format) {
			case 0:
				return view.getCString()
			case 1: {
				const length = ffi.PQgetlength(res, rowNumber, columnNumber)
				return view.getArrayBuffer(length)
			}
			default: {
				throw new Error(
					`PQgetvalue: Unknown format value ${format} returned from database`,
				)
			}
		}
	} else {
		throw new Error(
			'PQgetvalue: Unexpected null value returned from database',
		)
	}
}

/**
 * Test whether a command is busy (would getResult block?).
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQISBUSY | PQisBusy}
 * @param {PGconn} conn - Connection
 * @returns {number} 1 if busy (would block), 0 if ready
 */
export function isBusy(conn: PGconn): number {
	return ffi.PQisBusy(conn)
}

/**
 * Test the nonblocking status of the connection.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQISNONBLOCKING | PQisnonblocking}
 * @param {PGconn} conn - Connection
 * @returns {number} 1 if nonblocking, 0 if blocking
 */
export function isnonblocking(conn: PGconn): number {
	return ffi.PQisnonblocking(conn)
}

/**
 * Set libpq nonblocking mode on the connection.
 *
 * **Differs from C:** takes a boolean instead of 1 or 0. Throws instead of
 * returning `-1`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSETNONBLOCKING | PQsetnonblocking}
 * @param {PGconn} conn - Connection
 * @param {boolean} nonblocking - true for nonblocking, false for blocking
 * @returns {void}
 * @throws {Error} When setting the mode fails
 */
export function setnonblocking(conn: PGconn, nonblocking: boolean): void {
	const result = ffi.PQsetnonblocking(conn, nonblocking ? 1 : 0)
	if (result !== 0) {
		throw new Error(errorMessage(conn))
	}
}

/**
 * File descriptor of the connection socket, or -1 if no connection.
 * The descriptor can change across connectPoll calls; re-read it each time.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQSOCKET | PQsocket}
 * @param {PGconn} conn - Connection
 * @returns {number} Socket file descriptor
 */
export function socket(conn: PGconn): number {
	return ffi.PQsocket(conn)
}

/**
 * Wait until the socket is readable and/or writable using PQsocketPoll.
 *
 * This is still libpq's poll/select. Deno FFI `nonblocking: true` only moves
 * that wait off the JavaScript thread so the isolate is not frozen.
 * C return values (`>0` ready, `0` timeout, `-1` error) are unchanged.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQSOCKETPOLL | PQsocketPoll}
 * @param {number} sock - File descriptor from socket()
 * @param {boolean} forRead - Wait for read-ready
 * @param {boolean} forWrite - Wait for write-ready
 * @param {bigint} endTime - Absolute deadline from PQgetCurrentTimeUSec, or -1n for infinite
 * @returns {Promise<number>} >0 ready, 0 timeout, -1 error
 */
export async function socketPoll(
	sock: number,
	forRead: boolean,
	forWrite: boolean,
	endTime: bigint,
): Promise<number> {
	return await ffi.PQsocketPollAsync(
		sock,
		forRead ? 1 : 0,
		forWrite ? 1 : 0,
		endTime,
	)
}

/**
 * Current time in microseconds since the Unix epoch, as PQsocketPoll expects.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-misc.html#LIBPQ-PQGETCURRENTTIMEUSEC | PQgetCurrentTimeUSec}
 * @returns {bigint} Microseconds since the Unix epoch
 */
export function getCurrentTimeUSec(): bigint {
	return ffi.PQgetCurrentTimeUSec()
}

/**
 * Extract the number of fields (columns) from a PGResult.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQNFIELDS | PQnfields}
 * @param {PGresult} res - Result
 * @returns {number} The number of fields (columns) in the query result
 */
export function nfields(res: PGresult): number {
	return ffi.PQnfields(res)
}

/**
 * Get the number of parameters in a prepared statement result.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQNPARAMS | PQnparams}
 * @param {PGresult} res - Result
 * @returns {number} The number of parameters
 */
export function nparams(res: PGresult): number {
	return ffi.PQnparams(res)
}

/**
 * Submit a request to obtain information about a prepared statement.
 *
 * **Differs from C:** throws instead of returning `NULL` on connection-level
 * failure.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQDESCRIBEPREPARED | PQdescribePrepared}
 * @param {PGconn} conn - Connection
 * @param {string} [stmtName=''] - Name of the prepared statement to describe
 * @returns {PGresult} Statement metadata. Caller must {@linkcode clear} it.
 * @throws {Error} When the describe request fails at connection level
 */
export function describePrepared(
	conn: PGconn,
	stmtName: string = '',
): PGresult {
	const res = ffi.PQdescribePrepared(conn, encodeTerminated(stmtName))

	if (res !== null) {
		return res
	} else {
		const msg = errorMessage(conn)
		throw new Error(msg)
	}
}

/**
 * Extract the number of rows (tuples) from a PGResult.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQNTUPLES | PQntuples}
 * @param {PGresult} res - Result
 * @returns {number} The number of rows (tuples) in the query result
 */
export function ntuples(res: PGresult): number {
	return ffi.PQntuples(res)
}

/**
 * Prepares a statement for execution.
 *
 * **Differs from C:** throws instead of returning `NULL` on connection-level
 * failure. SQL errors still return a `PGresult`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQPREPARE | PQprepare}
 * @param {PGconn} conn - Connection
 * @param {string} query - SQL to prepare
 * @param {string} [stmtName=''] - Name to assign. Empty creates an unnamed statement
 * @returns {PGresult} Prepare result. Caller must {@linkcode clear} it.
 * @throws {Error} When preparation fails at connection level
 */
export function prepare(
	conn: PGconn,
	query: string,
	stmtName: string = '',
): PGresult {
	const res = ffi.PQprepare(
		conn,
		encodeTerminated(stmtName),
		encodeTerminated(query),
		0,
		null,
	)

	if (res !== null) {
		return res
	} else {
		const msg = errorMessage(conn)
		throw new Error(msg)
	}
}

/**
 * Queries a connection for its polling status. Use after {@linkcode resetStart}.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESETSTART | PQresetPoll}
 * @param {PGconn} conn - Connection
 * @returns {PostgresPollingStatusType} Polling status - caller handles different states
 */
export function resetPoll(conn: PGconn): PostgresPollingStatusType {
	return ffi.PQresetPoll(conn)
}

/**
 * Begin a poll-protocol connection reset. Complete it with {@linkcode resetPoll}.
 *
 * **Differs from C:** throws instead of returning 0 on failure.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESETSTART | PQresetStart}
 * @param {PGconn} conn - Connection
 * @returns {void}
 * @throws {Error} When the reset cannot be started
 */
export function resetStart(conn: PGconn): void {
	const result = ffi.PQresetStart(conn)
	if (result === 0) {
		throw new Error(errorMessage(conn))
	}
}

/**
 * Converts the enumerated type returned by resultStatus into a string
 * constant describing the status code.
 *
 * **Differs from C:** throws instead of returning `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESSTATUS | PQresStatus}
 * @param {ExecStatusType} status - The status code to convert
 * @returns {string} The status code as a string
 * @throws {Error} When status conversion fails
 */
export function resStatus(status: ExecStatusType): string {
	const s = ffi.PQresStatus(status)

	if (s !== null) {
		const r = new Deno.UnsafePointerView(s)
		return r.getCString()
	} else {
		throw new Error(
			'PQresStatus: Unexpected null value returned from database',
		)
	}
}

/**
 * Get the error message associated with a result.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTERRORMESSAGE | PQresultErrorMessage}
 * @param {PGresult} res - Result
 * @returns {string} The error message, or empty string if no error
 */
export function resultErrorMessage(res: PGresult): string {
	const err = ffi.PQresultErrorMessage(res)

	if (err !== null) {
		const msg = new Deno.UnsafePointerView(err).getCString()
		return msg
	} else {
		return ''
	}
}

/**
 * Get a specific error field from a result.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTERRORFIELD | PQresultErrorField}
 * @param {PGresult} res - Result
 * @param {PGDiag} fieldcode - The error field code (use PGDiag enum)
 * @returns {string | null} The error field value, or null if not available
 */
export function resultErrorField(
	res: PGresult,
	fieldcode: PGDiag,
): string | null {
	const field = ffi.PQresultErrorField(res, fieldcode)

	return field !== null ? new Deno.UnsafePointerView(field).getCString() : null
}

/**
 * Get the execution status of a PGResult.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTSTATUS | PQresultStatus}
 * @param {PGresult} res - Result
 * @returns {ExecStatusType} The status of the result
 */
export function resultStatus(res: PGresult): ExecStatusType {
	return ffi.PQresultStatus(res)
}

/**
 * Get a verbose error message associated with a result.
 *
 * **Differs from C:** calls `PQfreemem` on the allocated message.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTVERBOSEERRORMESSAGE | PQresultVerboseErrorMessage}
 * @param {PGresult} res - Result
 * @param {PGVerbosity} verbosity - The verbosity level of the error message
 * @param {PGContextVisibility} showContext - Whether to show context information
 * @returns {string | null} Verbose error message, or null if none. The caller does not free C memory.
 */
export function resultVerboseErrorMessage(
	res: PGresult,
	verbosity: PGVerbosity,
	showContext: PGContextVisibility,
): string | null {
	const err = ffi.PQresultVerboseErrorMessage(res, verbosity, showContext)

	if (err !== null) {
		const msg = new Deno.UnsafePointerView(err).getCString()
		ffi.PQfreemem(err)
		return msg
	} else {
		return null
	}
}

/**
 * Send a prepare command to the server without waiting for the result.
 *
 * **Differs from C:** throws instead of returning 0.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDPREPARE | PQsendPrepare}
 * @param {PGconn} conn - Connection
 * @param {string} query - SQL to prepare
 * @param {string} [stmtName=''] - Name to assign. Empty creates an unnamed statement
 * @returns {void}
 * @throws {Error} When sending the prepare fails
 */
export function sendPrepare(
	conn: PGconn,
	query: string,
	stmtName: string = '',
): void {
	const result = ffi.PQsendPrepare(
		conn,
		encodeTerminated(stmtName),
		encodeTerminated(query),
		0, // nParams
		null, // paramTypes
	)

	if (result === 0) {
		throw new Error(errorMessage(conn))
	}
}

/**
 * Send a query command to the server without waiting for the result.
 *
 * **Differs from C:** throws instead of returning 0.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDQUERY | PQsendQuery}
 * @param {PGconn} conn - Connection
 * @param {string} command - SQL to send
 * @returns {void}
 * @throws {Error} When sending the query fails
 */
export function sendQuery(conn: PGconn, command: string): void {
	const result = ffi.PQsendQuery(conn, encodeTerminated(command))
	if (result === 0) {
		throw new Error(errorMessage(conn))
	}
}

/**
 * Send a parameterized query command to the server without waiting for the result.
 *
 * **Differs from C:** throws instead of returning 0.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDQUERYPARAMS | PQsendQueryParams}
 * @param {PGconn} conn - Connection
 * @param {string} command - SQL to send
 * @param {Array<string | null>} [params] - Query parameters. `null` is SQL NULL
 * @returns {void}
 * @throws {Error} When sending the query fails
 */
export function sendQueryParams(
	conn: PGconn,
	command: string,
	params?: Array<string | null>,
): void {
	let nParams: number
	let paramValues: Uint8Array<ArrayBuffer> | null

	if (params === undefined) {
		nParams = 0
		paramValues = null
	} else {
		nParams = params.length
		paramValues = encodeTerminatedArray(params)
	}

	const result = ffi.PQsendQueryParams(
		conn,
		encodeTerminated(command),
		nParams,
		null, // paramTypes
		paramValues,
		null, // paramLengths
		null, // paramFormats
		0, // resultFormat
	)

	if (result === 0) {
		throw new Error(errorMessage(conn))
	}
}

/**
 * Send execution of a prepared statement without waiting for the result.
 *
 * **Differs from C:** throws instead of returning 0.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDQUERYPREPARED | PQsendQueryPrepared}
 * @param {PGconn} conn - Connection
 * @param {Array<string | null>} [params] - Statement parameters. `null` is SQL NULL
 * @param {string} [stmtName=''] - Prepared statement name. Empty is the unnamed statement
 * @returns {void}
 * @throws {Error} When sending the execution fails
 */
export function sendQueryPrepared(
	conn: PGconn,
	params?: Array<string | null>,
	stmtName: string = '',
): void {
	let nParams: number
	let paramValues: Uint8Array<ArrayBuffer> | null

	if (params === undefined) {
		nParams = 0
		paramValues = null
	} else {
		nParams = params.length
		paramValues = encodeTerminatedArray(params)
	}

	const result = ffi.PQsendQueryPrepared(
		conn,
		encodeTerminated(stmtName),
		nParams,
		paramValues,
		null, // paramLengths
		null, // paramFormats
		0, // resultFormat
	)

	if (result === 0) {
		throw new Error(errorMessage(conn))
	}
}

/**
 * Get the status of the connection.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQSTATUS | PQstatus}
 * @param {PGconn} conn - Connection
 * @returns {ConnStatusType} The status of the connection
 */
export function status(conn: PGconn): ConnStatusType {
	return ffi.PQstatus(conn)
}

/**
 * Test server connectivity using connection string.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQPING | PQping}
 * @param {string | URL | ConnectOptions} [conninfo] - Connection string,
 * URL, or {@linkcode ConnectOptions}. When omitted, `PGURL` and libpq
 * defaults are used.
 * @returns {PGPing} Status indicating server availability
 */
export function ping(
	conninfo?: string | URL | ConnectOptions,
): PGPing {
	conninfo = resolveConninfo(conninfo)
	return ffi.PQping(encodeTerminated(conninfo))
}

/**
 * Reset the connection to the server synchronously.
 *
 * Does not inspect {@linkcode status} afterward. Check `status(conn)` if you
 * need to know whether the reset succeeded.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESET | PQreset}
 * @param {PGconn} conn - Connection
 * @returns {void}
 */
export function reset(conn: PGconn): void {
	ffi.PQreset(conn)
}

/**
 * Check for pending notifications from the server.
 *
 * **Differs from C:** returns a JavaScript object and calls `PQfreemem` on
 * the `PGnotify` pointer. The caller does not free the C struct.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-notify.html#LIBPQ-PQNOTIFIES | PQnotifies}
 * @param {PGconn} conn - Connection
 * @returns {Notify | null} Next notification, or null if none. The caller does not free C memory.
 */
export function notifies(conn: PGconn): Notify | null {
	const pgNotify = ffi.PQnotifies(conn)

	if (pgNotify !== null) {
		// PGnotify on the supported 64-bit ABI: relname at 0, int be_pid at 8,
		// four padding bytes, then extra at 16. Copy before freeing the struct.
		const view = new Deno.UnsafePointerView(pgNotify!)
		const relname = new Deno.UnsafePointerView(view.getPointer()!)
			.getCString()
		const bePid = view.getInt32(8)
		const extra = new Deno.UnsafePointerView(view.getPointer(16)!)
			.getCString()

		ffi.PQfreemem(pgNotify)

		return { relname, bePid, extra }
	} else {
		return null
	}
}

/**
 * Get the error message from the connection.
 *
 * **Differs from C:** throws if the C pointer is `NULL`.
 *
 * @tags libpq-deviation
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQERRORMESSAGE | PQerrorMessage}
 * @param {PGconn} conn - Connection
 * @returns {string} The error message
 * @throws {Error} When no error message is available
 */
export function errorMessage(conn: PGconn): string {
	const err = ffi.PQerrorMessage(conn)

	if (err !== null) {
		const msg = new Deno.UnsafePointerView(err).getCString()
		return msg
	} else {
		throw new Error('No error message available in the connection')
	}
}
