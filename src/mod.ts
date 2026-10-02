/**
 * Deno native bindings for PostgreSQL libpq.
 *
 * A managed PostgreSQL client with explicit resource ownership and libpq's
 * native transport. Use {@linkcode Client} for one connection, {@linkcode Pool}
 * for concurrent commands, and {@linkcode Notifier} for LISTEN/NOTIFY. Prepared
 * statements, transactions through SQL, and custom result converters are
 * supported.
 * Connections and commands use libpq's nonblocking poll protocol.
 *
 * Install the alpha with `deno add jsr:@carragom/deno-pg-ffi@0.1.0-alpha.1`,
 * then import the managed API from `@carragom/deno-pg-ffi`. Running an example
 * with automatic library loading requires
 * `deno run --allow-ffi --allow-env --allow-net --allow-read --allow-write example.ts`.
 *
 * Dispose connections, checkouts, statements, and results with `await using`
 * or their `close` methods. {@linkcode Result} owns its data independently of
 * the connection. Commands collect the full native result before returning;
 * {@linkcode Rows} converts and caches each row when first read.
 *
 * ## Connections and library loading
 *
 * Requires Deno 2.9+ and libpq 17+. Both public entry points load libpq at
 * import time, including when only a lazy pool is created. `DENO_LIBPQ_PATH`
 * selects a local library and takes precedence over `DENO_LIBPQ_URL`, which
 * overrides the download base URL. With neither set, the loader downloads
 * the selected binary from this package's `prebuilds/` directory on JSR and
 * caches it locally. A source checkout without `prebuilds/` downloads from
 * the matching GitHub release. Older libraries fail
 * during import because required poll symbols are missing.
 *
 * Local loading requires `--allow-ffi` and environment access for loader
 * settings. Downloads also require `--allow-net`, `--allow-read`, and
 * `--allow-write` for the library cache. libpq itself reads its `PG*` variables,
 * `.pgpass`, and connection files and opens database sockets through FFI;
 * Deno's corresponding file/network permissions do not control those operations.
 *
 * Linux downloads try `libpq-openssl3_<arch>.so`, then
 * `libpq-openssl11_<arch>.so`; a failed import retains both failures in its
 * error cause. macOS 15+ uses `libpq_<arch>.dylib` with statically linked OpenSSL.
 * Architectures are `x86_64` and `aarch64`. Other platforms require a compatible
 * local library.
 *
 * {@linkcode Client.connect}, {@linkcode Notifier.connect}, and
 * {@linkcode Pool.create} take an optional
 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING | connection string},
 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING-URIS | URL},
 * or {@linkcode ConnectOptions}. Omit it to use `PGURL`, then libpq `PG*`
 * variables and defaults. See {@linkcode Client.connect} for precedence and
 * connection timeouts.
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
 * ## Errors and advanced access
 *
 * SQL errors reject commands with {@linkcode PostgresError}; its diagnostics
 * are copied and the native error result is cleared. Connection/transport/state
 * failures use ordinary Errors. Invalid parameters throw TypeError. Result
 * converters, including custom callbacks, can throw when a row is first read;
 * dispose the result even when conversion fails.
 *
 * Managed commands do not offer streaming COPY, pipeline mode, binary results,
 * a statement cache, or command cancellation. For direct access to the exposed
 * C functions, use `@carragom/deno-pg-ffi/libpq`. That entry point retains raw
 * return codes, pointers, and caller-managed memory.
 *
 * @module
 *
 * @example
 * ```ts
 * import { Client } from '@carragom/deno-pg-ffi'
 *
 * await using db = await Client.connect()
 * await using r = await db.query<{ n: number }>(
 * 	'SELECT $1::int4 AS n',
 * 	[1],
 * )
 * if (r.rows[0].n !== 1) {
 * 	throw new Error('expected 1')
 * }
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
