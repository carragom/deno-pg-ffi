/**
 * Deno native bindings for PostgreSQL libpq.
 *
 * A safe, fast PostgreSQL client built on libpq, with parameterized queries,
 * pooling, prepared statements, notifications and automatic resource disposal.
 * Use {@linkcode Client} for one connection, {@linkcode Pool} for concurrent
 * commands and {@linkcode Notifier} for LISTEN/NOTIFY. The raw
 * {@link https://jsr.io/@carragom/deno-pg-ffi/doc/libpq/ | libpq entry point}
 * provides direct access to the exposed C functions.
 *
 * Requires Deno 2.7+ for native Temporal support and libpq 17+.
 * The package is in alpha.
 *
 * ## Quick start
 *
 * Install the package:
 *
 * ```bash
 * deno add jsr:@carragom/deno-pg-ffi@0.1.0-alpha.3
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
 * console.log(result.rows[0].greeting) // Hello, PostgreSQL
 * ```
 *
 * Set `PGURL` to select your database, then run the example with automatic
 * library loading:
 *
 * ```bash
 * deno run -A example.ts
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
 * {@linkcode Client.connect}, {@linkcode Pool.create} and
 * {@linkcode Notifier.connect} accept a
 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING | connection string},
 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING-URIS | URL}
 * or {@linkcode ConnectOptions} with string values. Without an argument, they
 * use `PGURL` if defined or libpq's defaults. An explicit argument
 * bypasses `PGURL`. See {@linkcode Client.connect} for connection timeouts.
 *
 * Dispose every successful query or exec result, even when its rows are ignored.
 * Results support `using` or `await using`. Connections, pools, checkouts,
 * statements and notifiers support `await using`. Explicit `close()` is also
 * available; await it for those asynchronous resources. Dispose statements
 * before their connection or checkout and checkouts before their pool.
 *
 * ## Queries and results
 *
 * - {@linkcode Client.query} runs one statement with `$1`, `$2`, etc parameters.
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
 * Pass parameter values in the second argument, in the order of `$1`, `$2`, etc.
 * Use placeholders for values rather than interpolating them into SQL text.
 *
 * Use {@linkcode json} for JSON values and {@linkcode array} for PostgreSQL
 * arrays. Plain objects and arrays cannot be individual parameter values;
 * wrap them as shown below.
 *
 * This example sends a JSON object and an integer array:
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
 * console.log(result.rows[0].person.name) // Ada
 * console.log(result.rows[0].ids) // [1, 2, 3]
 * ```
 *
 * ### Reading results
 *
 * {@linkcode Result.rows} is an indexed, iterable collection with `length` and
 * {@linkcode Rows.at}. Read one row with `result.rows[0]`, or copy all rows into
 * a JavaScript Array with `[...result.rows]`. Commands collect the full native
 * result before returning; each row is converted and cached when first read.
 * A generic such as `query<{ ids: number[] }>()` describes the expected row
 * to TypeScript; it does not change or validate the returned values. See
 * [Value converters](#value-converters) for supported types and conversion rules.
 *
 * Read or copy rows before disposing the result. Access through `result.rows`
 * after disposal throws, but row objects already obtained remain usable, even
 * after their connection closes or is released. SQL errors reject the command
 * with {@linkcode PostgresError}; conversion errors throw when the affected row
 * is first read. See {@linkcode Result} for counts, metadata and disposal.
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
 * console.log(result.rows[0].n) // 1
 *
 * await using client = await pool.acquire()
 * await using statement = await client.prepare('SELECT $1::int4 AS n')
 * await using prepared = await statement.execute([2])
 * console.log(prepared.rows[0].n) // 2
 * ```
 *
 * {@linkcode Pool.query} and {@linkcode Pool.exec} reset and release their
 * connection after each command. Results remain readable until disposed.
 * Session settings, temporary tables, prepared statements and uncommitted
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
 * {@linkcode Notifier} owns a separate connection to LISTEN for NOTIFY events. Send
 * notifications through a client:
 *
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
 * console.log(await received.promise) // hello
 * ```
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
 * {@linkcode Param} lists the JavaScript values you can pass as parameters.
 * The client sends each non-null value as text. PostgreSQL interprets that text
 * using the type required by the query: for example, `$1::int4` accepts either
 * the number `42` or the string `'42'`. You can also pass a string for a type
 * without a built-in parameter converter, provided it uses that type's
 * PostgreSQL input format.
 *
 * {@linkcode json} and {@linkcode array} produce text for different SQL types:
 * `json([1, 2])` produces `'[1,2]'` for JSON, while `array([1, 2])` produces
 * `'{1,2}'` for a PostgreSQL array.
 *
 * Returned values are converted according to the column's PostgreSQL type,
 * independently of the JavaScript value you sent. For example, `int4` results
 * become numbers and `int8` results become bigints. Types without a result
 * converter remain strings. The table below shows the built-in parameter and
 * result conversions:
 *
 * | PostgreSQL type | Parameter value | Received value |
 * | --- | --- | --- |
 * | SQL NULL | `null` | `null` |
 * | bool | `boolean` | `boolean` |
 * | bytea | `Uint8Array` | `Uint8Array` |
 * | int2 / int4 / float4 / float8 | `number` | `number` |
 * | int8 | `bigint` | `bigint` |
 * | numeric | `string` | `string` |
 * | json / jsonb | {@linkcode json | json()} | Parsed JSON, or opt-out `string` |
 * | text / varchar / unknown scalar | `string` | `string` |
 * | date | `Temporal.PlainDate` | `Temporal.PlainDate`, or opt-out `string` |
 * | timestamp | `Temporal.PlainDateTime` | `Temporal.PlainDateTime`, or opt-out `string` |
 * | timestamptz | `Temporal.Instant` | `Temporal.Instant`, or opt-out `string` |
 * | time | `Temporal.PlainTime` | `string`, or opt-in `Temporal.PlainTime` |
 * | interval | `Temporal.Duration` | `string`, or opt-in `Temporal.Duration` |
 * | timetz | `string` | `string` |
 * | Built-in array | {@linkcode array | array()} | Nested arrays, or opt-out PostgreSQL text |
 * | Unregistered custom array | Array text | `string` |
 *
 * Parsed arrays preserve nesting and SQL NULL leaves; lower bounds are
 * discarded. Receive parsing honors type delimiters, including semicolons for
 * `box[]`. {@linkcode array} writes comma-delimited text, so arrays using another
 * delimiter require manually formatted parameters.
 *
 * ### JSON and array conversion options
 *
 * Set `parseJson: false` in {@linkcode ClientOptions} or {@linkcode PoolOptions}
 * to receive JSON/JSONB as PostgreSQL text instead of using `JSON.parse`.
 * This preserves number precision and distinguishes JSON null (`'null'`)
 * from SQL NULL (`null`). JSONB text still reflects PostgreSQL's normalization,
 * not the original input's whitespace, key order, or duplicate keys.
 *
 * Set `parseArrays: false` to receive whole PostgreSQL arrays as text,
 * preserving lower bounds and skipping element converters. These options
 * are independent: disabling JSON parsing alone leaves parsed JSON/JSONB
 * arrays with JSON text elements. Neither option changes parameters.
 *
 * ```ts
 * import { Client } from '@carragom/deno-pg-ffi'
 *
 * await using db = await Client.connect(undefined, {
 * 	parseJson: false,
 * 	parseArrays: false,
 * })
 * await using result = await db.query<{ document: string; values: string }>(
 * 	`SELECT '{"n":9007199254740993}'::jsonb AS document,
 * 	'[5:6]={1,2}'::int4[] AS values`,
 * )
 * console.log(result.rows[0].document) // {"n": 9007199254740993}
 * console.log(result.rows[0].values) // [5:6]={1,2}
 * ```
 *
 * With JSON parsing enabled, large integers and precise decimals can lose
 * precision, and sufficiently large numbers become JavaScript infinities.
 * JSON null and SQL NULL both become `null`.
 *
 * ### Temporal conversion options
 *
 * By default, `date`, `timestamp`, and `timestamptz` results are Temporal
 * values. Set `temporalDate`, `temporalTimestamp`, or `temporalTimestamptz`
 * to `false` in {@linkcode ClientOptions} to keep that type's PostgreSQL text.
 * For example, disable all three when reading values such as infinity:
 *
 * ```ts
 * import { Client } from '@carragom/deno-pg-ffi'
 *
 * await using db = await Client.connect(undefined, {
 * 	temporalDate: false,
 * 	temporalTimestamp: false,
 * 	temporalTimestamptz: false,
 * })
 * await using result = await db.query<{
 * 	d: string
 * 	ts: string
 * 	at: string
 * }>(`SELECT date 'infinity' AS d,
 * 	timestamp 'infinity' AS ts, timestamptz 'infinity' AS at`)
 * console.log(result.rows[0]) // { d: 'infinity', ts: 'infinity', at: 'infinity' }
 * ```
 *
 * By default, `time` and `interval` results are strings. Set `temporalTime`
 * or `temporalInterval` in {@linkcode ClientOptions} to receive
 * `Temporal.PlainTime` or `Temporal.Duration`, respectively. Each option also
 * applies to array elements when `parseArrays` is enabled. All five Temporal
 * options are independent
 * and also apply to {@linkcode PoolOptions}. They affect returned values,
 * not accepted parameters.
 *
 * ### Temporal limits
 *
 * PostgreSQL can store values that Temporal cannot represent, such as
 * `time '24:00:00'`, intervals with mixed-sign components, infinite
 * dates/timestamps, and dates/timestamps beyond Temporal's range.
 * Temporal supports years before AD 1 and years above 9999, but the current
 * converters do not translate PostgreSQL's notation for those years into
 * Temporal's ISO format.
 * Reading an affected row throws; the converters do not normalize these values
 * or fall back to strings. Cast the column to `text` in SQL to read its
 * PostgreSQL text representation instead, or disable the corresponding
 * converter. See {@linkcode ClientOptions} for each converter's limits.
 *
 * ### Floating-point results
 *
 * `float8` results use `Number(text)`. `float4` results use
 * `Math.fround(Number(text))` to reconstruct the stored 32-bit value as a
 * JavaScript number. This also applies to parsed `float4[]` elements.
 * Managed connections set `extra_float_digits = 3` and restore it after pool
 * reset so PostgreSQL sends enough digits to retain stored floating-point
 * values, including on PostgreSQL 10–11. Lowering this setting can lose
 * precision. For example, a float4 stored from `0.1` is returned
 * as `0.10000000149011612`, its exact 32-bit value represented in JavaScript.
 *
 * PostgreSQL floating-point `Infinity`, `-Infinity`, and `NaN` map to the same
 * JavaScript special values. Numeric parameters must be finite; send special
 * values as strings with an SQL cast such as `$1::float8`.
 *
 * ### Custom result converters
 *
 * Use {@linkcode Client.registerScalar} or {@linkcode Pool.registerScalar}
 * to override how a PostgreSQL scalar type is read. This can handle unsupported
 * values or provide a different JavaScript representation. Use
 * {@linkcode Client.registerArray} or {@linkcode Pool.registerArray} to
 * configure conversion for an array type, including its element type. Explicit
 * scalar registrations override `parseJson` and Temporal defaults; explicit
 * array registrations enable parsing for that type even with `parseArrays: false`.
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
 * for artifact filenames, distribution examples and building libpq locally.
 *
 * `--allow-env` covers loader settings and `PGURL`; downloads also need
 * `--allow-net`, `--allow-read` and `--allow-write` for the library cache.
 * libpq itself reads `PG*` variables, `.pgpass` and connection files and opens
 * database sockets through FFI, outside Deno's file/network permission checks.
 *
 * ## Errors
 *
 * SQL errors reject commands with {@linkcode PostgresError}, which provides
 * the SQLSTATE code and server diagnostics. Connection, transport, and state
 * failures (such as using a closed or busy client) use ordinary Errors.
 * Invalid parameters throw TypeError.
 * Result converters, including custom callbacks, can throw when a row is first
 * read; dispose the result even when conversion fails.
 *
 * ## Current limits
 *
 * The managed API collects complete text results. It does not provide streaming
 * rows, COPY streaming, pipeline mode, binary decoding, automatic statement
 * caching, or a transaction helper. Commands have no client-side timeout or
 * `AbortSignal`; PostgreSQL's `statement_timeout` can limit SQL execution.
 *
 * ## Raw libpq API
 *
 * The raw `@carragom/deno-pg-ffi/libpq` entry point retains C return codes,
 * NULL pointers and caller-managed memory. Its supported functions are
 * exposed as named `PQ*` exports; COPY streaming and pipeline functions are not
 * currently exposed. See the
 * {@link https://jsr.io/@carragom/deno-pg-ffi/doc/libpq/ | raw entry point}
 * for individual function contracts.
 *
 * ## License
 *
 * The project uses the MIT license. The package includes `LICENSE` and
 * `THIRD_PARTY_LICENSES.txt`; the latter covers libpq on all platforms and
 * OpenSSL included in macOS binaries.
 *
 * @module
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
