/** Lazy connection pool and checked-out clients. @module */
import { Client, type ClientOptions } from './client.ts'
import type { PreparedClient, Statement } from './statement.ts'
import type { Result, Results } from './result.ts'
import type { Param } from '../codecs/params.ts'
import { type Deserialize, TypeRegistry } from '../codecs/registry.ts'
import type { ConnectOptions } from '../conninfo.ts'

/**
 * A connection checked out from a pool. {@linkcode PoolClient.close} / `await using` releases the
 * inner {@linkcode Client} after `DISCARD ALL` and restoring
 * `DateStyle`, `extra_float_digits = 3`, and, when enabled, Temporal interval
 * formatting. It does not call `PQfinish` on a reusable connection.
 *
 * Use {@linkcode Pool.acquire} for session-scoped work. One command can be active
 * on a checkout at a time; calls after release reject. Dispose statements before
 * this checkout, and the checkout before the pool. Results survive release.
 *
 * @example Keep one connection for a prepared statement
 * ```ts
 * import { Pool } from '@carragom/deno-pg-ffi'
 *
 * await using pool = await Pool.create()
 * await using client = await pool.acquire()
 * await using statement = await client.prepare('SELECT $1::int4 AS n')
 * await using result = await statement.execute([7])
 * if (result.rows[0].n !== 7) throw new Error('expected 7')
 * console.log(result.rows[0].n) // 7
 * ```
 */
export class PoolClient implements PreparedClient {
	#inner: Client
	#release: (client: Client) => Promise<void>
	#closed = false

	/** @internal Wrap a checked-out connection with its pool release callback. */
	constructor(
		inner: Client,
		release: (client: Client) => Promise<void>,
	) {
		this.#inner = inner
		this.#release = release
	}

	/**
	 * Run one parameterized statement on this checkout. SQL failures throw
	 * PostgresError. The returned Result owns its data and must be disposed.
	 * @param sql SQL using `$1`, `$2`, … placeholders.
	 * @param params Text-protocol parameter values.
	 * @returns One owned result; its row shape is the TypeScript contract `T`.
	 */
	async query<T = Record<string, unknown>>(
		sql: string,
		params?: Param[],
	): Promise<Result<T>> {
		this.#assertOpen()
		return await this.#inner.query<T>(sql, params)
	}

	/**
	 * Run one or more statements without parameters on this checkout.
	 * @param sql SQL statements separated by semicolons.
	 * @returns A disposable batch of owned results. SQL errors throw PostgresError.
	 */
	async exec(sql: string): Promise<Results> {
		this.#assertOpen()
		return await this.#inner.exec(sql)
	}

	/**
	 * Prepare a statement bound to this checkout. Releasing the checkout makes
	 * the statement unusable. An empty name overwrites the unnamed statement.
	 * @param sql SQL using parameter placeholders.
	 * @param name Server-side name; defaults to the unnamed statement.
	 * @returns A Statement whose named disposal issues DEALLOCATE.
	 */
	async prepare(sql: string, name: string = ''): Promise<Statement> {
		this.#assertOpen()
		return await this.#inner.prepareFor(this, sql, name)
	}

	/**
	 * Wait for the active command, reset the session, and release this checkout.
	 * Open/failed transactions are rolled back before DISCARD ALL and restoring
	 * DateStyle, `extra_float_digits = 3`, and the enabled Temporal interval
	 * formatting. Reset failure finishes the connection. Repeated calls are safe.
	 * Session settings, temporary tables, and prepared statements do not survive
	 * release. Existing results remain readable and require separate disposal.
	 */
	async close(): Promise<void> {
		if (this.#closed) {
			return
		}
		this.#closed = true
		await this.#inner.waitIfBusy()
		await this.#release(this.#inner)
	}

	/** Dispose this resource by awaiting {@linkcode PoolClient.close}. */
	[Symbol.asyncDispose](): Promise<void> {
		return this.close()
	}

	/** @internal Execute a Statement through its checkout owner. */
	async executePrepared<T>(
		name: string,
		params?: Param[],
	): Promise<Result<T>> {
		this.#assertOpen()
		return await this.#inner.executePrepared<T>(name, params)
	}

	/** @internal Deallocate a named statement while the checkout is open. */
	deallocate(name: string): Promise<void> {
		if (this.#closed) {
			return Promise.resolve()
		}
		return this.#inner.deallocate(name)
	}

	#assertOpen(): void {
		if (this.#closed) {
			throw new Error('Client is closed')
		}
	}
}

/**
 * Options for {@linkcode Pool.create}.
 * Includes all result-conversion options
 * from {@linkcode ClientOptions}.
 * These settings apply to every connection created by the pool and are captured
 * when the pool is created; later changes to this object have no effect.
 */
export interface PoolOptions extends ClientOptions {
	/**
	 * Maximum number of live connections. Default `10`. Must be a positive
	 * finite integer.
	 */
	max?: number
}

interface PoolWaiter {
	resolve: () => void
	reject: (error: Error) => void
}

/**
 * A connection pool for concurrent queries. Create it through {@linkcode Pool.create}.
 *
 * Connections open lazily up to {@linkcode PoolOptions.max}. When saturated,
 * commands and acquisitions wait for a slot without an acquisition timeout.
 * `query` and `exec` acquire a connection for one command, then reset and release
 * it before resolving. Use {@linkcode Pool.acquire} for prepared statements or
 * transactions; separate pool commands cannot retain session state between calls.
 *
 * Each release resets session settings, temporary tables, and prepared
 * statements; a failed reset closes the connection. See {@linkcode PoolClient.close}.
 * Returned results remain valid after release or pool close and need their own
 * disposal. Type overrides are shared by reference with all checkouts.
 *
 * @example
 * ```ts
 * import { Pool } from '@carragom/deno-pg-ffi'
 *
 * await using pool = await Pool.create()
 * const read = async (n: number): Promise<number> => {
 * 	await using result = await pool.query<{ n: number }>(
 * 		'SELECT $1::int4 AS n', [n],
 * 	)
 * 	return result.rows[0].n
 * }
 * const [left, right] = await Promise.all([read(1), read(2)])
 * if (left !== 1 || right !== 2) {
 * 	throw new Error('expected pooled results')
 * }
 * console.log(left, right) // 1 2
 * ```
 */
export class Pool implements AsyncDisposable {
	#conninfo: string | URL | ConnectOptions | undefined
	#max: number
	#types: TypeRegistry
	#temporalInterval: boolean
	#idle: Client[] = []
	#waiters: PoolWaiter[] = []
	#total = 0
	#outstanding = 0
	#pendingCreates = 0
	#closed = false
	#closeStarted = false
	#closeDone: Promise<void> = Promise.resolve()
	#resolveClose: () => void = () => {}

	private constructor(
		conninfo: string | URL | ConnectOptions | undefined,
		max: number,
		options?: PoolOptions,
	) {
		this.#conninfo = conninfo
		this.#max = max
		this.#types = new TypeRegistry(options)
		this.#temporalInterval = options?.temporalInterval ?? false
	}

	/**
	 * Create a pool. Connections are opened lazily up to `max`.
	 * No socket opens until a command or acquisition needs one. Importing the
	 * package still loads libpq immediately. Connection precedence and handshake
	 * timeouts follow {@linkcode Client.connect} on each new connection.
	 *
	 * @param conninfo A
	 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING | connection string},
	 * a
	 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING-URIS | URL},
	 * or {@linkcode ConnectOptions}. Omit it to use `PGURL`, then libpq
	 * `PG*` variables and defaults.
	 * @param options Pool limits. `max` must be a positive
	 * finite integer and defaults to `10`. Result-conversion options
	 * from {@linkcode ClientOptions} apply to every checkout, including array
	 * leaves. Options are captured at creation, before any socket is opened.
	 * @returns Pool. Caller must {@linkcode Pool.close} it
	 * or use `await using`.
	 * @throws {Error} When `max` is not a positive finite integer
	 *
	 * @example
	 * ```ts
	 * import { Pool } from '@carragom/deno-pg-ffi'
	 *
	 * await using pool = await Pool.create(undefined, { max: 2 })
	 * await using r = await pool.query<{ n: number }>('SELECT 1::int4 AS n')
	 * if (r.rows[0].n !== 1) {
	 * 	throw new Error('expected 1')
	 * }
	 * console.log(r.rows[0].n) // 1
	 * ```
	 */
	static create(
		conninfo?: string | URL | ConnectOptions,
		options?: PoolOptions,
	): Promise<Pool> {
		const max = options?.max ?? 10
		if (!Number.isInteger(max) || max < 1) {
			return Promise.reject(
				new Error('Pool max must be a positive finite integer'),
			)
		}
		return Promise.resolve(new Pool(conninfo, max, options))
	}

	/**
	 * Register a scalar result converter for `oid` on every connection this pool
	 * opens, including checkouts already in progress.
	 * SQL NULL bypasses the converter. Changes affect rows when first materialized;
	 * cached rows keep their values. See {@linkcode Client.registerScalar} for
	 * scalar/array pairing and a custom result converter example. PoolClient has no
	 * registration methods; register on the pool before reading results.
	 *
	 * @param oid Type OID from `PQftype`
	 * @param deserialize Converts field text
	 * @throws {TypeError} When `oid` is already an array OID
	 */
	registerScalar(oid: number, deserialize: Deserialize): void {
		this.#types.registerScalar(oid, deserialize)
	}

	/**
	 * Register `arrayOid` as a Postgres array type on every connection this
	 * pool opens, including checkouts already in progress.
	 * Changes affect unread rows, not cached rows. See
	 * {@linkcode Client.registerArray} for nesting, NULL leaves, and an example.
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
	 */
	registerArray(
		arrayOid: number,
		elementOid?: number,
		delimiter?: string,
	): void {
		this.#types.registerArray(arrayOid, elementOid, delimiter)
	}

	/**
	 * Run one statement on a checked-out client, then release the client.
	 * Uses {@linkcode Client.query} parameter conversion and single-statement
	 * rules. Waits for a slot when saturated and for session reset after execution.
	 * The {@linkcode Result} stays valid after release and must be disposed.
	 *
	 * @param sql A single SQL statement
	 * @param params Bind values for `$1`, `$2`, …
	 * @returns One result. Dispose it with `await using`.
	 * @throws {PostgresError} When the statement fails
	 * @throws {Error} When the pool is closed
	 *
	 * @example
	 * ```ts
	 * import { Pool } from '@carragom/deno-pg-ffi'
	 *
	 * await using pool = await Pool.create()
	 * await using r = await pool.query<{ name: string }>(
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
		const client = await this.#acquire()
		try {
			return await client.query<T>(sql, params)
		} finally {
			await this.#release(client)
		}
	}

	/**
	 * Run one or more statements on a checked-out client, then release the
	 * client. Parameters are not supported. Uses {@linkcode Client.exec} rules,
	 * including rejection without a partial batch when a statement fails.
	 *
	 * @param sql One or more SQL statements
	 * @returns One {@linkcode Result} per statement.
	 * Dispose the batch with `await using`.
	 * @throws {PostgresError} When a statement fails
	 * @throws {Error} When the pool is closed
	 *
	 * @example
	 * ```ts
	 * import { Pool } from '@carragom/deno-pg-ffi'
	 *
	 * await using pool = await Pool.create()
	 * await using results = await pool.exec(
	 * 	'SELECT 1::int4 AS n; SELECT 2::int4 AS n',
	 * )
	 * if (results.at(0)?.rows[0].n !== 1) {
	 * 	throw new Error('expected 1')
	 * }
	 * console.log([...results].map((result) => [...result.rows]))
	 * ```
	 */
	async exec(sql: string): Promise<Results> {
		const client = await this.#acquire()
		try {
			return await client.exec(sql)
		} finally {
			await this.#release(client)
		}
	}

	/**
	 * Check out a {@linkcode PoolClient} for a transaction or `prepare`.
	 * `query` / `exec` stay the one-shot path. `close` / `await using` on that
	 * client releases it to the pool.
	 * Waits for a slot when saturated; no acquisition timeout is provided.
	 * Transactions use BEGIN/COMMIT/ROLLBACK on this same checkout. Open or failed
	 * transactions roll back on release. After a SQL error in a transaction, roll
	 * back before issuing more work. Dispose statements before the checkout and
	 * release the checkout before awaiting pool close.
	 *
	 * @returns A live checkout. Release it with
	 * {@linkcode PoolClient.close} or `await using`.
	 * @throws {Error} When the pool is closed
	 *
	 * @example
	 * ```ts
	 * import { Pool } from '@carragom/deno-pg-ffi'
	 *
	 * await using pool = await Pool.create()
	 * await using db = await pool.acquire()
	 * await using stmt = await db.prepare('SELECT $1::int4 AS n', 'get_n')
	 * await using r = await stmt.execute([3])
	 * if (r.rows[0].n !== 3) {
	 * 	throw new Error('expected 3')
	 * }
	 * console.log(r.rows[0].n) // 3
	 * ```
	 *
	 * @example Keep every transaction command on one checkout
	 * ```ts
	 * import { Pool } from '@carragom/deno-pg-ffi'
	 *
	 * await using pool = await Pool.create()
	 * await using db = await pool.acquire()
	 * await using begin = await db.query('BEGIN')
	 * try {
	 * 	await using result = await db.query('SELECT $1::int4 AS n', [1])
	 * 	if (result.rows[0].n !== 1) throw new Error('expected 1')
	 * 	await using commit = await db.query('COMMIT')
	 * 	console.log(result.rows[0].n) // 1, after committing the transaction.
	 * } catch (error) {
	 * 	await using rollback = await db.query('ROLLBACK')
	 * 	throw error
	 * }
	 * ```
	 */
	async acquire(): Promise<PoolClient> {
		const client = await this.#acquire()
		return new PoolClient(client, (inner) => this.#release(inner))
	}

	/**
	 * Close the pool. Rejects new `query` / `exec` / `acquire`, rejects
	 * queued waiters, and finishes idle connections. Waits for pending connects,
	 * outstanding checkouts, session resets, and required connection cleanup.
	 * Release every checkout before awaiting this call, or it cannot finish.
	 * Does not cancel commands; their existing results retain their data.
	 * Repeated calls await the same shutdown.
	 *
	 * @example
	 * ```ts
	 * import { Pool } from '@carragom/deno-pg-ffi'
	 *
	 * const pool = await Pool.create()
	 * await pool.close()
	 * ```
	 */
	async close(): Promise<void> {
		if (this.#closeStarted) {
			await this.#closeDone
			return
		}
		this.#closeStarted = true
		this.#closed = true
		this.#closeDone = new Promise((resolve) => {
			this.#resolveClose = resolve
		})

		const waiters = this.#waiters.splice(0)
		for (const waiter of waiters) {
			waiter.reject(new Error('Pool is closed'))
		}

		const idle = this.#idle.splice(0)
		await Promise.all(idle.map((client) => this.#finishClient(client)))

		this.#maybeSettleClose()
		await this.#closeDone
	}

	/** Dispose this resource by awaiting {@linkcode Pool.close}. */
	[Symbol.asyncDispose](): Promise<void> {
		return this.close()
	}

	async #acquire(): Promise<Client> {
		while (true) {
			if (this.#closed) {
				throw new Error('Pool is closed')
			}

			const idle = this.#idle.pop()
			if (idle !== undefined) {
				this.#outstanding++
				return idle
			}

			if (this.#total < this.#max) {
				return await this.#create()
			}

			await this.#waitForSlot()
		}
	}

	async #create(): Promise<Client> {
		// Reserve capacity before connecting yields, so concurrent acquires
		// cannot all observe and claim the same final slot.
		this.#pendingCreates++
		this.#total++
		let handedOut = false
		try {
			const client = await Client.connectWithRegistry(
				this.#conninfo,
				this.#types,
				this.#temporalInterval,
			)
			this.#outstanding++
			handedOut = true
			return client
		} catch (error) {
			if (!handedOut) {
				this.#total--
				this.#signalWaiter()
			}
			throw error
		} finally {
			this.#pendingCreates--
			this.#maybeSettleClose()
		}
	}

	async #release(client: Client): Promise<void> {
		try {
			if (this.#closed) {
				await this.#finishClient(client)
				return
			}

			const reset = await client.resetAfterCheckout()
			if (!reset || !client.isUsable()) {
				await this.#finishClient(client)
				this.#signalWaiter()
				return
			}

			// Shutdown may have started while the reset was in flight. Do not
			// put a successfully reset connection back into the idle pool then.
			if (this.#closed) {
				await this.#finishClient(client)
				return
			}

			this.#idle.push(client)
			this.#signalWaiter()
		} finally {
			// A checkout remains outstanding until reset and any required finish
			// have completed, so close() cannot settle ahead of cleanup.
			this.#outstanding--
			this.#maybeSettleClose()
		}
	}

	async #finishClient(client: Client): Promise<void> {
		await client.close()
		this.#total--
	}

	#waitForSlot(): Promise<void> {
		if (this.#closed) {
			return Promise.reject(new Error('Pool is closed'))
		}
		return new Promise((resolve, reject) => {
			this.#waiters.push({ resolve, reject })
		})
	}

	#signalWaiter(): void {
		const waiter = this.#waiters.shift()
		if (waiter !== undefined) {
			waiter.resolve()
		}
	}

	#maybeSettleClose(): void {
		if (
			this.#closeStarted &&
			this.#outstanding === 0 &&
			this.#pendingCreates === 0
		) {
			this.#resolveClose()
		}
	}
}
