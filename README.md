# Deno PG FFI

Deno native bindings for PostgreSQL libpq.

A safe, fast PostgreSQL client built on libpq, with parameterized queries,
pooling, prepared statements, notifications, and automatic resource disposal.
The `/libpq` entry point exposes raw C functions for direct access to libpq.

Requires **Deno 2.9+** and **libpq 17+**. The package is in alpha. Packaged
binaries support Linux and macOS on x86_64 and aarch64; a compatible local
library can also be supplied.

Read the [JSR documentation](https://jsr.io/@carragom/deno-pg-ffi) for
installation, examples, connection settings, value converters, and API
contracts. Browse
[all public symbols](https://jsr.io/@carragom/deno-pg-ffi/doc/all_symbols) or
the [raw libpq API](https://jsr.io/@carragom/deno-pg-ffi/doc/libpq/).

For building, testing, benchmarks, and contributing, see [DEVEL.md](DEVEL.md).
The project uses the [MIT license](LICENSE); bundled native libraries are
covered by [third-party licenses](THIRD_PARTY_LICENSES.txt).
