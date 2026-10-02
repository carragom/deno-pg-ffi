# @carragom/deno-pg-ffi

Deno native bindings for PostgreSQL libpq.

A safe, fast PostgreSQL client built on libpq. The managed API provides
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
- `exec(sql)` runs one or more statements without parameters and returns a
  disposable batch of results.
- `prepare(sql, name?)` returns a statement bound to its connection;
  `statement.execute(params?)` reuses it.

A `Client` accepts one command at a time; overlapping calls throw. Use a pool
for concurrency. `Client.close()` waits for the active command rather than
cancelling it. Generic row types are TypeScript contracts, not runtime
validation.

The client uses text parameters and results. Use `json()` for objects and
`array()` for arrays; plain objects and arrays are not accepted as parameters.
SQL casts select their PostgreSQL types:

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

Built-in mappings include booleans, numbers, `int8` as `bigint`, bytea as
`Uint8Array`, parsed JSON, arrays, and Temporal dates/timestamps. `numeric` and
unknown scalar types remain strings. `time` and `interval` remain strings unless
`temporalTime` or `temporalInterval` enables their strict Temporal codec;
unsupported values can throw when a row is read. Client and pool registration
methods allow custom deserializers. See the [type mappings](src/mod.ts),
[parameter reference](src/codecs/params.ts), and
[Temporal options](src/client/client.ts).

Rows are indexed and iterable, with `.length` and `.at()`; use
`[...result.rows]` for an Array. Row objects are decoded lazily, but the
complete native result is buffered before the command resolves. Read rows before
disposing their result; row objects already copied out remain usable. SQL
failures throw [PostgresError](src/client/error.ts). See the
[result reference](src/client/result.ts) for counts, metadata, and lifetime
rules.

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

| Setting           | Behavior                                                       |
| ----------------- | -------------------------------------------------------------- |
| `DENO_LIBPQ_PATH` | Load a local library; takes precedence over the download URL.  |
| `DENO_LIBPQ_URL`  | Override the download base URL when no local path is set.      |
| Neither set       | Download from the GitHub release matching the package version. |

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
