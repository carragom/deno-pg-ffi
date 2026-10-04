# Developing deno-pg-ffi

Deno native bindings for PostgreSQL libpq. See the
[JSR documentation](https://jsr.io/@carragom/deno-pg-ffi) for usage and
[AGENTS.md](AGENTS.md) for agent constraints. [deno.json](deno.json) defines the
package, tasks, and tooling settings.

## Getting started

Use Deno 2.9+ for contributor tooling, a reachable PostgreSQL database, and
libpq 17+. The package itself supports Deno 2.7+: FFI stabilized in
[Deno 2.0](https://deno.com/blog/v2.0-release-candidate#stable-apis), but its
native Temporal converters require
[Deno 2.7](https://deno.com/blog/v2.7#temporal-api-stabilized). The test suite
uses newer test hooks, and CI pins its Deno version in
[the setup action](.github/actions/setup-deno/action.yml).

To build libpq, install a C toolchain, `make`, `bison`, `flex`, Perl, and
OpenSSL development headers/libraries. Linux and macOS builds are supported;
Windows builds are not implemented.

```bash
git clone --recurse-submodules https://github.com/carragom/deno-pg-ffi.git
cd deno-pg-ffi
export PGURL='postgresql:///mydb?host=/var/run/postgresql'
deno task test:local
```

Replace `PGURL` with the intended database. Local tasks do not create or manage
clusters; the default suite supports existing databases under the
[preservation rules](#testing). For an existing clone, initialize the build
sources with `git submodule update --init --recursive`.

`postgres/` is the PostgreSQL source submodule (`REL_17_STABLE`), excluded from
Deno formatting, linting, and test discovery. On macOS, install the
[Homebrew prerequisites](#building-libpq) before the first build. To use an
existing library instead of building, set `DENO_LIBPQ_PATH` and run
`deno task test`.

## Building libpq

```bash
deno task build:libpq
```

The build enables OpenSSL and disables GSSAPI, ICU, readline, and zlib. It
writes `dist/libpq_<arch>.so` on Linux or `dist/libpq_<arch>.dylib` on macOS.
Existing outputs are reused. Use `--force` (or `-f`) after changing sources,
dependencies, or build options; use `-o` to choose a different output filename.
Configure/make failures preserve the previous output.

On macOS, Homebrew's bison/flex binaries must be on PATH. The script detects
`brew --prefix openssl@3`; `--openssl-prefix` selects another installation:

```bash
brew install bison flex openssl@3
export PATH="$(brew --prefix bison)/bin:$(brew --prefix flex)/bin:$PATH"
deno task build:libpq
```

A normal macOS build links OpenSSL dynamically and needs that installation at
runtime. To build a redistributable dylib:

```bash
deno task build:libpq --openssl-prefix "$(brew --prefix openssl@3)" \
  --static-openssl --force
```

Static builds stage only OpenSSL archives, reject non-system dylib dependencies,
set a relocatable install name, and apply an ad hoc signature. Users of those
assets need no Homebrew installation. OpenSSL updates require rebuilding these
assets. Include [THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) when
distributing native binaries: it contains PostgreSQL's license for every
platform and OpenSSL's license for the macOS builds.

`test:local` and `bench:local` build first, then run Deno directly with
`--preload=./scripts/select-local-libpq.ts`. The preload selects the default
filename for the current OS/architecture and overrides inherited
`DENO_LIBPQ_PATH` before library imports:

```bash
deno task test:local src/native/load_test.ts
deno task bench:local --filter='prepared execute'
```

For custom output names or system libraries, set `DENO_LIBPQ_PATH` and use
`test` or `bench`. Both public entry points eagerly load the complete symbol
table; older libraries fail at import because `PQsocketPoll` and
`PQgetCurrentTimeUSec` require libpq 17+.

## Artifact compatibility

Without `DENO_LIBPQ_PATH`, a source checkout without `prebuilds/` downloads from
the GitHub release matching the package version. `DENO_LIBPQ_URL` overrides that
download base URL. Linux tries `libpq-openssl3_<arch>.so`, then
`libpq-openssl11_<arch>.so`; macOS selects `libpq_<arch>.dylib`. `<arch>` is
`x86_64` or `aarch64`, matching the running Deno binary.

Linux release assets require the matching architecture and runtime libraries:

- `libpq-openssl3_<arch>.so`: glibc 2.34+ and OpenSSL 3.x shared libraries.
- `libpq-openssl11_<arch>.so`: glibc 2.28+ and OpenSSL 1.1.1 shared libraries.

Examples with standard libraries; later OS releases must still meet the
requirements above:

| Example OS              | glibc | OpenSSL                | Expected artifact           |
| ----------------------- | ----- | ---------------------- | --------------------------- |
| RHEL 8 / AlmaLinux 8    | 2.28  | 1.1.1                  | `libpq-openssl11_<arch>.so` |
| RHEL 9+ / AlmaLinux 9+  | 2.34+ | 3.x                    | `libpq-openssl3_<arch>.so`  |
| Ubuntu 20.04            | 2.31  | 1.1.1                  | `libpq-openssl11_<arch>.so` |
| Ubuntu 22.04+           | 2.35+ | 3.x                    | `libpq-openssl3_<arch>.so`  |
| Debian 11               | 2.31  | 1.1.1                  | `libpq-openssl11_<arch>.so` |
| Debian 12+              | 2.36+ | 3.x                    | `libpq-openssl3_<arch>.so`  |
| macOS 15+ Apple Silicon | —     | 3, included statically | `libpq_aarch64.dylib`       |
| macOS 15+ Intel         | —     | 3, included statically | `libpq_x86_64.dylib`        |

Other systems can use a compatible local libpq via `DENO_LIBPQ_PATH`. Download
failure causes retain the loader errors; on Linux they include both OpenSSL
variants.

## Testing

Set `PGURL` explicitly so managed tests, raw tests, and documentation examples
use the same database. Some integration tests otherwise default to
`postgresql://localhost`, while raw tests and examples use libpq defaults.
Test/bench tasks use `-P` with the permission profiles in `deno.json`, currently
all permissions.

```bash
deno task test          # selected local library or downloaded artifact
deno task test:local    # build and select the default dist/ library
```

Both test tasks include documentation examples and leak tracing.

The default suite and runnable documentation examples must preserve existing
data, persistent objects, and persistent configuration. Create only temporary
tables; qualify subsequent reads, writes, and explicit drops with `pg_temp` so
failed setup cannot fall back to a permanent table. Raw tests must check that
temporary-table creation succeeded before using it. Remaining temporary tables
disappear when their connection closes.

Tests may change their own session settings, use transactions and prepared
statements, send notifications, and terminate connections they created. They
must not create/drop databases, roles, permanent schemas/tables, modify other
sessions, or alter persistent configuration. The role needs temporary-table
permissions and permission to terminate its own test connections. Normal
database activity still affects logs/statistics.

Tests requiring persistent changes must run separately, outside default
discovery and tasks. Require explicit invocation and an explicitly selected
disposable database; document changes and cleanup. Setup and cleanup may manage
only objects or fresh clusters they created. CI owns its disposable clusters;
local test tasks do not manage clusters.

Tests live beside their modules. Client/notifier/lifetime changes require the
three focused suites below; include the pool suite after pool/reset changes:

```bash
export DENO_LIBPQ_PATH=/path/to/libpq.so
deno test -P --trace-leaks \
  src/client/client_test.ts src/client/client_lifetime_test.ts \
  src/client/notifier_test.ts src/client/pool_test.ts
```

Keep dispose/close/use-after-free cases in `client_lifetime_test.ts`. A hang or
segfault is a failure. `--trace-leaks` sees Deno operations, not native
`PGconn`/`PGresult` allocations; lifetime soaks and use-after-dispose cases
cover those. Do not add `COPY`/`DECLARE` tests that can stall the protocol.

`LIBPQ_TEST_TLS=1` is the TLS regression test's only gate. It requires a
TLS-enabled PostgreSQL TCP URL with `sslmode=require` and checks `pg_stat_ssl`.
For Unix sockets, leave it unset or use `LIBPQ_TEST_TLS=0`:

```bash
PGURL='postgresql:///mydb?host=/var/run/postgresql' LIBPQ_TEST_TLS=0 deno task test:local
```

To run the TLS test alone, set the required TCP `PGURL` and `LIBPQ_TEST_TLS=1`,
then run:

```bash
deno task test:local --filter='TLS-required connection negotiates encryption' src/client/client_test.ts
```

Verify preload changes with a focused local test, documentation examples, and a
benchmark. See [CI](#ci) for artifact, download, and system-library coverage.

## Checks before submitting

```bash
deno fmt
deno lint
deno check src/mod.ts src/libpq.ts
deno task check:docs
deno publish --dry-run --allow-dirty
```

Follow `deno.json` settings. Library code does not log to `console`; scripts
that log use a scoped lint suppression. Both public entry points need `@module`
documentation and runnable examples; every public export/member needs JSDoc.
`check:docs` lints that API documentation, without executing examples or
checking README.

For prose-only changes, fmt/lint and `check:docs` suffice. When changing
runnable JSDoc or README examples, also run with `PGURL` and the library
configured:

```bash
deno test -P --trace-leaks --doc
```

`--doc` runs TypeScript JSDoc examples and runnable README fences. Fences marked
`ts ignore` are skipped. Dispose every successful query/exec result, including
ignored `SET`, `BEGIN`, and `pg_notify` results. Dispose statements before their
client/checkout and checkouts before the pool. Apply the database-preservation
rules to examples too.

The publish dry run validates the package without uploading it; `--allow-dirty`
permits local changes. Do not commit `dist/`, `coverage/`, bench JSON, CI
baselines, or `node_modules/`. The package intentionally has `lock: false`.

## Architecture

| Path               | Responsibility                                                         |
| ------------------ | ---------------------------------------------------------------------- |
| `src/mod.ts`       | Managed public API                                                     |
| `src/libpq.ts`     | Raw public `libpq.PQ*` table, `Libpq`, C enums, and pointer types      |
| `src/client/`      | Client, pool, statements, results, SQL errors, and notifier            |
| `src/protocol/`    | Poll handshake, socket waits, command flushing and result collection   |
| `src/codecs/`      | Parameter text, array parsing/quoting, and OID registry                |
| `src/native/`      | FFI types/symbols/loading, strings, wrappers, threads, platform naming |
| `src/conninfo.ts`  | Connection types, URL parsing, conninfo resolution                     |
| `src/constants.ts` | Environment variable names                                             |

Only `.` and `./libpq` are package exports; wrappers and threaded helpers remain
internal. Implementation modules import each other directly, avoiding public
barrels. Public contracts belong in JSDoc; comments beside complex branches
explain implementation constraints.

Connection/result finalizers stay with their owning classes. Managed APIs own
handles and SQL errors; raw functions preserve C return codes and NULL pointers.
`src/protocol/command.ts` transfers collected raw results to callers and clears
partial results on transport failure. Internal adapters copy strings and free
temporary allocations; callers still own returned handles.

`PGresult` outlives `PQfinish`. Explicit disposal must unregister the finalizer
before native cleanup; double clear/finish is a native crash. A client command
guard covers sending and collection, independently of result disposal. Client
close waits for native work before finishing. The notifier serializes commands,
idle polling, and teardown on its own connection.

The handshake obtains the effective `connect_timeout` through `PQconninfo` and
uses one poll deadline; command waits are unlimited. `PQsocketPoll` waits inside
libpq; Deno FFI `nonblocking: true` moves the wait off the JavaScript thread.

Pool reset rolls back open/failed transactions, sends `DISCARD ALL` separately,
then restores converter session settings. Combining reset SQL would put
`DISCARD ALL` inside an implicit transaction. The pool shares its registry with
connections and retained results, so overrides affect unread rows, while
materialized rows stay cached.

Result converters depend on `DateStyle = 'ISO, YMD'` and, when enabled,
`IntervalStyle = iso_8601`. PostgreSQL interval fields have independent signs;
keep calendar months/days separate from elapsed time and preserve signed
fractions. Unsupported values throw during lazy row access when their Temporal
converter is enabled. Date/timestamp/timestamptz converters default to enabled
and can be independently disabled to preserve PostgreSQL text, including array
leaves. Registries capture these options at creation and retain them across pool
reset; explicit custom converters take precedence. Result converter details and
user options are documented on the managed API; converter tests live beside
their implementations.

Float4 results round parsed text with `Math.fround` to reconstruct the stored
32-bit value in a JavaScript number, including array leaves. Float8 and integer
result converters continue to use `Number` or `BigInt` as appropriate.

## Adding an FFI symbol

1. Declare it on the `Libpq` interface and `symbols` in `src/native/symbols.ts`.
   The raw table exposes required symbols.
2. Document C arguments, return codes, NULL cases, and ownership/lifetime on
   `Libpq`.
3. Add an internal adapter in `src/native/wrappers.ts` if managed code needs it.
   An adapter that differs from C needs `@tags libpq-deviation` and a **Differs
   from C** sentence.
4. Test raw behavior in `src/libpq_test.ts`, adapter behavior in
   `src/native/wrappers_test.ts`, and relevant threaded/managed callers.

## Benchmarks

```bash
deno task bench          # regression micros
deno task bench:local    # build and select the local library
deno task bench:compare  # postgres.js / npm:pg comparison, outside CI
```

Regression micros connect once and include result disposal in the timer.
`bench/client.ts` creates a session-temporary `bench_insert` table.
`bench/compare.ts` creates, truncates, and repopulates the persistent
`bench_world` table: select a disposable database explicitly for that benchmark.
Its JavaScript clients require a PostgreSQL URL in `PGURL`, rather than
keyword-form conninfo.

These files deliberately do not match Deno's `*_bench.ts` discovery glob; use
the tasks or pass their paths. Keep comparison imports outside the default test
task and `deno.json` imports.

Each comparison group measures the documented API:

| Group              | Client                | postgres.js               | npm:pg                   |
| ------------------ | --------------------- | ------------------------- | ------------------------ |
| `prepared-params`  | `prepare` + `execute` | tagged `` sql`… ${id}` `` | `{ name, text, values }` |
| `simple-no-params` | `exec(sql)`           | `unsafe(sql)`             | `query(sql)`             |
| `simple-params`    | `query(sql, [id])`    | `unsafe(sql, [id])`       | `query(sql, [id])`       |

`postgres.js` `unsafe()` disables preparation; tagged queries are its prepared
path. A prepared one-row SELECT at roughly 1.05× is a tie; losing to `npm:pg` on
that micro is expected from FFI/result overhead. Do not use TE Single Query as
the success metric.

Linux x86_64 PR CI benchmarks the PR and a worktree of `base.sha`.
`scripts/compare-bench-json.ts` fails if a base benchmark is missing on the PR,
the base has no usable benchmarks or a nonpositive average, or a PR average is
more than 20% slower. If the base lacks `bench/client.ts`, it skips comparison.
Generated measurements and baselines are not committed.

## Public documentation

README introduces the project and directs consumers to JSR. Keep installation,
examples, platform requirements, and API contracts in public JSDoc; the default
module comment in `src/mod.ts` supplies JSR's overview.

Use symbolic JSDoc references such as `{@linkcode Client}` and
`{@linkcode Client.query}` for API links so editors and documentation generators
can resolve them. Keep upstream PostgreSQL references and contributor links
external. JSR currently rewrites generated symbol paths into broken GitHub URLs;
[upstream PR #1532](https://github.com/jsr-io/jsr/pull/1532) addresses that
renderer bug. Do not replace symbol references with hardcoded JSR URLs to work
around it. Examples import `@carragom/deno-pg-ffi` (or its `/libpq` entry
point); Deno resolves this package's own name locally, so the same examples run
during checkout verification.

Published documentation belongs to its immutable JSR version. Source edits
appear on JSR only after publishing a new version.

## CI

[CI](.github/workflows/ci.yml) and [releases](.github/workflows/release.yml)
each use a matrix calling
[reusable-build-test.yml](.github/workflows/reusable-build-test.yml).
Platform-specific build tools and cluster setup stay in conditional Linux/macOS
jobs. The Linux container selects the distro/version; setup reads
`/etc/os-release`. All workflows use the local
[setup action](.github/actions/setup-deno/action.yml) to install Deno with the
official shell installer. The setup action uses Bash and requires curl and
unzip, without a Node runtime dependency, so it can also run under `gh act`.
Update `deno_version` in that action to change the workflow Deno version.

| Platform | CI build environment                    | Release build environment                  |
| -------- | --------------------------------------- | ------------------------------------------ |
| Linux    | Debian 13, x86_64/aarch64               | AlmaLinux 8 and 9, both architectures      |
| macOS    | `macos-15` ARM / `macos-15-intel` Intel | Same runners, macOS 15.0 deployment target |

Every test run includes type checking, documentation examples, and leak tracing:

| Run                      | Library                                    | Connection and TLS test                    |
| ------------------------ | ------------------------------------------ | ------------------------------------------ |
| Direct artifact          | Built `.so` / `.dylib`                     | TCP, `sslmode=require`, `LIBPQ_TEST_TLS=1` |
| Unix socket              | Built `.so` / `.dylib`                     | Unix socket, TLS test disabled             |
| System library (CI only) | Debian `libpq5` / Homebrew `postgresql@17` | TCP, `sslmode=disable`, TLS test disabled  |
| Download loading         | Built artifact served over local HTTP      | TCP, `sslmode=require`, `LIBPQ_TEST_TLS=1` |

CI enables `test_system_libpq`; releases leave it false. System libraries must
also be libpq 17+. Linux artifact TCP tests use the TLS-enabled
`postgres:17-trixie` service. System-library tests, benchmarks, and Unix-socket
tests use a fresh container-local cluster without TLS. Debian setup suppresses
automatic cluster creation before initializing that cluster. AlmaLinux uses
distribution PostgreSQL/OpenSSL packages without adding the PostgreSQL Yum
repository. Setup and cleanup manage only CI-created clusters.

macOS uses a fresh local PostgreSQL 17 cluster. Its artifacts statically link
OpenSSL 3 and undergo a system-only dylib dependency audit. Artifact/local
tasks, a focused benchmark, and download tests run with Homebrew OpenSSL
libraries hidden; the system-library run restores normal dependencies. Both
architectures target macOS 15.0. Formatting, linting, documentation lint, and
publish dry runs are local checks rather than explicit CI steps.

With the `gh act` extension installed, run Linux x86_64 CI locally:

```bash
gh act --workflows .github/workflows/ci.yml --matrix platform:linux --matrix arch:x86_64
```

For `act`, the Linux job changes the container's `/var/run` symlink to `../run`
to avoid Podman's archive-copy regression; it does not change the host. Deno
installation needs no Node, but JavaScript actions under `act` still do.
Artifact uploads are disabled by CI.

## Releases

Keep the `deno.json` version and GitHub `v<version>` tag aligned. Source
checkouts download from that GitHub release. JSR packages include the matching
release's binaries in `prebuilds/` and load them from the same package version.

Release notes live on the GitHub release page. The workflow uses
[GitHub-generated notes](https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes),
which summarize merged pull requests and link to the compared changes. Each run
regenerates the notes and includes the third-party license link. Rerunning an
existing tag replaces its notes and assets. GitHub's generator does not
interpret Conventional Commit types; commit-based generation remains a future
workflow improvement.

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):
`<type>(<optional scope>): <description>`. Use `feat` for features, `fix` for
bug fixes, and `docs`, `build`, `ci`, `refactor`, `perf`, `test`, or `chore` for
other changes. Describe the change, for example
`fix(pool): release connections after reset failures`. Mark breaking changes
with `!` after the type/scope or a `BREAKING CHANGE:` footer. Use the same
format for squash commit titles.

The release workflow runs on version tags or manual dispatch for a selected tag.
After building and testing, it publishes tagged releases with six binaries:
OpenSSL 1.1/3 Linux variants for both architectures, and the two macOS dylibs.
Tags containing a hyphen, including alpha versions, become GitHub prereleases.
One shared `THIRD_PARTY_LICENSES.txt` asset accompanies all six binaries;
release notes link to it. Linux assets link OpenSSL dynamically; macOS assets
contain OpenSSL and depend only on system dylibs. The build jobs verify that the
shared file contains the checked-out `postgres/COPYRIGHT` and, on macOS, the
installed OpenSSL's `LICENSE.txt`. Update the corresponding text in
[THIRD_PARTY_LICENSES.txt](THIRD_PARTY_LICENSES.txt) when either upstream
license changes. Run
`deno run --allow-read scripts/check-third-party-licenses.ts` to check the
PostgreSQL text locally; add `--openssl-license /path/to/LICENSE.txt` to check
the OpenSSL text too. Verify the complete asset set and automatic loader
download after publication.

GitHub releases and JSR publication are separate. `release.yml` builds and
publishes the binaries; `publish-jsr.yml` is manually triggered from GitHub's
Actions tab. The JSR package is linked to this repository and uses OIDC with
provenance, without a publishing secret. Deno uses the same setup action and
version pin as CI and binary releases. CI failure investigation remains separate
from this publishing flow.

First commit the publishing changes and ensure the selected release tag contains
them. Run **Publish JSR** with `tag` set to that tag and `publish` unchecked. It
checks tag/version agreement, formatting, lint, and API docs, downloads all six
release binaries, verifies their sizes and SHA-256 digests, and checks that the
release's licenses match the checkout. It stages exactly the files selected by
`publish.include` / `publish.exclude`, enforces JSR's 20 MiB file/package and
compressed-upload limits, and runs a publishing dry run. Tests, README,
developer documents, scripts, and build sources are excluded; the package
overview uses `src/mod.ts` JSDoc. Generated `prebuilds/` files are ignored by
Git and included explicitly for publishing.

The workflow summary records the selected commit, files, size, and release
checksums. An isolated prepared package runs a query against a disposable
PostgreSQL service; both entry points load their packaged libraries on Linux and
macOS, on both architectures. These are package smoke checks, not the full CI
suite. The prepared package remains a workflow artifact for seven days.

After reviewing validation, run the workflow again with `publish` checked. It
repeats validation, restores the verified binary artifact on the same source
commit, checks that the tag has not moved, rejects an existing JSR version, and
runs `deno publish` from GitHub Actions. Only that job receives
`id-token: write`. A final job imports both pinned JSR entry points with a fresh
cache and runs a query. If publishing reports an ambiguous failure, check JSR
version status before retrying. A post-publication verification failure does not
roll back the immutable version.

After publishing to JSR, preserve the release tag and GitHub binaries. Fixes
require a new package version and matching binary release. For local packaging
checks, use `deno publish --dry-run`; publishing itself belongs to the manual
GitHub workflow. To reproduce preparation locally, capture
`gh release view <tag> --json tagName,isDraft,assets` to a file and run
`deno run --allow-read --allow-write --allow-net scripts/prepare-jsr.ts
--release <json> --tag <tag> --output <empty directory outside the checkout>`.
