/** libpq function signatures and native symbol declarations. @module */
import type { PGconn } from './types.ts'

/**
 * Raw function signatures of the loaded libpq symbol table.
 *
 * String arguments are null-terminated UTF-8 buffers and returned pointers
 * retain their C ownership rules. Check status codes and NULL pointers yourself;
 * SQL failures do not throw. Function properties ending in Async are Deno FFI
 * aliases that run the corresponding C call off the JavaScript thread.
 *
 * Ordinary calls through the public libpq table infer this interface. Import
 * it as a type when annotating an injected table in a custom client.
 */
export interface Libpq {
	/**
	 * Return the backend process ID for conn, or 0 if it is not connected.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQBACKENDPID | PQbackendPID}
	 */
	PQbackendPID: (conn: Deno.PointerObject) => number
	/**
	 * Return 1 when every result column is binary, otherwise 0. Use PQfformat for
	 * individual columns.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQBINARYTUPLES | PQbinaryTuples}
	 */
	PQbinaryTuples: (res: Deno.PointerObject) => number
	/**
	 * Request cancellation using a PGcancel handle. Return 1 if sent, or 0 on
	 * failure and write a null-terminated message into errbuf (errbufsize bytes).
	 * The handle remains owned by the caller.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-cancel.html#LIBPQ-PQCANCEL | PQcancel}
	 */
	PQcancel: (
		cancel: Deno.PointerObject,
		errbuf: BufferSource,
		errbufsize: number,
	) => number
	/**
	 * Free a caller-owned PGresult and all its borrowed field/diagnostic pointers.
	 * Do not clear the same result twice.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQCLEAR | PQclear}
	 */
	PQclear: (res: Deno.PointerObject) => void
	/**
	 * Return a borrowed null-terminated command tag, such as SELECT 2. The pointer
	 * belongs to res and must not be freed separately.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQCMDSTATUS | PQcmdStatus}
	 */
	PQcmdStatus: (res: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Return a borrowed decimal count string, or an empty string if the command has
	 * no count. Includes SELECT counts; it does not identify rows written. The
	 * pointer belongs to res.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQCMDTUPLES | PQcmdTuples}
	 */
	PQcmdTuples: (res: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Open a blocking connection from null-terminated conninfo bytes. Return a
	 * PGconn that must be released with PQfinish, or NULL on allocation failure.
	 * Even a non-null handle may have CONNECTION_BAD; check PQstatus.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTDB | PQconnectdb}
	 */
	PQconnectdb: (conninfo: BufferSource) => Deno.PointerValue
	/**
	 * Deno FFI alias of PQconnectdb, executed off the JavaScript thread. Resolve to
	 * the same C return value with the same ownership and error rules. Keep
	 * referenced input/output buffers and pointers alive until the Promise settles.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTDB | PQconnectdb}
	 */
	PQconnectdbAsync: (
		conninfo: BufferSource,
	) => Promise<Deno.PointerValue>
	/**
	 * Advance a connection started by PQconnectStart. Return
	 * PostgresPollingStatusType; wait for socket readiness before polling again.
	 * Does not release the connection on failure.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTSTARTPARAMS | PQconnectPoll}
	 */
	PQconnectPoll: (conn: Deno.PointerObject) => number
	/**
	 * Start a poll-protocol connection from null-terminated conninfo bytes. Return
	 * a caller-owned PGconn, or NULL on allocation failure. Check PQstatus, drive
	 * PQconnectPoll, and eventually call PQfinish.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNECTSTARTPARAMS | PQconnectStart}
	 */
	PQconnectStart: (conninfo: BufferSource) => Deno.PointerValue
	/**
	 * Allocate the connection's current PQconninfoOption array, or return NULL on
	 * allocation failure. Its strings belong to that array. Release the whole
	 * allocation with PQconninfoFree.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQCONNINFO | PQconninfo}
	 */
	PQconninfo: (conn: PGconn) => Deno.PointerValue
	/**
	 * Free a PQconninfoOption array and its strings. Use this for PQconninfo
	 * allocations rather than PQfreemem.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-misc.html#LIBPQ-PQCONNINFOFREE | PQconninfoFree}
	 */
	PQconninfoFree: (options: Deno.PointerObject) => void
	/**
	 * Read available input into libpq's buffers without waiting for a full command
	 * result. Return 1 on success or 0 on failure; read PQerrorMessage for details.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQCONSUMEINPUT | PQconsumeInput}
	 */
	PQconsumeInput: (conn: Deno.PointerObject) => number
	/**
	 * Return a borrowed null-terminated connection database name. It belongs to
	 * conn and must not be freed separately.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQDB | PQdb}
	 */
	PQdb: (conn: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Describe the null-terminated stmt name using a blocking call. Return a
	 * caller-owned PGresult to release with PQclear, or NULL on
	 * connection/allocation failure. Check PQresultStatus for errors.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQDESCRIBEPREPARED | PQdescribePrepared}
	 */
	PQdescribePrepared: (
		conn: Deno.PointerObject,
		stmt: BufferSource,
	) => Deno.PointerValue
	/**
	 * Return a borrowed null-terminated connection error string, possibly empty.
	 * Copy it before later libpq calls replace it or PQfinish frees conn. Do not
	 * free this pointer.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQERRORMESSAGE | PQerrorMessage}
	 */
	PQerrorMessage: (conn: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Escape len bytes of str as an SQL identifier. Return an allocated
	 * null-terminated string to release with PQfreemem, or NULL on failure. len
	 * excludes any terminator.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQESCAPEIDENTIFIER | PQescapeIdentifier}
	 */
	PQescapeIdentifier: (
		conn: Deno.PointerObject,
		str: BufferSource,
		len: bigint,
	) => Deno.PointerValue
	/**
	 * Escape len bytes of str as an SQL literal. Return an allocated
	 * null-terminated string to release with PQfreemem, or NULL on failure. len
	 * excludes any terminator.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQESCAPELITERAL | PQescapeLiteral}
	 */
	PQescapeLiteral: (
		conn: Deno.PointerObject,
		str: BufferSource,
		len: bigint,
	) => Deno.PointerValue
	/**
	 * Execute null-terminated SQL synchronously. For multiple statements, return
	 * only the last PGresult. Release non-null results with PQclear. SQL errors are
	 * result statuses; NULL indicates failure to produce a result.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXEC | PQexec}
	 */
	PQexec: (
		conn: Deno.PointerObject,
		query: BufferSource,
	) => Deno.PointerValue
	/**
	 * Deno FFI alias of PQexec, executed off the JavaScript thread. Resolve to the
	 * same C return value with the same ownership and error rules. Keep referenced
	 * input/output buffers and pointers alive until the Promise settles.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXEC | PQexec}
	 */
	PQexecAsync: (
		conn: Deno.PointerObject,
		query: BufferSource,
	) => Promise<Deno.PointerValue>
	/**
	 * Execute one statement with nParams parameters. paramTypes points to OIDs;
	 * paramValues encodes char* pointers (a NULL entry is SQL NULL).
	 * paramFormats/paramLengths describe binary inputs; NULL formats select text.
	 * resultFormat is 0 for text or 1 for binary. Return a caller-owned PGresult to release with PQclear, or NULL; SQL errors
	 * remain result statuses.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXECPARAMS | PQexecParams}
	 */
	PQexecParams: (
		conn: Deno.PointerObject,
		command: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => Deno.PointerValue
	/**
	 * Deno FFI alias of PQexecParams, executed off the JavaScript thread. Resolve
	 * to the same C return value with the same ownership and error rules. Keep
	 * referenced input/output buffers and pointers alive until the Promise settles.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXECPARAMS | PQexecParams}
	 */
	PQexecParamsAsync: (
		conn: Deno.PointerObject,
		command: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => Promise<Deno.PointerValue>
	/**
	 * Execute a prepared statement synchronously using a null-terminated stmtName.
	 * Parameter pointers and format/length arrays follow PQexecParams; resultFormat
	 * selects text (0) or binary (1). Return a PGresult to release with PQclear, or
	 * NULL; inspect its status for SQL errors.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXECPREPARED | PQexecPrepared}
	 */
	PQexecPrepared: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		nParams: number,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => Deno.PointerValue
	/**
	 * Deno FFI alias of PQexecPrepared, executed off the JavaScript thread. Resolve
	 * to the same C return value with the same ownership and error rules. Keep
	 * referenced input/output buffers and pointers alive until the Promise settles.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQEXECPREPARED | PQexecPrepared}
	 */
	PQexecPreparedAsync: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		nParams: number,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => Promise<Deno.PointerValue>
	/**
	 * Return the column format: 0 for text or 1 for binary. field_num is
	 * zero-based.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-copy.html#LIBPQ-PQFFORMAT-1 | PQfformat}
	 */
	PQfformat: (res: Deno.PointerObject, field_num: number) => number
	/**
	 * Close and free a caller-owned PGconn. All connection-owned pointers become
	 * invalid. Outstanding PGresults remain independently owned. Do not finish
	 * twice or while another call is using the handle.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQFINISH | PQfinish}
	 */
	PQfinish: (conn: Deno.PointerObject) => void
	/**
	 * Deno FFI alias of PQfinish, executed off the JavaScript thread. Resolve to
	 * the same C return value with the same ownership and error rules. Keep
	 * referenced input/output buffers and pointers alive until the Promise settles.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQFINISH | PQfinish}
	 */
	PQfinishAsync: (conn: Deno.PointerObject) => Promise<void>
	/**
	 * Try to send buffered output. Return 0 when fully sent, 1 if output remains,
	 * or -1 on error. In nonblocking mode, wait for readiness and retry when output
	 * remains.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQFLUSH | PQflush}
	 */
	PQflush: (conn: Deno.PointerObject) => number
	/**
	 * Return the zero-based column's PostgreSQL type modifier, or -1 when
	 * unavailable. Interpretation depends on the type.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFMOD | PQfmod}
	 */
	PQfmod: (res: Deno.PointerObject, field_num: number) => number
	/**
	 * Return a borrowed null-terminated column name, or NULL for an invalid
	 * zero-based column. The pointer belongs to res.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFNAME | PQfname}
	 */
	PQfname: (
		res: Deno.PointerObject,
		field_num: number,
	) => Deno.PointerValue
	/**
	 * Look up a column by a null-terminated name. Return its zero-based index, or
	 * -1 if absent; unquoted names are folded to lower case.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFNUMBER | PQfnumber}
	 */
	PQfnumber: (
		res: Deno.PointerObject,
		field_name: BufferSource,
	) => number
	/**
	 * Free a caller-owned PGcancel created by PQgetCancel. Do not use or free the
	 * handle again.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-cancel.html#LIBPQ-PQFREECANCEL | PQfreeCancel}
	 */
	PQfreeCancel: (cancel: Deno.PointerObject) => void
	/**
	 * Free memory allocated by libpq APIs such as PQescapeLiteral, PQnotifies, or
	 * PQunescapeBytea. Do not use this on borrowed connection/result pointers,
	 * PGconn, PGresult, or PQconninfoOption arrays.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-misc.html#LIBPQ-PQFREEMEM | PQfreemem}
	 */
	PQfreemem: (ptr: Deno.PointerValue) => void
	/**
	 * Decode null-terminated bytea text. Return allocated bytes or NULL on
	 * allocation failure; write their length to the size_t pointed to by retbuflen.
	 * Copy or consume the bytes before releasing them with PQfreemem.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQUNESCAPEBYTEA | PQunescapeBytea}
	 */
	PQunescapeBytea: (
		strtext: BufferSource,
		retbuflen: Deno.PointerValue,
	) => Deno.PointerValue
	/**
	 * Return the zero-based column's fixed type size in bytes, or -1 for a
	 * variable-length type. This is not a particular value's byte length.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFSIZE | PQfsize}
	 */
	PQfsize: (res: Deno.PointerObject, field_num: number) => number
	/**
	 * Return the source table OID for a zero-based result column, or 0 if the
	 * column is not identifiable as a table column.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFTABLE | PQftable}
	 */
	PQftable: (res: Deno.PointerObject, field_num: number) => number
	/**
	 * Return the source table's one-based attribute number for a zero-based result
	 * column, or 0 if not identifiable.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFTABLECOL | PQftablecol}
	 */
	PQftablecol: (
		res: Deno.PointerObject,
		field_num: number,
	) => number
	/**
	 * Return the PostgreSQL type OID for a zero-based result column. No
	 * result conversion is performed.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQFTYPE | PQftype}
	 */
	PQftype: (res: Deno.PointerObject, field_num: number) => number
	/**
	 * Allocate a PGcancel for conn, or return NULL on failure. The caller must
	 * release a non-null handle with PQfreeCancel; it is independent of the
	 * connection.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-cancel.html#LIBPQ-PQGETCANCEL | PQgetCancel}
	 */
	PQgetCancel: (conn: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Return 1 for SQL NULL or 0 for a non-null field. Row and column indices are
	 * zero-based; use this to distinguish NULL from empty data.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQGETISNULL | PQgetisnull}
	 */
	PQgetisnull: (
		res: Deno.PointerObject,
		tup_num: number,
		field_num: number,
	) => number
	/**
	 * Return a field's byte length, excluding its trailing terminator. Row and
	 * column indices are zero-based. A zero length does not distinguish SQL NULL
	 * from an empty value.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQGETLENGTH | PQgetlength}
	 */
	PQgetlength: (
		res: Deno.PointerObject,
		tup_num: number,
		field_num: number,
	) => number
	/**
	 * Collect the next PGresult from a sent command, or NULL when the command is
	 * fully drained. Each non-null result must be released with PQclear, including
	 * error results. Use PQisBusy/PQconsumeInput to avoid blocking; drain through
	 * NULL before sending the next command.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQGETRESULT | PQgetResult}
	 */
	PQgetResult: (conn: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Return a borrowed pointer to a zero-based field's bytes, owned by res. Text
	 * is null-terminated; binary bytes need PQgetlength. SQL NULL also produces
	 * empty bytes, so check PQgetisnull. Copy data before PQclear; never free the
	 * field pointer separately.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQGETVALUE | PQgetvalue}
	 */
	PQgetvalue: (
		res: Deno.PointerObject,
		tup_num: number,
		field_num: number,
	) => Deno.PointerValue
	/**
	 * Return a borrowed null-terminated connection host string. It belongs to conn
	 * and must not be freed separately.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQHOST | PQhost}
	 */
	PQhost: (conn: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Return 1 if PQgetResult would block waiting for more input, otherwise 0. Call
	 * PQconsumeInput to update buffered input before checking.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQISBUSY | PQisBusy}
	 */
	PQisBusy: (conn: Deno.PointerObject) => number
	/**
	 * Return 1 if conn is in nonblocking mode, otherwise 0.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQISNONBLOCKING | PQisnonblocking}
	 */
	PQisnonblocking: (conn: Deno.PointerObject) => number
	/**
	 * Return the number of columns in res.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-copy.html#LIBPQ-PQNFIELDS-1 | PQnfields}
	 */
	PQnfields: (res: Deno.PointerObject) => number
	/**
	 * Return the parameter count reported by a prepared-statement description
	 * result.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQNPARAMS | PQnparams}
	 */
	PQnparams: (res: Deno.PointerObject) => number
	/**
	 * Return the next allocated PGnotify, or NULL when no notification is buffered.
	 * Copy its fields and release the whole structure with PQfreemem.
	 * PQconsumeInput and other input-reading calls populate the notification queue.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-notify.html#LIBPQ-PQNOTIFIES | PQnotifies}
	 */
	PQnotifies: (conn: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Return the inserted row's object OID when the command supplies one, otherwise
	 * 0. This legacy facility does not return values from an INSERT RETURNING
	 * result.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQOIDVALUE | PQoidValue}
	 */
	PQoidValue: (res: Deno.PointerObject) => number
	/**
	 * Return a borrowed null-terminated connection options string. It belongs to
	 * conn and must not be freed separately.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQOPTIONS | PQoptions}
	 */
	PQoptions: (conn: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Return a borrowed null-terminated server parameter value, or NULL if unknown.
	 * paramName is null-terminated input. Copy before later parameter changes or
	 * PQfinish; do not free separately.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQPARAMETERSTATUS | PQparameterStatus}
	 */
	PQparameterStatus: (
		conn: Deno.PointerObject,
		paramName: BufferSource,
	) => Deno.PointerValue
	/**
	 * Return the PostgreSQL type OID of a zero-based prepared-statement parameter
	 * described by res.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQPARAMTYPE | PQparamtype}
	 */
	PQparamtype: (
		res: Deno.PointerObject,
		param_num: number,
	) => number
	/**
	 * Return the number of rows in res.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQNTUPLES | PQntuples}
	 */
	PQntuples: (res: Deno.PointerObject) => number
	/**
	 * Prepare null-terminated SQL under stmtName (empty names overwrite the unnamed
	 * statement). nParams and paramTypes optionally specify OIDs. Return a PGresult
	 * to release with PQclear, or NULL; preparation errors remain result statuses.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQPREPARE | PQprepare}
	 */
	PQprepare: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		query: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
	) => Deno.PointerValue
	/**
	 * Deno FFI alias of PQprepare, executed off the JavaScript thread. Resolve to
	 * the same C return value with the same ownership and error rules. Keep
	 * referenced input/output buffers and pointers alive until the Promise settles.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQPREPARE | PQprepare}
	 */
	PQprepareAsync: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		query: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
	) => Promise<Deno.PointerValue>
	/**
	 * Return the connection's frontend/backend protocol major version, or 0 if not
	 * connected.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQPROTOCOLVERSION | PQprotocolVersion}
	 */
	PQprotocolVersion: (conn: Deno.PointerObject) => number
	/**
	 * Advance a reset started by PQresetStart. Return PostgresPollingStatusType;
	 * wait for the indicated socket readiness before polling again.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESETSTART | PQresetPoll}
	 */
	PQresetPoll: (conn: Deno.PointerObject) => number
	/**
	 * Start a nonblocking reset of the existing connection. Return 1 if started or
	 * 0 on failure. Drive PQresetPoll to completion; the caller still owns conn.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESETSTART | PQresetStart}
	 */
	PQresetStart: (conn: Deno.PointerObject) => number
	/**
	 * Return a borrowed static null-terminated name for an ExecStatusType value. Do
	 * not free the returned pointer.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESSTATUS | PQresStatus}
	 */
	PQresStatus: (status: number) => Deno.PointerValue
	/**
	 * Return a borrowed null-terminated error message from res, or an empty string
	 * on success. Copy it before PQclear; do not free separately.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTERRORMESSAGE | PQresultErrorMessage}
	 */
	PQresultErrorMessage: (
		res: Deno.PointerObject,
	) => Deno.PointerValue
	/**
	 * Return a borrowed null-terminated diagnostic field selected by PGDiag, or
	 * NULL if absent. Copy it before PQclear; do not free separately.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTERRORFIELD | PQresultErrorField}
	 */
	PQresultErrorField: (
		res: Deno.PointerObject,
		fieldcode: number,
	) => Deno.PointerValue
	/**
	 * Return the result's ExecStatusType code. SQL failure is represented here
	 * rather than thrown as a JavaScript exception.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTSTATUS | PQresultStatus}
	 */
	PQresultStatus: (res: Deno.PointerObject) => number
	/**
	 * Format diagnostics using PGVerbosity and PGContextVisibility. Return an
	 * allocated null-terminated string to release with PQfreemem, or NULL on
	 * allocation failure.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-exec.html#LIBPQ-PQRESULTVERBOSEERRORMESSAGE | PQresultVerboseErrorMessage}
	 */
	PQresultVerboseErrorMessage: (
		res: Deno.PointerObject,
		verbosity: number,
		show_context: number,
	) => Deno.PointerValue
	/**
	 * Send a prepare request using null-terminated statement name and SQL. Return 1
	 * if queued or 0 on failure. Collect and release its PGresults with
	 * PQgetResult/PQclear; nParams/paramTypes optionally specify OIDs.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDPREPARE | PQsendPrepare}
	 */
	PQsendPrepare: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		query: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
	) => number
	/**
	 * Send null-terminated SQL, allowing multiple statements. Return 1 if queued or
	 * 0 on failure. Flush pending output and collect every PGresult through the
	 * final NULL; SQL errors are collected result statuses.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDQUERY | PQsendQuery}
	 */
	PQsendQuery: (
		conn: Deno.PointerObject,
		query: BufferSource,
	) => number
	/**
	 * Send one parameterized statement. Parameters and resultFormat follow
	 * PQexecParams. Return 1 if queued or 0 on failure; flush and collect PGresults
	 * through NULL before the next command.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDQUERYPARAMS | PQsendQueryParams}
	 */
	PQsendQueryParams: (
		conn: Deno.PointerObject,
		command: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => number
	/**
	 * Send execution of a null-terminated prepared-statement name. Parameters and
	 * resultFormat follow PQexecPrepared. Return 1 if queued or 0 on failure; flush
	 * and collect PGresults through NULL.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSENDQUERYPREPARED | PQsendQueryPrepared}
	 */
	PQsendQueryPrepared: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		nParams: number,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => number
	/**
	 * Return the encoded server version number, or 0 if unavailable. For PostgreSQL
	 * 10+, divide by 10000 for the major version.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQSERVERVERSION | PQserverVersion}
	 */
	PQserverVersion: (conn: Deno.PointerObject) => number
	/**
	 * Set nonblocking mode when arg is 1, or blocking mode when arg is 0. Return 0
	 * on success or -1 on failure. Blocking query APIs such as PQexec still block.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-async.html#LIBPQ-PQSETNONBLOCKING | PQsetnonblocking}
	 */
	PQsetnonblocking: (
		conn: Deno.PointerObject,
		arg: number,
	) => number
	/**
	 * Return the connection's socket descriptor, or -1 if no socket exists. It is
	 * borrowed from conn; do not close it directly. It may change while connecting
	 * or resetting.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQSOCKET | PQsocket}
	 */
	PQsocket: (conn: Deno.PointerObject) => number
	/**
	 * Run C PQsocketPoll off the JavaScript thread. forRead/forWrite are 0 or 1;
	 * endTime is an absolute microsecond deadline or -1n for no deadline. Resolve
	 * to >0 for readiness, 0 for timeout, or -1 on failure. Requires libpq 17+.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQSOCKETPOLL | PQsocketPoll}
	 */
	PQsocketPollAsync: (
		sock: number,
		forRead: number,
		forWrite: number,
		endTime: bigint,
	) => Promise<number>
	/**
	 * Return the current Unix-epoch time in microseconds as a bigint, suitable for
	 * PQsocketPollAsync deadlines. Requires libpq 17+.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-misc.html#LIBPQ-PQGETCURRENTTIMEUSEC | PQgetCurrentTimeUSec}
	 */
	PQgetCurrentTimeUSec: () => bigint
	/**
	 * Return the connection's ConnStatusType code. A non-null connection handle is
	 * not evidence of CONNECTION_OK.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQSTATUS | PQstatus}
	 */
	PQstatus: (conn: Deno.PointerObject) => number
	/**
	 * Return the connection's PGTransactionStatusType code.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQTRANSACTIONSTATUS | PQtransactionStatus}
	 */
	PQtransactionStatus: (conn: Deno.PointerObject) => number
	/**
	 * Return a borrowed null-terminated connection user string. It belongs to conn
	 * and must not be freed separately.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQUSER | PQuser}
	 */
	PQuser: (conn: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Check server availability using null-terminated conninfo bytes. Return a
	 * PGPing code; this does not return a connection handle.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQPING | PQping}
	 */
	PQping: (conninfo: BufferSource) => number
	/**
	 * Return a borrowed null-terminated connection port string. It belongs to conn
	 * and must not be freed separately.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-status.html#LIBPQ-PQPORT | PQport}
	 */
	PQport: (conn: Deno.PointerObject) => Deno.PointerValue
	/**
	 * Close and re-establish the existing connection synchronously using its saved
	 * connection options. The caller retains the handle; check PQstatus after the
	 * call.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESET | PQreset}
	 */
	PQreset: (conn: Deno.PointerObject) => void
	/**
	 * Deno FFI alias of PQreset, executed off the JavaScript thread. Resolve to the
	 * same C return value with the same ownership and error rules. Keep referenced
	 * input/output buffers and pointers alive until the Promise settles.
	 *
	 * @see {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PQRESET | PQreset}
	 */
	PQresetAsync: (conn: Deno.PointerObject) => Promise<void>
}

export const symbols = {
	PQbackendPID: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'i32', // int
	},
	PQbinaryTuples: {
		parameters: ['pointer'], // const PGresult *res
		result: 'i32', // int
	},
	PQcancel: {
		parameters: [
			'pointer', // PGcancel *cancel
			'buffer', // char *errbuf
			'i32', // int errbufsize
		],
		result: 'i32', // int
	},
	PQclear: {
		parameters: ['pointer'], // const PGresult *res
		result: 'void',
	},
	PQcmdStatus: {
		parameters: [
			'pointer', // PGresult *res
		],
		result: 'buffer', // char *
	},
	PQcmdTuples: {
		parameters: ['pointer'], // const PGresult *res
		result: 'buffer', // char *
	},
	PQconnectdb: {
		parameters: [
			'buffer', // const char *conninfo
		],
		result: 'pointer', // PGconn *
	},
	PQconnectdbAsync: {
		parameters: [
			'buffer', // const char *conninfo
		],
		result: 'pointer', // PGconn *
		name: 'PQconnectdb',
		nonblocking: true,
	},
	PQconnectPoll: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // PostgresPollingStatusType
	},
	PQconnectStart: {
		parameters: [
			'buffer', // const char *conninfo
		],
		result: 'pointer', // PGconn *
	},
	PQconninfo: {
		parameters: ['pointer'], // PGconn *conn
		result: 'pointer', // PQconninfoOption *
	},
	PQconninfoFree: {
		parameters: ['pointer'], // PQconninfoOption *connOptions
		result: 'void',
	},
	PQconsumeInput: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQdb: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'buffer', // char *
	},
	PQdescribePrepared: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmt
		],
		result: 'pointer', // PGresult *
	},
	PQerrorMessage: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'buffer', // char *
	},
	PQescapeIdentifier: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *str
			'usize', // size_t len
		],
		result: 'pointer', // char * (must be freed with PQfreemem)
	},
	PQescapeLiteral: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *str
			'usize', // size_t len
		],
		result: 'pointer', // char * (must be freed with PQfreemem)
	},
	PQexec: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *query
		],
		result: 'pointer', /// PGresult *
	},
	PQexecAsync: {
		name: 'PQexec',
		nonblocking: true,
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *query
		],
		result: 'pointer', // PGresult *
	},
	PQexecParams: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *command
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats
			'i32', // int resultFormat
		],
		result: 'pointer', // PGresult *
	},
	PQexecParamsAsync: {
		name: 'PQexecParams',
		nonblocking: true,
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *command
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats
			'i32', // int resultFormat
		],
		result: 'pointer', // PGresult *
	},
	PQexecPrepared: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'i32', // int nParams
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats,
			'i32', //int resultFormat
		],
		result: 'pointer', // PGresult *
	},
	PQexecPreparedAsync: {
		name: 'PQexecPrepared',
		nonblocking: true,
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'i32', // int nParams
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats,
			'i32', //int resultFormat
		],
		result: 'pointer', // PGresult *
	},
	PQfformat: {
		parameters: [
			'pointer', // PGresult *res
			'i32', // int field_num
		],
		result: 'i32', // int
	},
	PQfinish: { parameters: ['pointer'], result: 'void' },
	PQfinishAsync: {
		name: 'PQfinish',
		result: 'void',
		nonblocking: true,
		parameters: [
			'pointer',
		],
	},
	PQflush: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQfmod: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int field_num
		],
		result: 'i32', // int
	},
	PQfname: {
		parameters: [
			'pointer', // PGresult *res
			'i32', // int field_num
		],
		result: 'buffer', // char *
	},
	PQfnumber: { parameters: ['pointer', 'buffer'], result: 'i32' },
	PQfreeCancel: {
		parameters: ['pointer'], // PGcancel *cancel
		result: 'void',
	},
	PQunescapeBytea: {
		parameters: ['buffer', 'pointer'], // const unsigned char *strtext, size_t *retbuflen
		result: 'pointer', // unsigned char * (must be freed with PQfreemem)
	},
	PQfreemem: {
		parameters: ['pointer'], // void *ptr
		result: 'void',
	},
	PQfsize: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int field_num
		],
		result: 'i32', // int
	},
	PQftable: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int field_num
		],
		result: 'u32', // Oid
	},
	PQftablecol: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int field_num
		],
		result: 'i32', // int
	},
	PQftype: {
		parameters: [
			'pointer', // PGresult *res
			'i32', // int field_num
		],
		result: 'u32', // Oid
	},
	PQgetCancel: {
		parameters: ['pointer'], // PGconn *conn
		result: 'pointer', // PGcancel *
	},
	PQgetisnull: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
	PQgetlength: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
	PQgetResult: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'pointer', // PGresult *
	},
	PQgetvalue: { parameters: ['pointer', 'i32', 'i32'], result: 'buffer' },
	PQhost: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'buffer', // char *
	},
	PQisBusy: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQisnonblocking: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQnfields: { parameters: ['pointer'], result: 'i32' },
	PQnparams: {
		parameters: ['pointer'], // const PGresult *res
		result: 'i32', // int
	},
	PQnotifies: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'pointer', // PGnotify *
	},
	PQoidValue: {
		parameters: ['pointer'], // const PGresult *res
		result: 'u32', // Oid
	},
	PQoptions: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'buffer', // char *
	},
	PQparameterStatus: {
		parameters: [
			'pointer', // const PGconn *conn
			'buffer', // const char *paramName
		],
		result: 'buffer', // const char *
	},
	PQparamtype: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int param_num
		],
		result: 'u32', // Oid
	},
	PQntuples: { parameters: ['pointer'], result: 'i32' },
	PQprepare: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'buffer', // const char *query
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
		],
		result: 'pointer', // PGresult *
	},
	PQprepareAsync: {
		name: 'PQprepare',
		nonblocking: true,
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'buffer', // const char *query
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
		],
		result: 'pointer', // PGresult *
	},
	PQprotocolVersion: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'i32', // int
	},
	PQresetPoll: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // PostgresPollingStatusType
	},
	PQresetStart: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQresStatus: { parameters: ['i32'], result: 'buffer' },
	PQresultErrorMessage: {
		parameters: [
			'pointer', // PGresult *res
		],
		result: 'buffer', // char *
	},
	PQresultErrorField: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int fieldcode
		],
		result: 'buffer', // char *
	},
	PQresultStatus: { parameters: ['pointer'], result: 'i32' },
	PQresultVerboseErrorMessage: {
		parameters: [
			'pointer', // PGresult *res
			'i32', // int verbosity
			'i32', // int show_context
		],
		result: 'buffer', // char *
	},
	PQsendPrepare: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'buffer', // const char *query
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
		],
		result: 'i32', // int
	},
	PQsendQuery: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *query
		],
		result: 'i32', // int
	},
	PQsendQueryParams: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *command
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats
			'i32', // int resultFormat
		],
		result: 'i32', // int
	},
	PQsendQueryPrepared: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'i32', // int nParams
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats
			'i32', // int resultFormat
		],
		result: 'i32', // int
	},
	PQserverVersion: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQsetnonblocking: {
		parameters: [
			'pointer', // PGconn *conn
			'i32', // int arg
		],
		result: 'i32', // int
	},
	PQsocket: {
		parameters: ['pointer'], // PGconn *conn
		result: 'i32', // int
	},
	PQsocketPollAsync: {
		name: 'PQsocketPoll',
		nonblocking: true,
		parameters: [
			'i32', // int sock
			'i32', // int forRead
			'i32', // int forWrite
			'i64', // pg_usec_time_t end_time
		],
		result: 'i32', // int
	},
	PQgetCurrentTimeUSec: {
		parameters: [],
		result: 'i64', // pg_usec_time_t
	},
	PQstatus: { parameters: ['pointer'], result: 'i32' },
	PQtransactionStatus: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'i32', // PGTransactionStatusType
	},
	PQuser: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'buffer', // char *
	},
	PQping: {
		parameters: [
			'buffer', // const char *conninfo
		],
		result: 'i32', // PGPing (enum value)
	},
	PQport: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'buffer', // char *
	},
	PQreset: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'void',
	},
	PQresetAsync: {
		name: 'PQreset',
		nonblocking: true,
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'void',
	},
} as const satisfies Deno.ForeignLibraryInterface
