# Deno PG FFI

Deno native bindings for PostgreSQL libpq.

A safe, fast and rich PostgreSQL client built on libpq. The managed API provides
parameterized queries, pooling, prepared statements, notifications, and
automatic resource disposal. The `/libpq` entry point exposes raw C functions
when you need direct access to libpq's capabilities.

Requires **Deno 2.9+** and **libpq 17+**. This is an alpha release; JSR
publication is pending. The examples below run from a source checkout.

## Quick start

```bash
git clone https://github.com/carragom/deno-pg-ffi.git
cd deno-pg-ffi
```

Save this as `example.ts` in the checkout:

```ts
import { Client } from './src/mod.ts'

await using db = await Client.connect()
await using result = await db.query<{ greeting: string }>(
	'SELECT $1::text AS greeting',
	['Hello, PostgreSQL'],
)
result.rows[0].greeting // 'Hello, PostgreSQL'
```

With a local libpq library:

```bash
DENO_LIBPQ_PATH=/path/to/libpq.so deno run --allow-ffi --allow-env example.ts
```

For automatic download, omit `DENO_LIBPQ_PATH` and allow the download/cache:

```bash
deno run --allow-ffi --allow-env --allow-net --allow-read --allow-write example.ts
```

The intended JSR import after publication is:

```ts ignore
import { Client } from 'jsr:@carragom/deno-pg-ffi@0.1.0-alpha.1'
```

The JSR package includes binaries under `prebuilds/` and loads the appropriate
one from JSR. A source checkout without that directory downloads from GitHub.
JSR's overview uses the main module's JSDoc; this README stays on GitHub.

`Client.connect`, `Pool.create`, and `Notifier.connect` accept a connection
string, a `URL`, or a libpq options object with string values. Without an
argument, they use `PGURL`, then libpq's `PG*` variables and defaults. Set
`PGURL` to select your database. See [connection options](src/conninfo.ts) for
precedence and [Client.connect](src/client/client.ts) for timeouts.

Dispose every result, even when you ignore its rows. Use `using` or
`await using` for results, and `await using` for connections, pools, checkouts,
statements, and notifiers. Explicit `.close()` is also available; await it for
those asynchronous resources.

## Pooling

Use a pool for concurrent commands. Connections open as needed, up to `max`
(default 10); work waits when all slots are occupied.

```ts
import { Pool } from './src/mod.ts'

await using pool = await Pool.create(undefined, { max: 8 })
await using result = await pool.query<{ n: number }>('SELECT 1::int4 AS n')

await using client = await pool.acquire()
await using statement = await client.prepare('SELECT $1::int4 AS n')
await using prepared = await statement.execute([2])
```

`pool.query()` and `pool.exec()` reset and release their connection after each
command. Results remain readable until disposed. Session settings, temporary
tables, prepared statements, and uncommitted transactions do not survive
release.

Use one checkout for a transaction or prepared statement. Send explicit `BEGIN`
/ `COMMIT` / `ROLLBACK` on that checkout; separate `pool.query()` calls cannot
share a transaction. Dispose statements before their checkout, and release every
checkout before awaiting pool shutdown. See the
[pool reference](src/client/pool.ts) for a transaction example and shutdown
behavior.

## Queries and values

- `query(sql, params?)` runs one statement with `$1`, `$2`, … parameters.
- `exec(sql)` runs one or more statements without parameters.
- `prepare(sql, name?)` returns a prepared statement bound to its connection;
  `statement.execute(params?)` runs that statement.

A `Client` accepts one command at a time; overlapping calls throw. Use a pool
for concurrency. `Client.close()` waits for the active command rather than
cancelling it.

### Parameters

Pass parameter values in the second argument, in the order of `$1`, `$2`, ….
Strings, numbers, booleans, and other supported scalar values can be passed
directly. Parameter converters turn these JavaScript values into the text
PostgreSQL expects; `null` is sent as SQL NULL.

For structured values, use `json()` to store JSON or `array()` to store a
PostgreSQL array. These helpers produce different text formats: `json([1, 2])`
produces `'[1,2]'`, while `array([1, 2])` produces `'{1,2}'`. Plain JavaScript
objects and arrays cannot be individual parameter values.

PostgreSQL determines each parameter's SQL type from its context, such as a
table column, or from an explicit cast. In this example, `$1::jsonb` tells
PostgreSQL to read the first parameter as JSON, and `$2::int4[]` tells it to
read the second as an integer array:

```ts
import { array, Client, json } from './src/mod.ts'

await using db = await Client.connect()
await using result = await db.query<{
	person: { name: string }
	ids: number[]
}>(
	'SELECT $1::jsonb AS person, $2::int4[] AS ids',
	[json({ name: 'Ada' }), array([1, 2, 3])],
)
result.rows[0].person.name // 'Ada'
result.rows[0].ids // [1, 2, 3]
```

See the [parameter reference](src/codecs/params.ts) for all accepted values and
the `json()` and `array()` helpers.

### Returned values

PostgreSQL also returns values as text. Result converters turn that text into
JavaScript values according to each column's PostgreSQL type. For example, an
`int4` column becomes a `number`, while an `int8` column becomes a `bigint`,
regardless of the JavaScript type of the parameter you supplied.

| PostgreSQL column type             | JavaScript value                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| `bool`                             | `boolean`                                                                        |
| `int2`, `int4`, `float4`, `float8` | `number`                                                                         |
| `int8`                             | `bigint`                                                                         |
| `numeric`                          | `string`, preserving decimal precision                                           |
| `json`, `jsonb`                    | Parsed JSON, including objects and arrays                                        |
| `bytea`                            | `Uint8Array`                                                                     |
| `date`, `timestamp`, `timestamptz` | `Temporal.PlainDate`, `Temporal.PlainDateTime`, `Temporal.Instant`, respectively |
| Built-in PostgreSQL arrays         | JavaScript arrays, with elements converted by their PostgreSQL type              |

SQL NULL becomes `null`. Types without a built-in result converter remain
strings. `time` and `interval` also remain strings by default; enable
`temporalTime` or `temporalInterval` on a client or pool to receive
`Temporal.PlainTime` or `Temporal.Duration`. These converters throw for values
Temporal cannot represent. See [Temporal options](src/client/client.ts) for
supported values and restrictions.

To customize returned values, register result converters with
`client.registerScalar()` or `pool.registerScalar()`; `registerArray()` connects
an array type to its element converter. See the
[value converter reference](src/mod.ts) for the full type list and
[custom result converters](src/client/client.ts) for registration examples. A
generic such as `query<{ ids: number[] }>()` describes the expected row to
TypeScript; it does not select converters or validate returned values.

### Reading results

`result.rows` is an indexed, iterable collection with `.length` and `.at()`. Use
`result.rows[0]` to read one row, or `[...result.rows]` to copy all rows into a
JavaScript Array. The full database result is collected before the query
resolves; each row is converted and cached only when you first read it.

Read or copy rows before disposing their result. Reading rows through
`result.rows` after disposal throws, but row objects you already obtained remain
usable. SQL failures reject the command with
[PostgresError](src/client/error.ts); conversion failures throw when you first
read the affected row. See the [result reference](src/client/result.ts) for
counts, metadata, and disposal.

## Notifications

`Notifier` owns a separate connection for `LISTEN` / `NOTIFY`. Send
notifications through a client:

```ts
import { Client, Notifier } from './src/mod.ts'

await using db = await Client.connect()
await using notifier = await Notifier.connect()
const channel = `example_${crypto.randomUUID().replaceAll('-', '')}`
const received = Promise.withResolvers<string>()
await notifier.listen(channel, (notification) => {
	received.resolve(notification.extra)
})
await using sent = await db.query('SELECT pg_notify($1, $2)', [
	channel,
	'hello',
])
await received.promise // 'hello'
```

See the [notifier reference](src/client/notifier.ts) for listener management,
channel limits, polling options, and error handling. Receive failures close the
notifier; it does not automatically reconnect.

## Loading libpq

Both entry points load libpq at import time, including when creating a lazy
pool. Libraries older than 17 fail during import.

| Setting           | Behavior                                                                |
| ----------------- | ----------------------------------------------------------------------- |
| `DENO_LIBPQ_PATH` | Load a local library; takes precedence over the download URL.           |
| `DENO_LIBPQ_URL`  | Override the download base URL when no local path is set.               |
| Neither set       | Load packaged binaries from JSR; source checkouts download from GitHub. |

Release artifacts support Linux and macOS on x86_64 and aarch64:

- Linux: glibc 2.34+ with OpenSSL 3, or glibc 2.28+ with OpenSSL 1.1.1. The
  loader tries the OpenSSL 3 artifact first, then OpenSSL 1.1.
- macOS: 15+, with OpenSSL included statically.

Other platforms require a compatible local library. See
[artifact compatibility](DEVEL.md#artifact-compatibility) for filenames and
distribution examples, or [build libpq](DEVEL.md#building-libpq) locally.

`--allow-env` covers loader settings and `PGURL`; downloads need Deno network
and cache permissions. libpq itself opens database sockets and reads `PG*`
variables, `.pgpass`, and connection files through FFI, outside Deno's network
and file permission checks.

## Limits and reference

The managed API collects complete text results. It does not provide streaming
rows, COPY streaming, pipeline mode, binary decoding, automatic query statement
caching, or a transaction helper. Queries have no client-side timeout or
`AbortSignal`; PostgreSQL's `statement_timeout` can limit SQL execution.

The raw `jsr:@carragom/deno-pg-ffi/libpq` entry point preserves C return codes,
NULL pointers, and ownership rules. Its supported functions are declared on
`Libpq`; COPY streaming and pipeline functions are not currently exposed.

- [Managed API documentation](src/mod.ts) — public JSDoc and runnable examples.
- [Raw libpq documentation](src/libpq.ts) — C arguments, errors, and ownership.
- [Development guide](DEVEL.md) — building, testing, benchmarks, and releases.
- [Third-party licenses](THIRD_PARTY_LICENSES.txt) — libpq on all platforms and
  OpenSSL included in macOS binaries; also available as a release asset.
