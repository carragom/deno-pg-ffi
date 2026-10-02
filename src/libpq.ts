/**
 * Raw libpq function table for building a custom PostgreSQL client in Deno.
 *
 * For managed connections, parameter conversion, results, and pooling, use
 * `Client` and `Pool` from the package's default entry point. This module
 * exposes {@linkcode libpq}, its {@linkcode Libpq} interface, pointer types,
 * and C enums.
 *
 * Importing this module eagerly loads libpq 17+. Set `DENO_LIBPQ_PATH` to a
 * compatible library, or let the loader download one. Requires `--allow-ffi`
 * and `--allow-env` for loader settings and the example's `PGURL` lookup.
 * Downloads also need `--allow-net`, `--allow-read`, and `--allow-write` for
 * the library cache. libpq reads its own `PG*` variables and `.pgpass` and
 * opens database sockets through FFI, outside Deno's file/network checks.
 *
 * Functions retain C return codes and NULL pointers. A non-null `PGconn` can
 * have `CONNECTION_BAD`; SQL failures normally return a `PGresult` with an
 * error status. Check those results and copy diagnostics before cleanup.
 * String inputs are null-terminated UTF-8 buffers. Parameter arrays are native
 * pointer arrays whose backing buffers must stay alive through the call.
 *
 * Ownership is specific to each function: release connections with
 * `PQfinish`, results with `PQclear`, cancel handles with `PQfreeCancel`,
 * and allocated notifications/escaped strings with `PQfreemem`. Connection
 * option arrays use `PQconninfoFree`. Borrowed pointers such as `PQgetvalue`
 * stay valid only while their owning result is alive; `getCString()` copies
 * text, while `getArrayBuffer()` borrows the referenced memory.
 *
 * `PQconnectdb` and `PQexec` block. A custom asynchronous client can use
 * `PQconnectStart`/`PQconnectPoll` and the send/consume/get-result protocol.
 * Names ending in `Async` are Deno FFI aliases of the same C functions,
 * executed off the JavaScript thread. Their Promises do not manage handles.
 *
 * @module
 *
 * @example Connect, execute a text query, copy rows, and release native handles
 * ```ts
 * import { libpq, ConnStatusType, ExecStatusType } from './libpq.ts'
 *
 * const encoder = new TextEncoder()
 * const cString = (value: string) => encoder.encode(value + '\0')
 * const readString = (pointer: Deno.PointerValue): string =>
 *   pointer === null ? '' : new Deno.UnsafePointerView(pointer).getCString()
 *
 * const conn = libpq.PQconnectdb(cString(Deno.env.get('PGURL') ?? ''))
 * if (conn === null) throw new Error('Could not allocate a connection')
 *
 * try {
 *   if (libpq.PQstatus(conn) !== ConnStatusType.CONNECTION_OK) {
 *     throw new Error(readString(libpq.PQerrorMessage(conn)))
 *   }
 *
 *   const result = libpq.PQexec(
 *     conn,
 *     cString('SELECT 42::int4 AS answer, NULL::text AS missing'),
 *   )
 *   if (result === null) {
 *     throw new Error(readString(libpq.PQerrorMessage(conn)))
 *   }
 *
 *   try {
 *     if (libpq.PQresultStatus(result) !== ExecStatusType.PGRES_TUPLES_OK) {
 *       throw new Error(readString(libpq.PQresultErrorMessage(result)))
 *     }
 *
 *     const rows: Record<string, string | null>[] = []
 *     for (let row = 0; row < libpq.PQntuples(result); row++) {
 *       const values: Record<string, string | null> = {}
 *       for (let col = 0; col < libpq.PQnfields(result); col++) {
 *         const name = readString(libpq.PQfname(result, col))
 *         values[name] = libpq.PQgetisnull(result, row, col)
 *           ? null
 *           : readString(libpq.PQgetvalue(result, row, col))
 *       }
 *       rows.push(values)
 *     }
 *     if (rows[0].answer !== '42' || rows[0].missing !== null) {
 *       throw new Error('Unexpected raw query result')
 *     }
 *   } finally {
 *     libpq.PQclear(result)
 *   }
 * } finally {
 *   libpq.PQfinish(conn)
 * }
 * ```
 */
import { ffi } from './native/load.ts'
import type { Libpq } from './native/symbols.ts'

/**
 * Loaded raw libpq symbols, typed by {@linkcode Libpq}.
 *
 * Check each function's return value and follow its allocation/borrowing rules.
 * No argument encoding, row conversion, SQL exceptions, or automatic disposal
 * is added. See the module example for a complete query and cleanup sequence.
 */
export const libpq: Libpq = ffi

export type { Libpq } from './native/symbols.ts'
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
