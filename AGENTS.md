# Agents

deno-pg-ffi provides Deno native bindings for PostgreSQL libpq. Read
[README.md](README.md) for the project overview, public JSDoc in
[src/mod.ts](src/mod.ts) and [src/libpq.ts](src/libpq.ts) for API contracts, and
[DEVEL.md](DEVEL.md) for contributor procedures. `deno.json` is the source of
truth for exports, tasks, formatting, and linting. The package requires Deno
2.7+ (native Temporal) and libpq 17+; contributor tooling requires Deno 2.9+.

## Native and protocol invariants

- The root API owns connections/results; callers use `close` or `await using`,
  never `PQfinish`/`PQclear`. A `Client` finishes its connection;
  `PoolClient.close()` resets and releases it. Unregister finalizers before
  explicit native release, and release each handle exactly once. `PGresult`
  outlives `PQfinish`; copied rows and outstanding results survive connection
  close/release. Copy borrowed strings/diagnostics before their owner is freed.
- Serialize native connection access. One command is in flight per client;
  release the busy guard after send/collect, independently of result disposal.
  Close marks the client closed and waits for native operations before
  finishing. Notifier commands, idle polling, and close follow the same lifetime
  discipline.
- Keep raw `./libpq` C return codes and NULL pointers, without SQL exceptions,
  materialization, or automatic cleanup. Internal wrappers/threaded helpers
  throw on NULL/send failure and leave returned handles to callers. Protocol
  helpers transfer raw results; managed callers own SQL errors/materialization.
  `PostgresError` copies diagnostics and never retains a native result.
- `query` uses `PQsendQueryParams` for one parameterized statement; `exec` uses
  `PQsendQuery` for multiple statements. Wait through `PQsocketPoll`; retain
  `PQgetCurrentTimeUSec` and eager loading of all required symbols so old
  libraries fail at import. Use one effective connection-timeout deadline;
  command waits are unlimited.
- Pool creation opens no socket. Commands checkout, reset, and release. Reset
  rolls back an open/failed transaction, sends `DISCARD ALL` separately, and
  restores required DateStyle/extra_float_digits and optional IntervalStyle
  settings. Reset failure finishes the connection. Pool shutdown rejects
  new/queued work and waits for pending connects, checkouts, resets, and
  finishes.
- Statements bind to their preparing connection. Unnamed prepare overwrites;
  unnamed disposal must not deallocate other statements. Named disposal uses
  `DEALLOCATE`. `Notifier` owns its own connection; it is the root listen API.
- Preserve text-protocol converter contracts, private client/shared pool
  registries, strict Temporal errors without normalization/fallback, and
  required session settings. Validate converted text for NUL and numbers for
  finiteness; bytea zero bytes remain valid. See
  [parameter docs](src/codecs/params.ts),
  [client options](src/client/client.ts), and
  [architecture](DEVEL.md#architecture) before changing converters.
- Materialize cached plain row objects lazily; check disposal before returning a
  cached row. Snapshot metadata and copied rows do not require a live result.
  Derive affected-row counts from server command tags, not SQL text; SELECT
  counts are not rows written. Preserve [Result/Rows](src/client/result.ts)
  contracts.

## Tests and examples

- Default tests and runnable documentation must preserve existing data,
  persistent objects, and configuration. Create only temporary tables; qualify
  subsequent reads/writes/drops with `pg_temp`. Check raw table creation
  succeeds before proceeding. Never create/drop databases, roles, permanent
  schemas or tables, change other sessions, or alter persistent settings.
- Session settings, transactions, prepared statements, notifications, and
  terminating connections created by the test are allowed. Cluster setup and
  cleanup may manage only a fresh cluster created for that verification.
- Persistent-change tests must be outside default discovery/tasks, explicitly
  invoked against an explicitly selected disposable database, with documented
  changes/cleanup limited to their own objects. See [testing](DEVEL.md#testing).
- Dispose every successful query/exec result, including ignored `SET`, `BEGIN`,
  and `pg_notify` results. Dispose statements before their client/checkout and
  checkouts before the pool. Use deterministic error examples.
- Put lifetime/UAF cases in `client_lifetime_test.ts`, not `client_test.ts`. Do
  not add COPY/DECLARE cases that can hang the protocol. A hang or segfault is a
  test failure; Deno leak tracing does not track native handles.

## Editing and documentation

- Import internal implementations directly, not through public barrels. Keep
  finalizers with their owning classes. See
  [architecture](DEVEL.md#architecture) for the source map and
  [FFI symbol procedure](DEVEL.md#adding-an-ffi-symbol).
- Match `deno.json` formatting/linting; no `console` in library code. Do not put
  compare benches/npm clients on default test tasks or add `npm:postgres`/
  `npm:pg` to package imports. Avoid bench-discovery filenames for opt-in
  benches; preserve the documented comparison APIs in
  [benchmarks](DEVEL.md#benchmarks).
- Document every public export/member and both entry points with JSDoc; entry
  points need `@module` and runnable examples. Raw functions document ownership,
  return codes, and failures. Deviating pointer wrappers need
  `@tags libpq-deviation` and a **Differs from C** sentence.
- Use "converters" for JavaScript/PostgreSQL value conversion, qualified as
  "parameter converters" or "result converters" to identify the direction.
- When asked to commit, follow the Conventional Commit guidance in
  [releases](DEVEL.md#releases).
- Keep `prebuilds/` uncommitted. JSR includes verified release binaries and
  runtime sources, but excludes README, tests, and developer tooling. Publish
  only through the manual GitHub workflow when explicitly requested.
- Keep precise consumer contracts/examples in public JSDoc, the project overview
  and JSR links in README, and contributor workflows in DEVEL. Inline comments
  explain non-obvious ownership transfers, ordering, and parser constraints; do
  not narrate obvious syntax. Update the relevant documents when behavior
  changes.
- Do not commit `dist/`, coverage, bench JSON, generated baselines, or
  `node_modules/`. Do not rewrite `postgres/` or edit attached plan files. Do
  not change git config, commit, publish, use `--no-verify`, or force-push
  unless the user explicitly asks for that action.

## Verification

Run `deno fmt`, `deno lint`, and `deno task check:docs`. Select the database
explicitly with `PGURL` so all tests/examples use the same target. Configure a
libpq path, or use `deno task test:local` for the default local build. Setup,
permissions, TLS, and platform instructions are in [testing](DEVEL.md#testing)
and [checks before submitting](DEVEL.md#checks-before-submitting).

| Change                   | Additional verification                                                        |
| ------------------------ | ------------------------------------------------------------------------------ |
| Prose only               | Formatting, linting, and `check:docs` suffice.                                 |
| Runnable examples        | `deno test -P --trace-leaks --doc`; `ts ignore` fences are skipped.            |
| Client/notifier/lifetime | Client, lifetime, and notifier suites with `--trace-leaks`.                    |
| Pool/reset               | Above plus `src/client/pool_test.ts`.                                          |
| Converters/conninfo      | Adjacent converter/conninfo tests; managed round trips for behavior changes.   |
| Native symbols/loading   | Relevant raw/native tests; retain the libpq 17+ import-time failure.           |
| Local preload module     | A focused local test, documentation examples, and a benchmark.                 |
| Build/workflows          | Relevant platform/artifact checks from DEVEL; a JS-only check is insufficient. |

The client suites are `src/client/client_test.ts`,
`src/client/client_lifetime_test.ts`, and `src/client/notifier_test.ts`. Use
`deno task test` for the full suite with a selected library, or
`deno task test:local` to build/select the platform default. Custom library
outputs use `DENO_LIBPQ_PATH` with normal test/bench tasks.

## Out of scope unless asked

Pipeline, binary results, managed COPY streaming, query statement caching,
`pg-native`/NAPI comparison, transaction/listen helpers on Client/Pool, pool
`prepare`, and pool `min`/`warm`. Only `.` and `./libpq` are package exports;
`./ffi` and `./thread` remain internal.
