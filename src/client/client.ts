/**
 * High-level PostgreSQL client over libpq's nonblocking poll protocol.
 *
 * Connections and results own their native handles independently. Callers use
 * `await using` instead of PQfinish/PQclear; finalizers are a fallback.
 *
 * @module
 */
import {
	escapeIdentifier,
	finish,
	sendPrepare,
	sendQuery,
	sendQueryParams,
	sendQueryPrepared,
	setnonblocking,
	status,
	transactionStatus,
} from '../native/wrappers.ts'
import {
	ConnStatusType,
	type PGconn,
	PGTransactionStatusType,
} from '../native/types.ts'
import { connectPollLoop } from '../protocol/connect.ts'
import { afterSend, clearAll } from '../protocol/command.ts'
import { type Param, serializeParams } from '../codecs/params.ts'
import { type Deserialize, TypeRegistry } from '../codecs/registry.ts'
import type { ConnectOptions } from '../conninfo.ts'
import { throwIfFatal } from './error.ts'
import { Result, Results } from './result.ts'
import { type PreparedClient, Statement } from './statement.ts'

const DATE_STYLE_SQL = "SET DateStyle = 'ISO, YMD'"
const FLOAT_DIGITS_SQL = 'SET extra_float_digits = 3'
const INTERVAL_STYLE_SQL = 'SET IntervalStyle = iso_8601'

/**
 * Built-in result converter settings for {@linkcode Client.connect} and
 * {@linkcode Pool.create}.
 *
 * These options affect values received from PostgreSQL, not accepted parameters.
 * SQL NULL remains JavaScript `null`. With `parseArrays` enabled, scalar options
 * also apply to non-NULL array elements; with it disabled, built-in arrays remain
 * whole PostgreSQL text strings regardless of scalar options.
 *
 * Managed connections always set DateStyle to `ISO, YMD` and
 * extra_float_digits to `3`, even when result conversion is disabled. Only
 * IntervalStyle depends on an option: `temporalInterval` enables `iso_8601`.
 * See {@linkcode Client.connect} for session setup and
 * {@linkcode PoolClient.close} for pool reset behavior.
 *
 * Options are captured when the client or pool is created. Conversion happens
 * when a row is first read: a query can succeed but reading its result can throw.
 * Temporal conversion failures throw RangeError without normalization or a
 * fallback to strings. The current date/timestamp parsers reject PostgreSQL's
 * BC and extended-year notation even when Temporal could represent the value.
 * Disable the corresponding converter or cast the column to `text` to read it.
 *
 * Custom scalar result converters override these defaults. Configure custom
 * array conversion through {@linkcode Client.registerArray} or
 * {@linkcode Pool.registerArray}. A custom time/interval scalar converter needs
 * an explicit array pairing when its Temporal option is disabled.
 */
export interface ClientOptions {
	/**
	 * Convert `json` and `jsonb` results with `JSON.parse`. Default `true`.
	 * Set `false` to return PostgreSQL JSON text as a string.
	 * Applies to JSON/JSONB array elements when `parseArrays` is enabled.
	 *
	 * When enabled, large integers and precise decimals can lose precision,
	 * sufficiently large numbers become JavaScript infinities, and JSON null
	 * and SQL NULL both become JavaScript `null`. Returning text preserves
	 * number precision and keeps JSON null (`'null'`) distinct from SQL NULL.
	 * JSONB text reflects PostgreSQL's normalization, not the original input's
	 * whitespace, key order, or duplicate keys.
	 */
	parseJson?: boolean
	/**
	 * Convert built-in PostgreSQL arrays to nested JavaScript arrays. Default `true`.
	 * Set `false` to return each entire array as a PostgreSQL text string,
	 * without parsing its structure or converting its elements.
	 * Scalar options still apply to non-array columns.
	 *
	 * When enabled, nesting and SQL NULL elements are preserved, but original
	 * index bounds are discarded: `[5:6]={1,2}` becomes `[1, 2]`. Each non-NULL
	 * element uses the result converter configured for its element type; an
	 * element conversion failure prevents that row from being read.
	 * Returning text preserves index bounds, delimiters, and NULL tokens.
	 *
	 * Unregistered custom array types remain strings. An explicit
	 * {@linkcode Client.registerArray} or {@linkcode Pool.registerArray}
	 * enables parsing for that array type even when this option is `false`.
	 */
	parseArrays?: boolean
	/**
	 * Convert `date` results to `Temporal.PlainDate`. Default `true`.
	 * Set `false` to return PostgreSQL date text as a string.
	 * Applies to `date[]` elements when `parseArrays` is enabled.
	 *
	 * When enabled, reading a row throws RangeError for `infinity`,
	 * `-infinity`, BC dates, years above 9999, or dates outside Temporal's range.
	 * These values remain readable as strings when conversion is disabled.
	 */
	temporalDate?: boolean
	/**
	 * Convert `timestamp` results to `Temporal.PlainDateTime`. Default `true`.
	 * Set `false` to return PostgreSQL timestamp text as a string.
	 * Applies to `timestamp[]` elements when `parseArrays` is enabled.
	 *
	 * When enabled, reading a row throws RangeError for `infinity`,
	 * `-infinity`, BC timestamps, years above 9999, or timestamps outside
	 * Temporal's range. These values remain readable as strings when
	 * conversion is disabled.
	 */
	temporalTimestamp?: boolean
	/**
	 * Convert `timestamptz` results to `Temporal.Instant`. Default `true`.
	 * Set `false` to return PostgreSQL timestamp text as a string, including
	 * the session's UTC offset. Applies to `timestamptz[]` elements when
	 * `parseArrays` is enabled.
	 *
	 * When enabled, reading a row throws RangeError for `infinity`,
	 * `-infinity`, BC timestamps, years above 9999, or timestamps outside
	 * Temporal's range. These values remain readable as strings when
	 * conversion is disabled.
	 */
	temporalTimestamptz?: boolean
	/**
	 * Convert `time` results to `Temporal.PlainTime`. Default `false` returns
	 * PostgreSQL time text as a string. Set `true` to enable conversion.
	 * Applies to `time[]` elements when `parseArrays` is enabled.
	 *
	 * When enabled, PostgreSQL's valid end-of-day value `24:00:00` throws
	 * RangeError when its row is read: Temporal.PlainTime cannot represent it.
	 * It is not normalized to `00:00:00`. With conversion disabled, the value
	 * remains the string `'24:00:00'`.
	 * PostgreSQL can also round a valid near-midnight Temporal.PlainTime
	 * parameter to `24:00:00`, causing the same failure when it is returned.
	 * See {@linkcode Param} for parameter precision.
	 *
	 * Does not affect `timetz`, which remains a string.
	 */
	temporalTime?: boolean
	/**
	 * Convert `interval` results to `Temporal.Duration`. Default `false` returns
	 * PostgreSQL interval text as a string. Set `true` to enable conversion.
	 * Applies to `interval[]` elements when `parseArrays` is enabled.
	 *
	 * When enabled, reading a row throws RangeError for mixed-sign components
	 * such as `1 month -1 day`, `infinity`, `-infinity`, values outside
	 * Temporal.Duration's range, or text the converter cannot parse. Components
	 * are not normalized to make them representable; calendar months, days,
	 * and elapsed time remain separate. With conversion disabled, these
	 * values remain readable as PostgreSQL text.
	 *
	 * Enabling this option sets the session's IntervalStyle to `iso_8601`,
	 * including after pool reset. Changing IntervalStyle through SQL can break
	 * conversion. This setting also changes interval-to-text cast output.
	 * With this option disabled, the client does not set IntervalStyle.
	 */
	temporalInterval?: boolean
}

const connRegistry = new FinalizationRegistry<PGconn>((conn) => {
	try {
		finish(conn)
	} catch {
		// Best-effort fallback. Explicit close unregisters this finalizer first;
		// a native double finish cannot be recovered by catching JavaScript errors.
	}
})

/**
 * A PostgreSQL connection for queries and prepared statements. Open it through {@linkcode Client.connect}.
 * {@linkcode Client.close} finishes the connection once and waits for any
 * command in progress; it does not cancel that command.
 *
 * One command can be active at a time. Overlapping query, exec, prepare, or
 * statement execution rejects rather than queues. Use a {@linkcode Pool} or
 * separate clients for concurrency. A command stops being active once sending
 * and native result collection finish; holding a {@linkcode Result} does not
 * keep the connection busy. Result data survives connection close.
 *
 * @example
 * ```ts
 * import { Client } from '@carragom/deno-pg-ffi'
 *
 * await using db = await Client.connect()
 * await using r = await db.query<{ n: number }>('SELECT $1::int4 AS n', [1])
 * if (r.rows.at(0)?.n !== 1) {
 * 	throw new Error('expected 1')
 * }
 * console.log(r.rows[0].n) // 1
 * ```
 */
export class Client implements PreparedClient {
	#conn: PGconn | null
	#types: TypeRegistry
	#temporalInterval: boolean
	#busy = false
	#closed = false
	#idle: Promise<void> = Promise.resolve()
	#settleIdle: () => void = () => {}
	#token: object = {}

	private constructor(
		conn: PGconn,
		types: TypeRegistry,
		temporalInterval: boolean,
	) {
		this.#conn = conn
		this.#types = types
		this.#temporalInterval = temporalInterval
		connRegistry.register(this, conn, this.#token)
	}

	/**
	 * Connect using the nonblocking poll protocol.
	 *
	 * Accepts a libpq
	 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING | connection string},
	 * a `URL` object, or {@linkcode ConnectOptions} with string values.
	 * An explicit argument bypasses `PGURL`; unspecified fields still use libpq
	 * defaults. Nonempty URL query parameters
	 * override matching URL fields, including a socket path such as
	 * `postgresql:///mydb?host=/var/run/postgresql&user=myuser`.
	 *
	 * The effective `connect_timeout` / `PGCONNECT_TIMEOUT` bounds the whole poll
	 * handshake in seconds; an explicit option takes precedence. Zero or omission
	 * means no deadline. Commands have no client-side timeout or AbortSignal
	 * option; use PostgreSQL's `statement_timeout` to limit SQL execution.
	 *
	 * Sets DateStyle to `ISO, YMD` and extra_float_digits to `3` after connecting,
	 * overriding connection defaults to preserve temporal formats and float
	 * precision across PostgreSQL versions. Enabling temporalInterval also sets
	 * IntervalStyle to `iso_8601`. Changing these settings through SQL can break
	 * conversion or lose floating-point precision. Options are captured at
	 * invocation.
	 *
	 * @param conninfo A libpq
	 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING | connection string},
	 * a `URL` object, or {@linkcode ConnectOptions} with string values.
	 * Omit it or pass `undefined` to use `PGURL`, then libpq `PG*` variables
	 * and defaults.
	 * @param options Built-in result converter settings.
	 * @returns Connected client. Caller must
	 * {@linkcode Client.close} it or use `await using`.
	 * @throws {Error} When the connection cannot be established or times out
	 *
	 * @example Opt in to strict time and interval decoding
	 * ```ts
	 * import { Client } from '@carragom/deno-pg-ffi'
	 *
	 * await using db = await Client.connect(undefined, {
	 * 	temporalTime: true,
	 * 	temporalInterval: true,
	 * })
	 * await using result = await db.query<{
	 * 	t: Temporal.PlainTime
	 * 	i: Temporal.Duration
	 * }>('SELECT $1::time AS t, $2::interval AS i', [
	 * 	Temporal.PlainTime.from('12:34:56.123456'),
	 * 	Temporal.Duration.from('-P1DT2H'),
	 * ])
	 * if (result.rows[0].t.hour !== 12 || result.rows[0].i.days !== -1) {
	 * 	throw new Error('expected Temporal values')
	 * }
	 * // Unsupported values throw when a row is read. A text cast bypasses the converter.
	 * await using text = await db.query<{ closing: string }>(
	 * 	"SELECT time '24:00:00'::text AS closing",
	 * )
	 * if (text.rows[0].closing !== '24:00:00') {
	 * 	throw new Error('expected original text')
	 * }
	 * console.log(result.rows[0].t.toString(), result.rows[0].i.toString())
	 * console.log(text.rows[0].closing) // 24:00:00
	 * ```
	 */
	static connect(
		conninfo?: string | URL | ConnectOptions,
		options?: ClientOptions,
	): Promise<Client> {
		return Client.connectWithRegistry(
			conninfo,
			new TypeRegistry(options),
			options?.temporalInterval ?? false,
		)
	}

	/** @internal Connect with the pool's shared OID registry. */
	static async connectWithRegistry(
		conninfo: string | URL | ConnectOptions | undefined,
		types: TypeRegistry,
		temporalInterval = false,
	): Promise<Client> {
		const conn = await connectPollLoop(conninfo)
		const client = new Client(conn, types, temporalInterval)
		try {
			await client.#setSessionSettings()
			return client
		} catch (error) {
			await client.close()
			throw error
		}
	}

	/**
	 * Register a scalar result converter for `oid`.
	 *
	 * Applies to columns with that OID and to array leaves when an array OID
	 * points at this scalar. Does not change built-in converters. A second call for
	 * the same OID replaces the override.
	 *
	 * Result converters run when a row is first materialized: unread rows use the
	 * latest converter, while cached rows keep their values. SQL NULL bypasses
	 * the converter. Register before reading results for consistent values.
	 * Arrays without a built-in scalar converter for their elements, such as
	 * `uuid[]`, require an explicit {@linkcode Client.registerArray} pairing before a
	 * scalar override applies to leaves.
	 *
	 * @param oid Type OID from `PQftype`
	 * @param deserialize Converts field text
	 * @throws {TypeError} When `oid` is already an array OID
	 *
	 * @example
	 * ```ts
	 * import { Client } from '@carragom/deno-pg-ffi'
	 *
	 * await using db = await Client.connect()
	 * db.registerScalar(2950, (text) => text.toUpperCase())
	 * await using r = await db.query<{ id: string }>(
	 * 	`SELECT 'a4a70900-a4a7-4a4a-a4a7-a4a70900a4a7'::uuid AS id`,
	 * )
	 * if (r.rows[0].id !== 'A4A70900-A4A7-4A4A-A4A7-A4A70900A4A7') {
	 * 	throw new Error('expected uppercased uuid')
	 * }
	 * console.log(r.rows[0].id)
	 * ```
	 */
	registerScalar(oid: number, deserialize: Deserialize): void {
		this.#types.registerScalar(oid, deserialize)
	}

	/**
	 * Register `arrayOid` as a Postgres array type.
	 *
	 * When `elementOid` is omitted, each leaf stays the element text. When
	 * given, every leaf uses that scalar result converter. A second call for the
	 * same array OID replaces the override.
	 * Preserves nesting and SQL NULL leaves, but discards PostgreSQL lower bounds.
	 * Like {@linkcode Client.registerScalar}, changes affect unread rows, not cached rows.
	 *
	 * @param arrayOid Array type OID from `PQftype`
	 * @param elementOid Scalar element OID that already has a
	 * result converter
	 * @param delimiter Element delimiter. Defaults to the built-in
	 * delimiter (semicolon for `box[]`), or comma for custom array OIDs.
	 * Must be one non-whitespace ASCII character other than braces, quotes,
	 * or backslash. A custom array can use `registerArray(oid, undefined, ';')`.
	 * @throws {TypeError} When `arrayOid` is already a scalar OID,
	 * `elementOid` has no result converter, or `delimiter` is invalid
	 *
	 * @example
	 * ```ts
	 * import { Client } from '@carragom/deno-pg-ffi'
	 *
	 * await using db = await Client.connect()
	 * db.registerScalar(2950, (text) => text.toUpperCase())
	 * db.registerArray(2951, 2950)
	 * await using r = await db.query<{ ids: string[] }>(
	 * 	`SELECT '{a4a70900-a4a7-4a4a-a4a7-a4a70900a4a7}'::uuid[] AS ids`,
	 * )
	 * if (r.rows[0].ids[0] !== 'A4A70900-A4A7-4A4A-A4A7-A4A70900A4A7') {
	 * 	throw new Error('expected uppercased uuid element')
	 * }
	 * console.log(r.rows[0].ids)
	 * ```
	 */
	registerArray(
		arrayOid: number,
		elementOid?: number,
		delimiter?: string,
	): void {
		this.#types.registerArray(arrayOid, elementOid, delimiter)
	}

	/**
	 * Run one statement. Uses the extended protocol (`PQsendQueryParams`).
	 * The full native result is collected before resolving; rows decode lazily.
	 * `T` declares the expected row shape without validating it at runtime.
	 *
	 * @param sql A single SQL statement
	 * @param params Bind values for `$1`, `$2`, …
	 * @returns One result. Dispose it with `await using`.
	 * @throws {PostgresError} When the statement fails
	 * @throws {Error} When the client is closed, busy, or the SQL has more than
	 * one statement
	 * @throws {TypeError} When a parameter is unsupported, non-finite, or contains
	 * embedded NUL after conversion
	 *
	 * @example
	 * ```ts
	 * import { Client } from '@carragom/deno-pg-ffi'
	 *
	 * await using db = await Client.connect()
	 * await using r = await db.query<{ name: string }>(
	 * 	'SELECT $1::text AS name',
	 * 	['Ada'],
	 * )
	 * if (r.rows[0].name !== 'Ada') {
	 * 	throw new Error('expected Ada')
	 * }
	 * console.log(r.rows[0].name) // Ada
	 * ```
	 */
	async query<T = Record<string, unknown>>(
		sql: string,
		params?: Param[],
	): Promise<Result<T>> {
		const conn = this.#begin()
		try {
			sendQueryParams(conn, sql, serializeParams(params))
			const raw = await afterSend(conn)
			try {
				throwIfFatal(raw)
				if (raw.length !== 1) {
					throw new Error('query() expects exactly one statement result')
				}
				return new Result<T>(raw[0]!, this.#types)
			} catch (error) {
				clearAll(raw)
				throw error
			}
		} finally {
			this.#end()
		}
	}

	/**
	 * Run one or more statements. Uses the simple protocol (`PQsendQuery`).
	 * Parameters are not supported. If any statement fails, the call rejects and
	 * clears every collected result; no partial batch is returned.
	 *
	 * @param sql One or more SQL statements
	 * @returns One {@linkcode Result} per statement.
	 * Dispose the batch with `await using`.
	 * @throws {PostgresError} When a statement fails
	 * @throws {Error} When the client is closed, busy, or transport fails
	 *
	 * @example
	 * ```ts
	 * import { Client } from '@carragom/deno-pg-ffi'
	 *
	 * await using db = await Client.connect()
	 * await using results = await db.exec(
	 * 	'SELECT 1::int4 AS n; SELECT 2::int4 AS n',
	 * )
	 * if (results.at(0)?.rows[0].n !== 1) {
	 * 	throw new Error('expected 1')
	 * }
	 * console.log([...results].map((result) => [...result.rows]))
	 * ```
	 */
	async exec(sql: string): Promise<Results> {
		const conn = this.#begin()
		try {
			sendQuery(conn, sql)
			const raw = await afterSend(conn)
			try {
				throwIfFatal(raw)
				return new Results(raw.map((res) => new Result(res, this.#types)))
			} catch (error) {
				clearAll(raw)
				throw error
			}
		} finally {
			this.#end()
		}
	}

	/**
	 * Prepare a statement. `name` is optional; omit it for the unnamed statement
	 * (one per connection; the next unnamed prepare replaces it).
	 * The returned {@linkcode Statement} stays bound to this client. Dispose it
	 * before the client; a named statement's disposal issues DEALLOCATE.
	 *
	 * @param sql A single SQL statement
	 * @param name Prepared statement name
	 * @returns Handle with
	 * {@linkcode Statement.execute}
	 * @throws {PostgresError} When preparation fails
	 * @throws {Error} When the client is closed, busy, or transport fails
	 *
	 * @example
	 * ```ts
	 * import { Client } from '@carragom/deno-pg-ffi'
	 *
	 * await using db = await Client.connect()
	 * await using stmt = await db.prepare(
	 * 	'SELECT $1::int4 AS n',
	 * 	'docs_select_n',
	 * )
	 * await using r = await stmt.execute([3])
	 * if (r.rows[0].n !== 3) {
	 * 	throw new Error('expected 3')
	 * }
	 * console.log(r.rows[0].n) // 3
	 * ```
	 */
	async prepare(sql: string, name: string = ''): Promise<Statement> {
		return await this.prepareFor(this, sql, name)
	}

	/** @internal */
	async prepareFor(
		owner: PreparedClient,
		sql: string,
		name: string,
	): Promise<Statement> {
		const conn = this.#begin()
		try {
			sendPrepare(conn, sql, name)
			const raw = await afterSend(conn)
			try {
				throwIfFatal(raw)
			} catch (error) {
				clearAll(raw)
				throw error
			}
			clearAll(raw)
			return new Statement(owner, sql, name)
		} finally {
			this.#end()
		}
	}

	/**
	 * Finish the connection. Safe to call more than once. If a command is in
	 * flight, waits for it to finish before calling `PQfinish`.
	 * New commands reject as soon as close starts. Existing results remain valid
	 * and must be disposed separately.
	 *
	 * @example
	 * ```ts
	 * import { Client } from '@carragom/deno-pg-ffi'
	 *
	 * const db = await Client.connect()
	 * await db.close()
	 * ```
	 */
	async close(): Promise<void> {
		// Reject new work before yielding, so nothing can race the idle wait.
		this.#closed = true
		if (this.#busy) {
			await this.#idle
		}
		if (this.#conn === null) {
			return
		}
		const conn = this.#conn
		this.#conn = null
		this.#busy = false
		connRegistry.unregister(this.#token)
		finish(conn)
	}

	/** Dispose this resource by awaiting {@linkcode Client.close}. */
	[Symbol.asyncDispose](): Promise<void> {
		return this.close()
	}

	/** @internal */
	executePrepared<T>(
		name: string,
		params?: Param[],
	): Promise<Result<T>> {
		return this.#executePrepared(name, params)
	}

	/** @internal */
	deallocate(name: string): Promise<void> {
		if (this.#closed || this.#conn === null) {
			return Promise.resolve()
		}
		const ident = escapeIdentifier(this.#conn, name)
		return this.#command(`DEALLOCATE ${ident}`)
	}

	/** @internal */
	isUsable(): boolean {
		return this.#conn !== null &&
			!this.#closed &&
			status(this.#conn) === ConnStatusType.CONNECTION_OK
	}

	/** @internal */
	waitIfBusy(): Promise<void> {
		if (!this.#busy) {
			return Promise.resolve()
		}
		return this.#idle
	}

	/** @internal */
	async resetAfterCheckout(): Promise<boolean> {
		if (!this.isUsable() || this.#conn === null) {
			return false
		}

		const txn = transactionStatus(this.#conn)
		if (
			txn === PGTransactionStatusType.PQTRANS_ACTIVE ||
			txn === PGTransactionStatusType.PQTRANS_UNKNOWN
		) {
			return false
		}

		const commands = txn === PGTransactionStatusType.PQTRANS_INTRANS ||
				txn === PGTransactionStatusType.PQTRANS_INERROR
			? ['ROLLBACK', 'DISCARD ALL', DATE_STYLE_SQL, FLOAT_DIGITS_SQL]
			: ['DISCARD ALL', DATE_STYLE_SQL, FLOAT_DIGITS_SQL]
		if (this.#temporalInterval) {
			commands.push(INTERVAL_STYLE_SQL)
		}

		try {
			// DISCARD ALL must be sent alone: a multi-statement query puts it
			// inside an implicit transaction block, where PostgreSQL rejects it.
			for (const sql of commands) {
				await using results = await this.exec(sql)
				if (results.length < 1) {
					return false
				}
			}
			return true
		} catch {
			return false
		}
	}

	async #executePrepared<T>(
		name: string,
		params?: Param[],
	): Promise<Result<T>> {
		const conn = this.#begin()
		try {
			sendQueryPrepared(conn, serializeParams(params), name)
			const raw = await afterSend(conn)
			try {
				throwIfFatal(raw)
				if (raw.length !== 1) {
					throw new Error('execute() expects exactly one statement result')
				}
				return new Result<T>(raw[0]!, this.#types)
			} catch (error) {
				clearAll(raw)
				throw error
			}
		} finally {
			this.#end()
		}
	}

	async #command(sql: string): Promise<void> {
		const conn = this.#begin()
		try {
			sendQuery(conn, sql)
			const raw = await afterSend(conn)
			try {
				throwIfFatal(raw)
			} finally {
				clearAll(raw)
			}
		} finally {
			this.#end()
		}
	}

	async #setSessionSettings(): Promise<void> {
		await this.#command(DATE_STYLE_SQL)
		await this.#command(FLOAT_DIGITS_SQL)
		if (this.#temporalInterval) {
			await this.#command(INTERVAL_STYLE_SQL)
		}
	}

	#begin(): PGconn {
		if (this.#closed) {
			throw new Error('Client is closed')
		}
		const conn = this.#requireConn()
		if (this.#busy) {
			throw new Error(
				'Another command is already in progress on this client',
			)
		}
		this.#busy = true
		this.#idle = new Promise((resolve) => {
			this.#settleIdle = resolve
		})
		setnonblocking(conn, true)
		return conn
	}

	#end(): void {
		// Transport is finished; Result owns the collected data independently.
		this.#busy = false
		this.#settleIdle()
	}

	#requireConn(): PGconn {
		if (this.#closed || this.#conn === null) {
			throw new Error('Client is closed')
		}
		return this.#conn
	}
}
