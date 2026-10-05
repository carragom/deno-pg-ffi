/**
 * Raw bindings to PostgreSQL's C libpq API.
 *
 * Using this module requires understanding libpq's connection and query
 * lifecycle, return codes, and memory ownership rules. Start with the
 * [PostgreSQL libpq
 * documentation](https://www.postgresql.org/docs/17/libpq.html); it is the
 * reference for the underlying API. These bindings preserve its behavior and
 * expose native pointers through Deno FFI.
 *
 * For managed connections, results, value conversion, and pooling, use
 * {@linkcode Client} and {@linkcode Pool} from the package's default entry
 * point.
 *
 * ## Imports
 *
 * This module exports named `PQ*` functions, pointer types, and C enums. Import
 * individual functions or use a namespace import:
 *
 * ```ts ignore
 * import { PQconnectdb, PQfinish } from '@carragom/deno-pg-ffi/libpq'
 * // Or:
 * import * as libpq from '@carragom/deno-pg-ffi/libpq'
 * ```
 *
 * ## Pointers and ownership
 *
 * C NULL pointers are JavaScript `null`; return codes remain numeric. A
 * non-null {@linkcode PGconn} can have
 * {@linkcode ConnStatusType.CONNECTION_BAD}. SQL failures normally return a
 * {@linkcode PGresult} with an error status; inspect it with
 * {@linkcode PQresultStatus}. Callers check return values, copy diagnostics,
 * and release native allocations themselves.
 *
 * C string inputs are null-terminated UTF-8 buffers. Parameter pointer arrays
 * contain native addresses; their backing storage and the buffers they point to
 * must remain alive through the call. Results are raw pointers, with no result
 * conversion. `Deno.UnsafePointerView.getCString()` copies text;
 * `Deno.UnsafePointerView.getArrayBuffer()` borrows native memory, which must
 * remain alive while the buffer is used.
 *
 * Release connections with {@linkcode PQfinish}, results with
 * {@linkcode PQclear}, cancel handles with {@linkcode PQfreeCancel}, and
 * allocated notifications/escaped strings with {@linkcode PQfreemem}.
 * Connection option arrays use {@linkcode PQconninfoFree}. Borrowed pointers
 * such as {@linkcode PQgetvalue} belong to their result and must not be freed
 * separately. Each function documents its ownership rules. A
 * {@linkcode PGresult} remains valid after its connection is finished, until
 * the result itself is cleared.
 *
 * ## Blocking and asynchronous calls
 *
 * {@linkcode PQconnectdb} and {@linkcode PQexec} block the JavaScript thread. A
 * custom asynchronous client can use
 * {@linkcode PQconnectStart}/{@linkcode PQconnectPoll} and libpq's
 * [asynchronous command
 * protocol](https://www.postgresql.org/docs/17/libpq-async.html). Names ending
 * in `Async` are Deno-specific FFI aliases that execute the same C functions
 * off the JavaScript thread; they do not change libpq's protocol or manage
 * native handles. Keep handles and referenced buffers alive until their
 * Promises settle. Serialize operations on each connection, and do not release
 * a handle while a pending call is using it.
 *
 * ## Loading and permissions
 *
 * Importing this module eagerly loads libpq 17+. Set `DENO_LIBPQ_PATH` to a
 * compatible library, or let the loader fetch a packaged binary from JSR (the
 * matching GitHub release for a source checkout). Requires `--allow-ffi` and
 * `--allow-env` for loader settings and the example's `PGURL` lookup. Downloads
 * also need `--allow-net`, `--allow-read`, and `--allow-write` for the library
 * cache. libpq reads its own `PG*` variables and `.pgpass` and opens database
 * sockets through FFI, outside Deno's file/network checks.
 *
 * @module
 *
 * @example Connect, execute a text query, copy rows, and release native handles
 * ```ts
 * import {
 *   ConnStatusType,
 *   ExecStatusType,
 *   PQclear,
 *   PQconnectdb,
 *   PQerrorMessage,
 *   PQexec,
 *   PQfinish,
 *   PQfname,
 *   PQgetisnull,
 *   PQgetvalue,
 *   PQnfields,
 *   PQntuples,
 *   PQresultErrorMessage,
 *   PQresultStatus,
 *   PQstatus,
 * } from '@carragom/deno-pg-ffi/libpq'
 *
 * const encoder = new TextEncoder()
 * const cString = (value: string) => encoder.encode(value + '\0')
 * const readString = (pointer: Deno.PointerValue): string =>
 *   pointer === null ? '' : new Deno.UnsafePointerView(pointer).getCString()
 *
 * const conn = PQconnectdb(cString(Deno.env.get('PGURL') ?? ''))
 * if (conn === null) throw new Error('Could not allocate a connection')
 *
 * try {
 *   if (PQstatus(conn) !== ConnStatusType.CONNECTION_OK) {
 *     throw new Error(readString(PQerrorMessage(conn)))
 *   }
 *
 *   const result = PQexec(
 *     conn,
 *     cString('SELECT 42::int4 AS answer, NULL::text AS missing'),
 *   )
 *   if (result === null) {
 *     throw new Error(readString(PQerrorMessage(conn)))
 *   }
 *
 *   try {
 *     if (PQresultStatus(result) !== ExecStatusType.PGRES_TUPLES_OK) {
 *       throw new Error(readString(PQresultErrorMessage(result)))
 *     }
 *
 *     const rows: Record<string, string | null>[] = []
 *     for (let row = 0; row < PQntuples(result); row++) {
 *       const values: Record<string, string | null> = {}
 *       for (let col = 0; col < PQnfields(result); col++) {
 *         const name = readString(PQfname(result, col))
 *         values[name] = PQgetisnull(result, row, col)
 *           ? null
 *           : readString(PQgetvalue(result, row, col))
 *       }
 *       rows.push(values)
 *     }
 *     if (rows[0].answer !== '42' || rows[0].missing !== null) {
 *       throw new Error('Unexpected raw query result')
 *     }
 *     console.log(rows) // [ { answer: '42', missing: null } ]
 *   } finally {
 *     PQclear(result)
 *   }
 * } finally {
 *   PQfinish(conn)
 * }
 * ```
 */
import { ffi } from './native/load.ts'
import type { PGconn } from './native/types.ts'

/**
 * Return the backend process ID for conn, or 0 if it is not connected.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQBACKENDPID | PQbackendPID}
 */
export const PQbackendPID: (conn: Deno.PointerObject) => number =
	ffi.PQbackendPID

/**
 * Return 1 when every result column is binary, otherwise 0. Use
 * {@linkcode PQfformat} for individual columns.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQBINARYTUPLES | PQbinaryTuples}
 */
export const PQbinaryTuples: (res: Deno.PointerObject) => number =
	ffi.PQbinaryTuples

/**
 * Request cancellation using a {@linkcode PGcancel} handle. Return 1 if sent,
 * or 0 on failure and write a null-terminated message into errbuf (errbufsize
 * bytes). The handle remains owned by the caller.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-cancel.html#LIBPQ-PQCANCEL | PQcancel}
 */
export const PQcancel: (
	cancel: Deno.PointerObject,
	errbuf: BufferSource,
	errbufsize: number,
) => number = ffi.PQcancel

/**
 * Free a caller-owned {@linkcode PGresult} and all its borrowed
 * field/diagnostic pointers. Do not clear the same result twice.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQCLEAR | PQclear}
 */
export const PQclear: (res: Deno.PointerObject) => void = ffi.PQclear

/**
 * Return a borrowed null-terminated command tag, such as SELECT 2. The pointer
 * belongs to res and must not be freed separately.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQCMDSTATUS | PQcmdStatus}
 */
export const PQcmdStatus: (res: Deno.PointerObject) => Deno.PointerValue =
	ffi.PQcmdStatus

/**
 * Return a borrowed decimal count string, or an empty string if the command has
 * no count. Includes SELECT counts; it does not identify rows written. The
 * pointer belongs to res.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQCMDTUPLES | PQcmdTuples}
 */
export const PQcmdTuples: (res: Deno.PointerObject) => Deno.PointerValue =
	ffi.PQcmdTuples

/**
 * Open a blocking connection from null-terminated conninfo bytes. Return a
 * {@linkcode PGconn} that must be released with {@linkcode PQfinish}, or NULL
 * on allocation failure. Even a non-null handle may have CONNECTION_BAD; check
 * {@linkcode PQstatus}.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTDB | PQconnectdb}
 */
export const PQconnectdb: (conninfo: BufferSource) => Deno.PointerValue =
	ffi.PQconnectdb

/**
 * Deno FFI alias of {@linkcode PQconnectdb}, executed off the JavaScript
 * thread. Resolve to the same C return value with the same ownership and error
 * rules. Keep referenced input/output buffers and pointers alive until the
 * Promise settles.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTDB | PQconnectdb}
 */
export const PQconnectdbAsync: (
	conninfo: BufferSource,
) => Promise<Deno.PointerValue> = ffi.PQconnectdbAsync

/**
 * Advance a connection started by {@linkcode PQconnectStart}. Return
 * {@linkcode PostgresPollingStatusType}; wait for socket readiness before
 * polling again. Does not release the connection on failure.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTSTARTPARAMS | PQconnectPoll}
 */
export const PQconnectPoll: (conn: Deno.PointerObject) => number =
	ffi.PQconnectPoll

/**
 * Start a poll-protocol connection from null-terminated conninfo bytes. Return
 * a caller-owned {@linkcode PGconn}, or NULL on allocation failure. Check
 * {@linkcode PQstatus}, drive {@linkcode PQconnectPoll}, and eventually call
 * {@linkcode PQfinish}.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTSTARTPARAMS | PQconnectStart}
 */
export const PQconnectStart: (conninfo: BufferSource) => Deno.PointerValue =
	ffi.PQconnectStart

/**
 * Allocate the connection's current PQconninfoOption array, or return NULL on
 * allocation failure. Its strings belong to that array. Release the whole
 * allocation with {@linkcode PQconninfoFree}.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNINFO | PQconninfo}
 */
export const PQconninfo: (conn: PGconn) => Deno.PointerValue = ffi.PQconninfo

/**
 * Free a PQconninfoOption array and its strings. Use this for
 * {@linkcode PQconninfo} allocations rather than {@linkcode PQfreemem}.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-misc.html#LIBPQ-PQCONNINFOFREE | PQconninfoFree}
 */
export const PQconninfoFree: (options: Deno.PointerObject) => void =
	ffi.PQconninfoFree

/**
 * Read available input into libpq's buffers without waiting for a full command
 * result. Return 1 on success or 0 on failure; read {@linkcode PQerrorMessage}
 * for details.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQCONSUMEINPUT | PQconsumeInput}
 */
export const PQconsumeInput: (conn: Deno.PointerObject) => number =
	ffi.PQconsumeInput

/**
 * Return a borrowed null-terminated connection database name. It belongs to
 * conn and must not be freed separately.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQDB | PQdb}
 */
export const PQdb: (conn: Deno.PointerObject) => Deno.PointerValue = ffi.PQdb

/**
 * Describe the null-terminated stmt name using a blocking call. Return a
 * caller-owned {@linkcode PGresult} to release with {@linkcode PQclear}, or
 * NULL on connection/allocation failure. Check {@linkcode PQresultStatus} for
 * errors.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQDESCRIBEPREPARED | PQdescribePrepared}
 */
export const PQdescribePrepared: (
	conn: Deno.PointerObject,
	stmt: BufferSource,
) => Deno.PointerValue = ffi.PQdescribePrepared

/**
 * Return a borrowed null-terminated connection error string, possibly empty.
 * Copy it before later libpq calls replace it or {@linkcode PQfinish} frees
 * conn. Do not free this pointer.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQERRORMESSAGE | PQerrorMessage}
 */
export const PQerrorMessage: (conn: Deno.PointerObject) => Deno.PointerValue =
	ffi.PQerrorMessage

/**
 * Escape len bytes of str as an SQL identifier. Return an allocated
 * null-terminated string to release with {@linkcode PQfreemem}, or NULL on
 * failure. len excludes any terminator.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQESCAPEIDENTIFIER | PQescapeIdentifier}
 */
export const PQescapeIdentifier: (
	conn: Deno.PointerObject,
	str: BufferSource,
	len: bigint,
) => Deno.PointerValue = ffi.PQescapeIdentifier

/**
 * Escape len bytes of str as an SQL literal. Return an allocated
 * null-terminated string to release with {@linkcode PQfreemem}, or NULL on
 * failure. len excludes any terminator.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQESCAPELITERAL | PQescapeLiteral}
 */
export const PQescapeLiteral: (
	conn: Deno.PointerObject,
	str: BufferSource,
	len: bigint,
) => Deno.PointerValue = ffi.PQescapeLiteral

/**
 * Execute null-terminated SQL synchronously. For multiple statements, return
 * only the last {@linkcode PGresult}. Release non-null results with
 * {@linkcode PQclear}. SQL errors are result statuses; NULL indicates failure
 * to produce a result.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXEC | PQexec}
 */
export const PQexec: (
	conn: Deno.PointerObject,
	query: BufferSource,
) => Deno.PointerValue = ffi.PQexec

/**
 * Deno FFI alias of {@linkcode PQexec}, executed off the JavaScript thread.
 * Resolve to the same C return value with the same ownership and error rules.
 * Keep referenced input/output buffers and pointers alive until the Promise
 * settles.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXEC | PQexec}
 */
export const PQexecAsync: (
	conn: Deno.PointerObject,
	query: BufferSource,
) => Promise<Deno.PointerValue> = ffi.PQexecAsync

/**
 * Execute one parameterized statement synchronously. Return a caller-owned
 * {@linkcode PGresult} to release with {@linkcode PQclear}, or NULL if no
 * result could be produced. Inspect {@linkcode PQresultStatus} for SQL errors.
 *
 * @param conn Connection to execute the statement on.
 * @param command Null-terminated SQL containing `$1`, `$2`, etc. placeholders.
 * @param nParams Number of entries in the parameter arrays.
 * @param paramTypes Pointer to an array of PostgreSQL type OIDs, or null to let
 * PostgreSQL infer them. A zero OID requests inference for that parameter.
 * @param paramValues Buffer containing an array of native `char*` pointers, or
 * null when there are no parameters. A NULL entry represents SQL NULL; text
 * entries point to null-terminated buffers. Keep both the pointer array and
 * each referenced buffer alive through the call.
 * @param paramLengths Pointer to an array of byte lengths for binary
 * parameters. Ignored for text parameters; may be null when all are text.
 * @param paramFormats Pointer to an array of formats: 0 for text, 1 for binary.
 * A null pointer selects text for every parameter.
 * @param resultFormat Format for every result column: 0 for text, 1 for binary.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXECPARAMS | PQexecParams}
 */
export const PQexecParams: (
	conn: Deno.PointerObject,
	command: BufferSource,
	nParams: number,
	paramTypes: Deno.PointerValue,
	paramValues: BufferSource | null,
	paramLengths: Deno.PointerValue,
	paramFormats: Deno.PointerValue,
	resultFormat: number,
) => Deno.PointerValue = ffi.PQexecParams

/**
 * Deno FFI alias of {@linkcode PQexecParams}, executed off the JavaScript
 * thread. Resolve to the same C return value with the same ownership and error
 * rules. Keep referenced input/output buffers and pointers alive until the
 * Promise settles.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXECPARAMS | PQexecParams}
 */
export const PQexecParamsAsync: (
	conn: Deno.PointerObject,
	command: BufferSource,
	nParams: number,
	paramTypes: Deno.PointerValue,
	paramValues: BufferSource | null,
	paramLengths: Deno.PointerValue,
	paramFormats: Deno.PointerValue,
	resultFormat: number,
) => Promise<Deno.PointerValue> = ffi.PQexecParamsAsync

/**
 * Execute a prepared statement synchronously using a null-terminated stmtName.
 * Parameter pointers and format/length arrays follow {@linkcode PQexecParams};
 * resultFormat selects text (0) or binary (1). Return a {@linkcode PGresult} to
 * release with {@linkcode PQclear}, or NULL; inspect its status for SQL errors.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXECPREPARED | PQexecPrepared}
 */
export const PQexecPrepared: (
	conn: Deno.PointerObject,
	stmtName: BufferSource,
	nParams: number,
	paramValues: BufferSource | null,
	paramLengths: Deno.PointerValue,
	paramFormats: Deno.PointerValue,
	resultFormat: number,
) => Deno.PointerValue = ffi.PQexecPrepared

/**
 * Deno FFI alias of {@linkcode PQexecPrepared}, executed off the JavaScript
 * thread. Resolve to the same C return value with the same ownership and error
 * rules. Keep referenced input/output buffers and pointers alive until the
 * Promise settles.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXECPREPARED | PQexecPrepared}
 */
export const PQexecPreparedAsync: (
	conn: Deno.PointerObject,
	stmtName: BufferSource,
	nParams: number,
	paramValues: BufferSource | null,
	paramLengths: Deno.PointerValue,
	paramFormats: Deno.PointerValue,
	resultFormat: number,
) => Promise<Deno.PointerValue> = ffi.PQexecPreparedAsync

/**
 * Return the column format: 0 for text or 1 for binary. field_num is
 * zero-based.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-copy.html#LIBPQ-PQFFORMAT-1 | PQfformat}
 */
export const PQfformat: (res: Deno.PointerObject, field_num: number) => number =
	ffi.PQfformat

/**
 * Close and free a caller-owned {@linkcode PGconn}. All connection-owned
 * pointers become invalid. Outstanding PGresults remain independently owned. Do
 * not finish twice or while another call is using the handle.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQFINISH | PQfinish}
 */
export const PQfinish: (conn: Deno.PointerObject) => void = ffi.PQfinish

/**
 * Deno FFI alias of {@linkcode PQfinish}, executed off the JavaScript thread.
 * Resolve to the same C return value with the same ownership and error rules.
 * Keep referenced input/output buffers and pointers alive until the Promise
 * settles.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQFINISH | PQfinish}
 */
export const PQfinishAsync: (conn: Deno.PointerObject) => Promise<void> =
	ffi.PQfinishAsync

/**
 * Try to send buffered output. Return 0 when fully sent, 1 if output remains,
 * or -1 on error. In nonblocking mode, wait for readiness and retry when output
 * remains.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQFLUSH | PQflush}
 */
export const PQflush: (conn: Deno.PointerObject) => number = ffi.PQflush

/**
 * Return the zero-based column's PostgreSQL type modifier, or -1 when
 * unavailable. Interpretation depends on the type.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFMOD | PQfmod}
 */
export const PQfmod: (res: Deno.PointerObject, field_num: number) => number =
	ffi.PQfmod

/**
 * Return a borrowed null-terminated column name, or NULL for an invalid
 * zero-based column. The pointer belongs to res.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFNAME | PQfname}
 */
export const PQfname: (
	res: Deno.PointerObject,
	field_num: number,
) => Deno.PointerValue = ffi.PQfname

/**
 * Look up a column by a null-terminated name. Return its zero-based index, or
 * -1 if absent; unquoted names are folded to lower case.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFNUMBER | PQfnumber}
 */
export const PQfnumber: (
	res: Deno.PointerObject,
	field_name: BufferSource,
) => number = ffi.PQfnumber

/**
 * Free a caller-owned {@linkcode PGcancel} created by {@linkcode PQgetCancel}.
 * Do not use or free the handle again.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-cancel.html#LIBPQ-PQFREECANCEL | PQfreeCancel}
 */
export const PQfreeCancel: (cancel: Deno.PointerObject) => void =
	ffi.PQfreeCancel

/**
 * Free memory allocated by libpq APIs such as {@linkcode PQescapeLiteral},
 * {@linkcode PQnotifies}, or {@linkcode PQunescapeBytea}. Do not use this on
 * borrowed connection/result pointers, {@linkcode PGconn},
 * {@linkcode PGresult}, or PQconninfoOption arrays.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-misc.html#LIBPQ-PQFREEMEM | PQfreemem}
 */
export const PQfreemem: (ptr: Deno.PointerValue) => void = ffi.PQfreemem

/**
 * Decode null-terminated bytea text. Return allocated bytes or NULL on
 * allocation failure; write their length to the size_t pointed to by retbuflen.
 * Copy or consume the bytes before releasing them with {@linkcode PQfreemem}.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQUNESCAPEBYTEA | PQunescapeBytea}
 */
export const PQunescapeBytea: (
	strtext: BufferSource,
	retbuflen: Deno.PointerValue,
) => Deno.PointerValue = ffi.PQunescapeBytea

/**
 * Return the zero-based column's fixed type size in bytes, or -1 for a
 * variable-length type. This is not a particular value's byte length.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFSIZE | PQfsize}
 */
export const PQfsize: (res: Deno.PointerObject, field_num: number) => number =
	ffi.PQfsize

/**
 * Return the source table OID for a zero-based result column, or 0 if the
 * column is not identifiable as a table column.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFTABLE | PQftable}
 */
export const PQftable: (res: Deno.PointerObject, field_num: number) => number =
	ffi.PQftable

/**
 * Return the source table's one-based attribute number for a zero-based result
 * column, or 0 if not identifiable.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFTABLECOL | PQftablecol}
 */
export const PQftablecol: (
	res: Deno.PointerObject,
	field_num: number,
) => number = ffi.PQftablecol

/**
 * Return the PostgreSQL type OID for a zero-based result column. No result
 * conversion is performed.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFTYPE | PQftype}
 */
export const PQftype: (res: Deno.PointerObject, field_num: number) => number =
	ffi.PQftype

/**
 * Allocate a {@linkcode PGcancel} for conn, or return NULL on failure. The
 * caller must release a non-null handle with {@linkcode PQfreeCancel}; it is
 * independent of the connection.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-cancel.html#LIBPQ-PQGETCANCEL | PQgetCancel}
 */
export const PQgetCancel: (conn: Deno.PointerObject) => Deno.PointerValue =
	ffi.PQgetCancel

/**
 * Return 1 for SQL NULL or 0 for a non-null field. Row and column indices are
 * zero-based; use this to distinguish NULL from empty data.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQGETISNULL | PQgetisnull}
 */
export const PQgetisnull: (
	res: Deno.PointerObject,
	tup_num: number,
	field_num: number,
) => number = ffi.PQgetisnull

/**
 * Return a field's byte length, excluding its trailing terminator. Row and
 * column indices are zero-based. A zero length does not distinguish SQL NULL
 * from an empty value.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQGETLENGTH | PQgetlength}
 */
export const PQgetlength: (
	res: Deno.PointerObject,
	tup_num: number,
	field_num: number,
) => number = ffi.PQgetlength

/**
 * Collect the next {@linkcode PGresult} from a sent command, or NULL when the
 * command is fully drained. Each non-null result must be released with
 * {@linkcode PQclear}, including error results. Use
 * {@linkcode PQisBusy}/{@linkcode PQconsumeInput} to avoid blocking; drain
 * through NULL before sending the next command.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQGETRESULT | PQgetResult}
 */
export const PQgetResult: (conn: Deno.PointerObject) => Deno.PointerValue =
	ffi.PQgetResult

/**
 * Return a borrowed pointer to a zero-based field's bytes, owned by res. Text
 * is null-terminated; binary bytes need {@linkcode PQgetlength}. SQL NULL also
 * produces empty bytes, so check {@linkcode PQgetisnull}. Copy data before
 * {@linkcode PQclear}; never free the field pointer separately.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQGETVALUE | PQgetvalue}
 */
export const PQgetvalue: (
	res: Deno.PointerObject,
	tup_num: number,
	field_num: number,
) => Deno.PointerValue = ffi.PQgetvalue

/**
 * Return a borrowed null-terminated connection host string. It belongs to conn
 * and must not be freed separately.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQHOST | PQhost}
 */
export const PQhost: (conn: Deno.PointerObject) => Deno.PointerValue =
	ffi.PQhost

/**
 * Return 1 if {@linkcode PQgetResult} would block waiting for more input,
 * otherwise 0. Call {@linkcode PQconsumeInput} to update buffered input before
 * checking.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQISBUSY | PQisBusy}
 */
export const PQisBusy: (conn: Deno.PointerObject) => number = ffi.PQisBusy

/**
 * Return 1 if conn is in nonblocking mode, otherwise 0.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQISNONBLOCKING | PQisnonblocking}
 */
export const PQisnonblocking: (conn: Deno.PointerObject) => number =
	ffi.PQisnonblocking

/**
 * Return the number of columns in res.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-copy.html#LIBPQ-PQNFIELDS-1 | PQnfields}
 */
export const PQnfields: (res: Deno.PointerObject) => number = ffi.PQnfields

/**
 * Return the parameter count reported by a prepared-statement description
 * result.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQNPARAMS | PQnparams}
 */
export const PQnparams: (res: Deno.PointerObject) => number = ffi.PQnparams

/**
 * Return the next allocated {@linkcode PGnotify}, or NULL when no notification
 * is buffered. Copy its fields and release the whole structure with
 * {@linkcode PQfreemem}. {@linkcode PQconsumeInput} and other input-reading
 * calls populate the notification queue.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-notify.html#LIBPQ-PQNOTIFIES | PQnotifies}
 */
export const PQnotifies: (conn: Deno.PointerObject) => Deno.PointerValue =
	ffi.PQnotifies

/**
 * Return the inserted row's object OID when the command supplies one, otherwise
 * 0. This legacy facility does not return values from an INSERT RETURNING
 * result.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQOIDVALUE | PQoidValue}
 */
export const PQoidValue: (res: Deno.PointerObject) => number = ffi.PQoidValue

/**
 * Return a borrowed null-terminated connection options string. It belongs to
 * conn and must not be freed separately.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQOPTIONS | PQoptions}
 */
export const PQoptions: (conn: Deno.PointerObject) => Deno.PointerValue =
	ffi.PQoptions

/**
 * Return a borrowed null-terminated server parameter value, or NULL if unknown.
 * paramName is null-terminated input. Copy before later parameter changes or
 * {@linkcode PQfinish}; do not free separately.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQPARAMETERSTATUS | PQparameterStatus}
 */
export const PQparameterStatus: (
	conn: Deno.PointerObject,
	paramName: BufferSource,
) => Deno.PointerValue = ffi.PQparameterStatus

/**
 * Return the PostgreSQL type OID of a zero-based prepared-statement parameter
 * described by res.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQPARAMTYPE | PQparamtype}
 */
export const PQparamtype: (
	res: Deno.PointerObject,
	param_num: number,
) => number = ffi.PQparamtype

/**
 * Return the number of rows in res.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQNTUPLES | PQntuples}
 */
export const PQntuples: (res: Deno.PointerObject) => number = ffi.PQntuples

/**
 * Prepare null-terminated SQL under stmtName (empty names overwrite the unnamed
 * statement). nParams and paramTypes optionally specify OIDs. Return a
 * {@linkcode PGresult} to release with {@linkcode PQclear}, or NULL;
 * preparation errors remain result statuses.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQPREPARE | PQprepare}
 */
export const PQprepare: (
	conn: Deno.PointerObject,
	stmtName: BufferSource,
	query: BufferSource,
	nParams: number,
	paramTypes: Deno.PointerValue,
) => Deno.PointerValue = ffi.PQprepare

/**
 * Deno FFI alias of {@linkcode PQprepare}, executed off the JavaScript thread.
 * Resolve to the same C return value with the same ownership and error rules.
 * Keep referenced input/output buffers and pointers alive until the Promise
 * settles.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQPREPARE | PQprepare}
 */
export const PQprepareAsync: (
	conn: Deno.PointerObject,
	stmtName: BufferSource,
	query: BufferSource,
	nParams: number,
	paramTypes: Deno.PointerValue,
) => Promise<Deno.PointerValue> = ffi.PQprepareAsync

/**
 * Return the connection's frontend/backend protocol major version, or 0 if not
 * connected.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQPROTOCOLVERSION | PQprotocolVersion}
 */
export const PQprotocolVersion: (conn: Deno.PointerObject) => number =
	ffi.PQprotocolVersion

/**
 * Advance a reset started by {@linkcode PQresetStart}. Return
 * {@linkcode PostgresPollingStatusType}; wait for the indicated socket
 * readiness before polling again.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESETSTART | PQresetPoll}
 */
export const PQresetPoll: (conn: Deno.PointerObject) => number = ffi.PQresetPoll

/**
 * Start a nonblocking reset of the existing connection. Return 1 if started or
 * 0 on failure. Drive {@linkcode PQresetPoll} to completion; the caller still
 * owns conn.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESETSTART | PQresetStart}
 */
export const PQresetStart: (conn: Deno.PointerObject) => number =
	ffi.PQresetStart

/**
 * Return a borrowed static null-terminated name for an
 * {@linkcode ExecStatusType} value. Do not free the returned pointer.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESSTATUS | PQresStatus}
 */
export const PQresStatus: (status: number) => Deno.PointerValue =
	ffi.PQresStatus

/**
 * Return a borrowed null-terminated error message from res, or an empty string
 * on success. Copy it before {@linkcode PQclear}; do not free separately.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTERRORMESSAGE | PQresultErrorMessage}
 */
export const PQresultErrorMessage: (
	res: Deno.PointerObject,
) => Deno.PointerValue = ffi.PQresultErrorMessage

/**
 * Return a borrowed null-terminated diagnostic field selected by
 * {@linkcode PGDiag}, or NULL if absent. Copy it before {@linkcode PQclear}; do
 * not free separately.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTERRORFIELD | PQresultErrorField}
 */
export const PQresultErrorField: (
	res: Deno.PointerObject,
	fieldcode: number,
) => Deno.PointerValue = ffi.PQresultErrorField

/**
 * Return the result's {@linkcode ExecStatusType} code. SQL failure is
 * represented here rather than thrown as a JavaScript exception.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTSTATUS | PQresultStatus}
 */
export const PQresultStatus: (res: Deno.PointerObject) => number =
	ffi.PQresultStatus

/**
 * Format diagnostics using {@linkcode PGVerbosity} and
 * {@linkcode PGContextVisibility}. Return an allocated null-terminated string
 * to release with {@linkcode PQfreemem}, or NULL on allocation failure.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTVERBOSEERRORMESSAGE | PQresultVerboseErrorMessage}
 */
export const PQresultVerboseErrorMessage: (
	res: Deno.PointerObject,
	verbosity: number,
	show_context: number,
) => Deno.PointerValue = ffi.PQresultVerboseErrorMessage

/**
 * Send a prepare request using null-terminated statement name and SQL. Return 1
 * if queued or 0 on failure. Collect and release its PGresults with
 * {@linkcode PQgetResult}/{@linkcode PQclear}; nParams/paramTypes optionally
 * specify OIDs.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDPREPARE | PQsendPrepare}
 */
export const PQsendPrepare: (
	conn: Deno.PointerObject,
	stmtName: BufferSource,
	query: BufferSource,
	nParams: number,
	paramTypes: Deno.PointerValue,
) => number = ffi.PQsendPrepare

/**
 * Send null-terminated SQL, allowing multiple statements. Return 1 if queued or
 * 0 on failure. Flush pending output and collect every {@linkcode PGresult}
 * through the final NULL; SQL errors are collected result statuses.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDQUERY | PQsendQuery}
 */
export const PQsendQuery: (
	conn: Deno.PointerObject,
	query: BufferSource,
) => number = ffi.PQsendQuery

/**
 * Send one parameterized statement. Parameters and resultFormat follow
 * {@linkcode PQexecParams}. Return 1 if queued or 0 on failure; flush and
 * collect PGresults through NULL before the next command.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDQUERYPARAMS | PQsendQueryParams}
 */
export const PQsendQueryParams: (
	conn: Deno.PointerObject,
	command: BufferSource,
	nParams: number,
	paramTypes: Deno.PointerValue,
	paramValues: BufferSource | null,
	paramLengths: Deno.PointerValue,
	paramFormats: Deno.PointerValue,
	resultFormat: number,
) => number = ffi.PQsendQueryParams

/**
 * Send execution of a null-terminated prepared-statement name. Parameters and
 * resultFormat follow {@linkcode PQexecPrepared}. Return 1 if queued or 0 on
 * failure; flush and collect PGresults through NULL.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDQUERYPREPARED | PQsendQueryPrepared}
 */
export const PQsendQueryPrepared: (
	conn: Deno.PointerObject,
	stmtName: BufferSource,
	nParams: number,
	paramValues: BufferSource | null,
	paramLengths: Deno.PointerValue,
	paramFormats: Deno.PointerValue,
	resultFormat: number,
) => number = ffi.PQsendQueryPrepared

/**
 * Return the encoded server version number, or 0 if unavailable. For PostgreSQL
 * 10+, divide by 10000 for the major version.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQSERVERVERSION | PQserverVersion}
 */
export const PQserverVersion: (conn: Deno.PointerObject) => number =
	ffi.PQserverVersion

/**
 * Set nonblocking mode when arg is 1, or blocking mode when arg is 0. Return 0
 * on success or -1 on failure. Blocking query APIs such as {@linkcode PQexec}
 * still block.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSETNONBLOCKING | PQsetnonblocking}
 */
export const PQsetnonblocking: (
	conn: Deno.PointerObject,
	arg: number,
) => number = ffi.PQsetnonblocking

/**
 * Return the connection's socket descriptor, or -1 if no socket exists. It is
 * borrowed from conn; do not close it directly. It may change while connecting
 * or resetting.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQSOCKET | PQsocket}
 */
export const PQsocket: (conn: Deno.PointerObject) => number = ffi.PQsocket

/**
 * Run C PQsocketPoll off the JavaScript thread. forRead/forWrite are 0 or 1;
 * endTime is an absolute microsecond deadline or -1n for no deadline. Resolve
 * to >0 for readiness, 0 for timeout, or -1 on failure. Requires libpq 17+.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQSOCKETPOLL | PQsocketPoll}
 */
export const PQsocketPollAsync: (
	sock: number,
	forRead: number,
	forWrite: number,
	endTime: bigint,
) => Promise<number> = ffi.PQsocketPollAsync

/**
 * Return the current Unix-epoch time in microseconds as a bigint, suitable for
 * {@linkcode PQsocketPollAsync} deadlines. Requires libpq 17+.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-misc.html#LIBPQ-PQGETCURRENTTIMEUSEC | PQgetCurrentTimeUSec}
 */
export const PQgetCurrentTimeUSec: () => bigint = ffi.PQgetCurrentTimeUSec

/**
 * Return the connection's {@linkcode ConnStatusType} code. A non-null
 * connection handle is not evidence of CONNECTION_OK.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQSTATUS | PQstatus}
 */
export const PQstatus: (conn: Deno.PointerObject) => number = ffi.PQstatus

/**
 * Return the connection's {@linkcode PGTransactionStatusType} code.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQTRANSACTIONSTATUS | PQtransactionStatus}
 */
export const PQtransactionStatus: (conn: Deno.PointerObject) => number =
	ffi.PQtransactionStatus

/**
 * Return a borrowed null-terminated connection user string. It belongs to conn
 * and must not be freed separately.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQUSER | PQuser}
 */
export const PQuser: (conn: Deno.PointerObject) => Deno.PointerValue =
	ffi.PQuser

/**
 * Check server availability using null-terminated conninfo bytes. Return a
 * {@linkcode PGPing} code; this does not return a connection handle.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQPING | PQping}
 */
export const PQping: (conninfo: BufferSource) => number = ffi.PQping

/**
 * Return a borrowed null-terminated connection port string. It belongs to conn
 * and must not be freed separately.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQPORT | PQport}
 */
export const PQport: (conn: Deno.PointerObject) => Deno.PointerValue =
	ffi.PQport

/**
 * Close and re-establish the existing connection synchronously using its saved
 * connection options. The caller retains the handle; check {@linkcode PQstatus}
 * after the call.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESET | PQreset}
 */
export const PQreset: (conn: Deno.PointerObject) => void = ffi.PQreset

/**
 * Deno FFI alias of {@linkcode PQreset}, executed off the JavaScript thread.
 * Resolve to the same C return value with the same ownership and error rules.
 * Keep referenced input/output buffers and pointers alive until the Promise
 * settles.
 *
 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESET | PQreset}
 */
export const PQresetAsync: (conn: Deno.PointerObject) => Promise<void> =
	ffi.PQresetAsync

export {
	ConnStatusType,
	ExecStatusType,
	PGContextVisibility,
	PGDiag,
	PGPing,
	PGTransactionStatusType,
	PGVerbosity,
	PostgresPollingStatusType,
} from './native/types.ts'
export type {
	Oid,
	PGcancel,
	PGconn,
	PGnotify,
	PGresult,
} from './native/types.ts'
