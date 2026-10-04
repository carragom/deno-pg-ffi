/**
 * Deno native bindings for PostgreSQL libpq.
 *
 * A safe, fast PostgreSQL client built on libpq, with parameterized queries,
 * pooling, prepared statements, notifications, and automatic resource disposal.
 * Use {@linkcode Client} for one connection, {@linkcode Pool} for concurrent
 * commands, and {@linkcode Notifier} for LISTEN/NOTIFY. The raw
 * {@link https://jsr.io/@carragom/deno-pg-ffi/doc/libpq/ | libpq entry point}
 * provides direct access to the exposed C functions.
 *
 * Requires Deno 2.9+ and libpq 17+. The package is in alpha.
 *
 * ## Quick start
 *
 * Install the package:
 *
 * ```bash
 * deno add jsr:@carragom/deno-pg-ffi@0.1.0-alpha.1
 * ```
 *
 * Save this as `example.ts`:
 *
 * ```ts
 * import { Client } from '@carragom/deno-pg-ffi'
 *
 * await using db = await Client.connect()
 * await using result = await db.query<{ greeting: string }>(
 * 	'SELECT $1::text AS greeting',
 * 	['Hello, PostgreSQL'],
 * )
 * result.rows[0].greeting // 'Hello, PostgreSQL'
 * ```
 *
 * Set `PGURL` to select your database, then run the example with automatic
 * library loading:
 *
 * ```bash
 * deno run --allow-ffi --allow-env --allow-net --allow-read --allow-write example.ts
 * ```
 *
 * To use an installed libpq instead, set `DENO_LIBPQ_PATH`:
 *
 * ```bash
 * DENO_LIBPQ_PATH=/path/to/libpq.so deno run --allow-ffi --allow-env example.ts
 * ```
 *
 * ## Connections and resource disposal
 *
 * {@linkcode Client.connect}, {@linkcode Pool.create}, and
 * {@linkcode Notifier.connect} accept a
 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING | connection string},
 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING-URIS | URL},
 * or {@linkcode ConnectOptions} with string values. Without an argument, they
 * use `PGURL`, then libpq's `PG*` variables and defaults. An explicit argument
 * bypasses `PGURL`. See {@linkcode Client.connect} for connection timeouts.
 *
 * Dispose every successful query or exec result, even when its rows are ignored.
 * Results support `using` or `await using`; connections, pools, checkouts,
 * statements, and notifiers support `await using`. Explicit `close()` is also
 * available; await it for those asynchronous resources. Dispose statements
 * before their connection or checkout, and checkouts before their pool.
 *
 * ## Queries and values
 *
 * - {@linkcode Client.query} runs one statement with `$1`, `$2`, … parameters.
 * - {@linkcode Client.exec} runs one or more statements without parameters.
 * - {@linkcode Client.prepare} creates a statement bound to its connection;
 *   {@linkcode Statement.execute} runs it with parameters.
 *
 * One command can run at a time on a client; overlapping calls throw. Use a
 * pool for concurrency. {@linkcode Client.close} waits for the active command
 * rather than cancelling it. Connections and commands use libpq's nonblocking
 * poll protocol.
 *
 * ### Parameters
 *
 * Pass values in the second argument, in the order of `$1`, `$2`, ….
 * Parameter converters turn supported JavaScript scalar values into the text
 * PostgreSQL expects; `null` is sent as SQL NULL.
 *
 * Use {@linkcode json} for JSON values and {@linkcode array} for PostgreSQL
 * arrays. They produce different text: `json([1, 2])` produces `'[1,2]'`,
 * while `array([1, 2])` produces `'{1,2}'`. Plain objects and arrays cannot be
 * individual parameter values; wrap them to select the intended format.
 *
 * PostgreSQL determines the SQL type from context, such as a table column, or
 * an explicit cast. Here `$1::jsonb` selects JSON and `$2::int4[]` selects an
 * integer array:
 *
 * ```ts
 * import { array, Client, json } from '@carragom/deno-pg-ffi'
 *
 * await using db = await Client.connect()
 * await using result = await db.query<{
 * 	person: { name: string }
 * 	ids: number[]
 * }>(
 * 	'SELECT $1::jsonb AS person, $2::int4[] AS ids',
 * 	[json({ name: 'Ada' }), array([1, 2, 3])],
 * )
 * result.rows[0].person.name // 'Ada'
 * result.rows[0].ids // [1, 2, 3]
 * ```
 *
 * ### Returned values
 *
 * Result converters turn PostgreSQL text into JavaScript values according to
 * each column's PostgreSQL type. An `int4` column becomes a `number`, while an
 * `int8` column becomes a `bigint`, regardless of the supplied parameter's
 * JavaScript type. Types without a result converter remain strings. A generic
 * such as `query<{ ids: number[] }>()` describes the expected row to TypeScript;
 * it does not select converters or validate the returned values.
 *
 * ### Reading results
 *
 * {@linkcode Result.rows} is an indexed, iterable collection with `length` and
 * {@linkcode Rows.at}. Read one row with `result.rows[0]`, or copy all rows into
 * a JavaScript Array with `[...result.rows]`. Commands collect the full native
 * result before returning; each row is converted and cached when first read.
 *
 * Read or copy rows before disposing the result. Access through `result.rows`
 * after disposal throws, but row objects already obtained remain usable, even
 * after their connection closes or is released. SQL errors reject the command
 * with {@linkcode PostgresError}; conversion errors throw when the affected row
 * is first read. See {@linkcode Result} for counts, metadata, and disposal.
 *
 * ## Pooling
 *
 * Connections open as needed, up to {@linkcode PoolOptions.max} (default 10);
 * work waits when all slots are occupied. Creating a pool opens no socket.
 *
 * ```ts
 * import { Pool } from '@carragom/deno-pg-ffi'
 *
 * await using pool = await Pool.create(undefined, { max: 8 })
 * await using result = await pool.query<{ n: number }>('SELECT 1::int4 AS n')
 *
 * await using client = await pool.acquire()
 * await using statement = await client.prepare('SELECT $1::int4 AS n')
 * await using prepared = await statement.execute([2])
 * ```
 *
 * {@linkcode Pool.query} and {@linkcode Pool.exec} reset and release their
 * connection after each command. Results remain readable until disposed.
 * Session settings, temporary tables, prepared statements, and uncommitted
 * transactions do not survive release.
 *
 * Use {@linkcode Pool.acquire} to keep one checkout for a transaction or
 * prepared statement. Send `BEGIN` / `COMMIT` / `ROLLBACK` on that checkout;
 * separate pool commands cannot share a transaction. Release every checkout
 * before awaiting pool shutdown. See {@linkcode Pool.acquire} for a transaction
 * example and {@linkcode Pool.close} for shutdown behavior.
 *
 * ## Notifications
 *
 * {@linkcode Notifier} owns a separate connection for LISTEN/NOTIFY. Send
 * notifications through a client:
 *
 * See {@linkcode Notifier.listen} for listener management and channel limits,
 * and {@linkcode NotifierOptions} for polling and error handling. Receive
 * failures close the notifier; it does not automatically reconnect.
 *
 * ## Value converters
 *
 * Parameter converters turn JavaScript values into PostgreSQL text. Result
 * converters turn PostgreSQL text into JavaScript values. SQL NULL stays null
 * in both directions.
 *
 * {@linkcode Param} describes accepted parameter values. JavaScript types select
 * parameter text; PostgreSQL infers the SQL type, or an explicit cast selects
 * it. No parameter type OIDs are sent. Any SQL type can receive a plain string
 * if PostgreSQL accepts that text. Result converters are selected by column
 * type OIDs:
 *
 * | PostgreSQL type | Parameter value | Received value |
 * | --- | --- | --- |
 * | SQL NULL | `null` | `null` |
 * | bool | `boolean` | `boolean` |
 * | bytea | `Uint8Array` | `Uint8Array` |
 * | int2 / int4 / float4 / float8 | `number` | `number` |
 * | int8 | `bigint` | `bigint` |
 * | numeric | `string` | `string` |
 * | json / jsonb | {@linkcode json} | Parsed JSON |
 * | text / varchar / unknown scalar | `string` | `string` |
 * | date | `Temporal.PlainDate` | `Temporal.PlainDate` |
 * | timestamp | `Temporal.PlainDateTime` | `Temporal.PlainDateTime` |
 * | timestamptz | `Temporal.Instant` | `Temporal.Instant` |
 * | time | `Temporal.PlainTime` | `string`, or opt-in `Temporal.PlainTime` |
 * | interval | `Temporal.Duration` | `string`, or opt-in `Temporal.Duration` |
 * | timetz | `string` | `string` |
 * | Built-in array | {@linkcode array} | Nested arrays of converted values or strings |
 * | Unregistered custom array | Array text | `string` |
 *
 * Built-in arrays preserve nesting and SQL NULL leaves; lower bounds are
 * discarded. Receive parsing honors type delimiters, including semicolons for
 * `box[]`. {@linkcode array} writes comma-delimited text, so arrays using another
 * delimiter require manually formatted parameters.
 *
 * {@linkcode ClientOptions} independently enables strict time and interval
 * conversion, including arrays. Unsupported values throw during row access.
 * Date/timestamp infinity and BC text are also unsupported by the default
 * Temporal parsers. Use text casts or {@linkcode Client.registerScalar} /
 * {@linkcode Pool.registerScalar} to handle them. Custom array conversion uses
 * {@linkcode Client.registerArray} / {@linkcode Pool.registerArray}.
 *
 * ## Loading libpq
 *
 * Both public entry points load libpq at import time, including when only a
 * lazy pool is created. Libraries older than 17 fail during import because
 * required poll symbols are missing.
 *
 * | Setting | Behavior |
 * | --- | --- |
 * | `DENO_LIBPQ_PATH` | Load a local library; takes precedence over the download URL. |
 * | `DENO_LIBPQ_URL` | Override the download base URL when no local path is set. |
 * | Neither set | Load packaged binaries from JSR; source checkouts without `prebuilds/` download from the matching GitHub release. |
 *
 * Packaged binaries support Linux and macOS on x86_64 and aarch64:
 *
 * - Linux: glibc 2.34+ with OpenSSL 3, or glibc 2.28+ with OpenSSL 1.1.1.
 *   The loader tries `libpq-openssl3_<arch>.so`, then
 *   `libpq-openssl11_<arch>.so`. If both fail, the error cause retains both failures.
 * - macOS: 15+, using `libpq_<arch>.dylib` with statically linked OpenSSL.
 *
 * Other platforms require a compatible local library. See the
 * {@link https://github.com/carragom/deno-pg-ffi/blob/main/DEVEL.md#artifact-compatibility | development guide}
 * for artifact filenames, distribution examples, and building libpq locally.
 *
 * `--allow-env` covers loader settings and `PGURL`; downloads also need
 * `--allow-net`, `--allow-read`, and `--allow-write` for the library cache.
 * libpq itself reads `PG*` variables, `.pgpass`, and connection files and opens
 * database sockets through FFI, outside Deno's file/network permission checks.
 *
 * ## Errors and limits
 *
 * SQL errors reject commands with {@linkcode PostgresError}; its diagnostics
 * are copied and the native error result is cleared. Connection, transport,
 * and state failures use ordinary Errors. Invalid parameters throw TypeError.
 * Result converters, including custom callbacks, can throw when a row is first
 * read; dispose the result even when conversion fails.
 *
 * The managed API collects complete text results. It does not provide streaming
 * rows, COPY streaming, pipeline mode, binary decoding, automatic statement
 * caching, or a transaction helper. Commands have no client-side timeout or
 * `AbortSignal`; PostgreSQL's `statement_timeout` can limit SQL execution.
 *
 * The raw `@carragom/deno-pg-ffi/libpq` entry point retains C return codes,
 * NULL pointers, and caller-managed memory. Its supported functions are
 * declared on {@linkcode libpq}; COPY streaming and pipeline functions are not
 * currently exposed. See {@linkcode libpq} for the raw function table.
 *
 * The project uses the MIT license. The package includes `LICENSE` and
 * `THIRD_PARTY_LICENSES.txt`; the latter covers libpq on all platforms and
 * OpenSSL included in macOS binaries.
 *
 * @module
 *
 * @example Receive a notification on a dedicated connection
 * ```ts
 * import { Client, Notifier } from '@carragom/deno-pg-ffi'
 *
 * await using db = await Client.connect()
 * await using notifier = await Notifier.connect()
 * const channel = `example_${crypto.randomUUID().replaceAll('-', '')}`
 * const received = Promise.withResolvers<string>()
 * await notifier.listen(channel, (notification) => {
 * 	received.resolve(notification.extra)
 * })
 * await using sent = await db.query('SELECT pg_notify($1, $2)', [
 * 	channel,
 * 	'hello',
 * ])
 * await received.promise // 'hello'
 * ```
 */
export { Client } from './client/client.ts'
export type { ClientOptions } from './client/client.ts'
export { Pool, PoolClient } from './client/pool.ts'
export type { PoolOptions } from './client/pool.ts'
export { PostgresError } from './client/error.ts'
export { Result, Results } from './client/result.ts'
export type { Field, Rows } from './client/result.ts'
export { Statement } from './client/statement.ts'
export { array, json } from './codecs/params.ts'
export type { Param } from './codecs/params.ts'
export type { Deserialize } from './codecs/registry.ts'
export type { ConnectKeyword, ConnectOptions } from './conninfo.ts'
export { Notifier } from './client/notifier.ts'
export type {
	NotifierOptions,
	Notify,
	NotifyListener,
} from './client/notifier.ts'
