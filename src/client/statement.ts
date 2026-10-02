/** Prepared statements bound to their originating client. @module */
import type { Param } from '../codecs/params.ts'
import type { Result, Results } from './result.ts'

/** @internal The client operations a statement owner must provide. */
export interface PreparedClient extends AsyncDisposable {
	query<T = Record<string, unknown>>(
		sql: string,
		params?: Param[],
	): Promise<Result<T>>
	exec(sql: string): Promise<Results>
	prepare(sql: string, name?: string): Promise<Statement>
	close(): Promise<void>
	executePrepared<T>(
		name: string,
		params?: Param[],
	): Promise<Result<T>>
	deallocate(name: string): Promise<void>
}

/**
 * Server-side prepared statement from {@linkcode Client.prepare} /
 * {@linkcode PoolClient.prepare}.
 *
 * Bound to the originating client or pool checkout; it cannot move to another
 * connection or execute after that owner closes. Dispose statements before their
 * owner. Named disposal issues DEALLOCATE; unnamed disposal closes only this
 * handle. Another unnamed prepare replaces the connection's unnamed statement,
 * so an older handle no longer identifies its original SQL.
 *
 * @example
 * ```ts
 * import { Client } from '../mod.ts'
 *
 * await using db = await Client.connect()
 * await using stmt = await db.prepare('SELECT $1::int4 AS n')
 * await using r = await stmt.execute([7])
 * if (r.rows[0].n !== 7) {
 * 	throw new Error('expected 7')
 * }
 * ```
 */
export class Statement implements AsyncDisposable {
	/** Server-side statement name; empty means the unnamed statement. */
	readonly name: string
	/** SQL text supplied to prepare. */
	readonly sql: string
	#client: PreparedClient
	#closed = false

	/** @internal Bind a prepared statement to its originating client or checkout. */
	constructor(client: PreparedClient, sql: string, name: string) {
		this.#client = client
		this.sql = sql
		this.name = name
	}

	/**
	 * Run the prepared statement.
	 * Uses the same parameter conversion and result ownership as Client.query.
	 * `T` declares the row shape without runtime validation. Holding a result
	 * does not prevent another command after this execution finishes.
	 *
	 * @param params Bind values for `$1`, `$2`, …
	 * @returns One result. Dispose it with `await using`.
	 * @throws {PostgresError} When execution fails
	 * @throws {Error} When this statement or its owner is closed, the owner is
	 * busy, or transport fails
	 * @throws {TypeError} When parameter conversion fails
	 */
	execute<T = Record<string, unknown>>(
		params?: Param[],
	): Promise<Result<T>> {
		if (this.#closed) {
			return Promise.reject(new Error('Prepared statement is closed'))
		}
		return this.#client.executePrepared<T>(this.name, params)
	}

	/**
	 * Close this handle; repeated calls are safe. A live owner's named statement
	 * is dropped with DEALLOCATE. Unnamed statements are left on the server and
	 * only this handle is closed. Dispose before closing/releasing the owner.
	 */
	async close(): Promise<void> {
		if (this.#closed) {
			return
		}
		this.#closed = true
		if (this.name !== '') {
			await this.#client.deallocate(this.name)
		}
	}

	/** Dispose this resource by awaiting {@linkcode close}. */
	[Symbol.asyncDispose](): Promise<void> {
		return this.close()
	}
}
