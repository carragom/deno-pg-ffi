/**
 * Owned LISTEN/NOTIFY connection over libpq's nonblocking poll protocol.
 *
 * One `PGconn`. Independent of {@linkcode Client} / {@linkcode Pool}.
 * Callers use `await using` instead of `PQfinish`.
 *
 * @module
 */
import {
	clear,
	consumeInput,
	errorMessage,
	escapeIdentifier,
	finish,
	getCurrentTimeUSec,
	getvalue,
	nfields,
	notifies,
	ntuples,
	resultErrorMessage,
	resultStatus,
	sendQuery,
	socket,
	socketPoll,
	status,
} from '../native/wrappers.ts'
import {
	ConnStatusType,
	ExecStatusType,
	type Notify,
	type PGconn,
} from '../native/types.ts'
import type { ConnectOptions } from '../conninfo.ts'
import { isFatalStatus, pgErrorFromResult } from './error.ts'
import { connectPollLoop } from '../protocol/connect.ts'
import { afterSend } from '../protocol/command.ts'

export type { Notify }

/**
 * Callback invoked with a notification payload.
 * Synchronous exceptions are isolated from other listeners and the receive loop.
 * Returned promises are not awaited; asynchronous work must handle its own errors.
 *
 * @param notify Channel name, backend pid, and extra payload
 */
export type NotifyListener = (notify: Notify) => void

const USEC_PER_MS = 1000n
const DEFAULT_NOTIFY_INTERVAL_MS = 1000

const connRegistry = new FinalizationRegistry<PGconn>((conn) => {
	try {
		finish(conn)
	} catch {
		// Best-effort fallback. Explicit close unregisters this finalizer first;
		// catching JavaScript errors cannot recover from a native double finish.
	}
})

/**
 * Options for {@linkcode Notifier.connect}.
 */
export interface NotifierOptions {
	/**
	 * Idle `PQsocketPoll` timeout in milliseconds. Default 1000. Values that
	 * are omitted, non-finite, or not positive use the default. Positive
	 * fractional values are rounded up to the nearest microsecond.
	 * Incoming data wakes the poll immediately; this is not a delivery delay.
	 * Closing waits for any native poll already in progress.
	 */
	interval?: number
	/**
	 * Called when the receive loop fails. The notifier closes without reconnecting.
	 * Listen/unlisten failures reject their promises instead. Thrown handler errors
	 * are ignored; returned promises are not awaited.
	 */
	onError?: (error: Error) => void
}

interface PendingNotify {
	notify: Notify
	listeners: NotifyListener[]
}

/**
 * Owned LISTEN/NOTIFY connection.
 *
 * Uses one independent connection, with listen/unlisten and idle polling
 * serialized. Receive failure closes it without automatic reconnect; use
 * {@linkcode NotifierOptions.onError} to observe the failure.
 * {@linkcode Notifier.close} waits for native work before finishing the connection.
 * Send notifications through Client.query or PoolClient.query using `pg_notify`.
 */
export class Notifier implements AsyncDisposable {
	#conn: PGconn
	#token: object
	#interval: number
	#maxIdentifierLength: number
	#onError: ((error: Error) => void) | undefined
	#channels = new Map<string, Set<NotifyListener>>()
	#abort = new AbortController()
	#closed = false
	#finished = false
	#tail: Promise<void> = Promise.resolve()
	#closing: Promise<void> | undefined

	private constructor(
		conn: PGconn,
		token: object,
		interval: number,
		maxIdentifierLength: number,
		onError: ((error: Error) => void) | undefined,
	) {
		this.#conn = conn
		this.#token = token
		this.#interval = interval
		this.#maxIdentifierLength = maxIdentifierLength
		this.#onError = onError
	}

	/**
	 * Connect using the nonblocking poll protocol and start the receive loop.
	 * Connection forms, precedence, and handshake timeouts follow Client.connect.
	 *
	 * @param conninfo A
	 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING | connection string},
	 * a
	 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-CONNSTRING-URIS | URL},
	 * or {@linkcode ConnectOptions}. Omit it to use `PGURL`, then libpq
	 * `PG*` variables and defaults.
	 * @param options Idle wait and optional
	 * connection-error callback
	 * @returns Connected notifier. Caller must
	 * {@linkcode Notifier.close} it or use `await using`.
	 * @throws {Error} When the connection cannot be established or times out
	 *
	 * @example
	 * ```ts
	 * import { Client, Notifier } from '@carragom/deno-pg-ffi'
	 *
	 * await using db = await Client.connect()
	 * await using notifier = await Notifier.connect()
	 * const channel = `docs_connect_${crypto.randomUUID().replaceAll('-', '')}`
	 * const got = Promise.withResolvers<string>()
	 * await notifier.listen(channel, (n) => {
	 * 	got.resolve(n.extra)
	 * })
	 * await using sent = await db.query('SELECT pg_notify($1, $2)', [channel, 'hi'])
	 * if ((await got.promise) !== 'hi') {
	 * 	throw new Error('expected notify')
	 * }
	 * ```
	 */
	static async connect(
		conninfo?: string | URL | ConnectOptions,
		options: NotifierOptions = {},
	): Promise<Notifier> {
		const conn = await connectPollLoop(conninfo)
		let maxIdentifierLength: number
		try {
			maxIdentifierLength = await readMaxIdentifierLength(conn)
		} catch (error) {
			finish(conn)
			throw error
		}
		const token = {}
		const notifier = new Notifier(
			conn,
			token,
			resolveInterval(options.interval, DEFAULT_NOTIFY_INTERVAL_MS),
			maxIdentifierLength,
			(error) => {
				connRegistry.unregister(token)
				options.onError?.(error)
			},
		)
		connRegistry.register(notifier, conn, token)
		notifier.#start()
		return notifier
	}

	/**
	 * Subscribe a callback to a channel.
	 *
	 * Issues SQL `LISTEN` when this is the first callback for `channel`.
	 * Channel names must fit the connected server's `max_identifier_length`
	 * limit in UTF-8 bytes (normally 63), and are quoted as SQL identifiers.
	 * Registering the same callback twice on a channel is a no-op. Synchronous
	 * listener errors are isolated; see {@linkcode NotifyListener} for async work.
	 *
	 * @param channel Channel name
	 * @param cb Callback to invoke for each notification
	 * @throws {PostgresError} When LISTEN fails
	 * @throws {Error} When the connection is closed
	 * @throws {RangeError} When the UTF-8 channel name exceeds the server limit
	 *
	 * @example
	 * ```ts
	 * import { Notifier } from '@carragom/deno-pg-ffi'
	 *
	 * await using notifier = await Notifier.connect()
	 * const channel = `docs_listen_${crypto.randomUUID().replaceAll('-', '')}`
	 * await notifier.listen(channel, () => {})
	 * await notifier.unlisten(channel)
	 * ```
	 */
	async listen(channel: string, cb: NotifyListener): Promise<void> {
		const pending = await this.#runExclusive(async () => {
			this.#assertOpen()
			this.#validateChannel(channel)
			const existing = this.#channels.get(channel)
			if (existing !== undefined && existing.has(cb)) {
				return []
			}

			const isFirst = existing === undefined || existing.size === 0
			if (isFirst) {
				await notifyCommand(
					this.#conn,
					`LISTEN ${escapeIdentifier(this.#conn, channel)}`,
				)
			}

			let set = this.#channels.get(channel)
			if (set === undefined) {
				set = new Set()
				this.#channels.set(channel, set)
			}
			set.add(cb)

			return isFirst ? this.#takeNotifies() : []
		})
		this.#dispatch(pending)
	}

	/**
	 * Remove a callback, or every callback, from a channel.
	 *
	 * Issues SQL `UNLISTEN` when the last callback for `channel` is gone.
	 * Channel names must fit the connected server's `max_identifier_length`
	 * limit in UTF-8 bytes.
	 *
	 * @param channel Channel name
	 * @param cb Callback to remove. Omit to remove every callback on the channel
	 * @throws {PostgresError} When UNLISTEN fails
	 * @throws {Error} When the connection is closed
	 * @throws {RangeError} When the UTF-8 channel name exceeds the server limit
	 */
	async unlisten(channel: string, cb?: NotifyListener): Promise<void> {
		const pending = await this.#runExclusive(async () => {
			this.#assertOpen()
			this.#validateChannel(channel)
			const set = this.#channels.get(channel)
			if (set === undefined) {
				return []
			}

			if (cb === undefined) {
				set.clear()
			} else {
				set.delete(cb)
			}

			if (set.size > 0) {
				return []
			}

			this.#channels.delete(channel)
			await notifyCommand(
				this.#conn,
				`UNLISTEN ${escapeIdentifier(this.#conn, channel)}`,
			)
			return this.#takeNotifies()
		})
		this.#dispatch(pending)
	}

	/**
	 * Stop delivery and finish the inner connection.
	 *
	 * Waits for listen/unlisten and any native idle poll in progress. A poll cannot
	 * be interrupted mid-call; its timeout or incoming data allows shutdown to
	 * continue. Safe to call more than once.
	 */
	async close(): Promise<void> {
		if (this.#closing !== undefined) {
			await this.#closing
			return
		}

		this.#closing = this.#doClose()
		await this.#closing
	}

	/** Dispose this resource by awaiting {@linkcode Notifier.close}. */
	[Symbol.asyncDispose](): Promise<void> {
		return this.close()
	}

	#start(): void {
		void this.#receiveLoop()
	}

	async #doClose(): Promise<void> {
		this.#closed = true
		this.#abort.abort()
		connRegistry.unregister(this.#token)
		await this.#finishConn()
	}

	#assertOpen(): void {
		if (this.#closed) {
			throw new Error('Notifications connection is closed')
		}
	}

	#validateChannel(channel: string): void {
		const byteLength = new TextEncoder().encode(channel).byteLength
		if (byteLength > this.#maxIdentifierLength) {
			throw new RangeError(
				`Channel name is ${byteLength} UTF-8 bytes; the server limit is ${this.#maxIdentifierLength}`,
			)
		}
	}

	#runExclusive<T>(fn: () => Promise<T>): Promise<T> {
		const run = this.#tail.then(fn, fn)
		// A failed operation must not poison subsequent native work or cleanup.
		this.#tail = run.then(() => {}, () => {})
		return run
	}

	async #receiveLoop(): Promise<void> {
		try {
			while (!this.#closed) {
				const pending = await this.#runExclusive(async () => {
					if (this.#closed) {
						return []
					}

					try {
						await notifyWaitIdle(
							this.#conn,
							this.#interval,
							this.#abort.signal,
						)
					} catch (error) {
						if (this.#closed || isAbortError(error)) {
							return []
						}
						throw error
					}

					if (this.#closed) {
						return []
					}

					return this.#takeNotifies()
				})
				this.#dispatch(pending)
			}
		} catch (error) {
			if (!this.#closed) {
				const err = toError(error)
				try {
					this.#onError?.(err)
				} catch {
					// Handler errors must not hide the connection failure.
				}
				this.#closed = true
				this.#abort.abort()
			}
		} finally {
			await this.#finishConn()
		}
	}

	async #finishConn(): Promise<void> {
		await this.#runExclusive(async () => {
			if (this.#finished) {
				return
			}
			this.#finished = true
			this.#closed = true
			this.#channels.clear()
			connRegistry.unregister(this.#token)

			try {
				if (status(this.#conn) === ConnStatusType.CONNECTION_OK) {
					await notifyCommand(this.#conn, 'UNLISTEN *')
				}
			} catch {
				// Best-effort teardown.
			}

			finish(this.#conn)
		})
	}

	#takeNotifies(): PendingNotify[] {
		const pending: PendingNotify[] = []

		while (true) {
			const notify = notifies(this.#conn)
			if (notify === null) {
				return pending
			}

			const set = this.#channels.get(notify.relname)
			if (set === undefined || set.size === 0) {
				continue
			}

			// Snapshot subscriptions while native access is serialized, then let
			// callbacks run outside the queue so they can request listen/unlisten.
			pending.push({ notify, listeners: [...set] })
		}
	}

	#dispatch(pending: PendingNotify[]): void {
		for (const item of pending) {
			for (const cb of item.listeners) {
				try {
					cb(item.notify)
				} catch {
					// Isolate listener failures from the receive loop.
				}
			}
		}
	}
}

function resolveInterval(
	interval: number | undefined,
	fallback: number,
): number {
	if (interval === undefined || !Number.isFinite(interval) || interval <= 0) {
		return fallback
	}
	return interval
}

function isAbortError(error: unknown): boolean {
	return error instanceof DOMException && error.name === 'AbortError'
}

function toError(error: unknown): Error {
	if (error instanceof Error) {
		return error
	}
	return new Error(String(error))
}

async function notifyCommand(conn: PGconn, sql: string): Promise<void> {
	sendQuery(conn, sql)
	const results = await afterSend(conn)
	try {
		for (const res of results) {
			const commandStatus = resultStatus(res)
			if (isFatalStatus(commandStatus)) {
				throw pgErrorFromResult(res)
			}
			if (commandStatus !== ExecStatusType.PGRES_COMMAND_OK) {
				throw new Error(resultErrorMessage(res) || 'LISTEN/UNLISTEN failed')
			}
		}
	} finally {
		for (const res of results) {
			clear(res)
		}
	}
}

async function readMaxIdentifierLength(conn: PGconn): Promise<number> {
	sendQuery(conn, 'SHOW max_identifier_length')
	const results = await afterSend(conn)
	try {
		const result = results[0]
		if (
			result === undefined ||
			resultStatus(result) !== ExecStatusType.PGRES_TUPLES_OK ||
			ntuples(result) !== 1 || nfields(result) !== 1
		) {
			if (result !== undefined && isFatalStatus(resultStatus(result))) {
				throw pgErrorFromResult(result)
			}
			throw new Error('Could not read max_identifier_length from PostgreSQL')
		}
		const value = getvalue(result, 0, 0)
		const limit = typeof value === 'string' ? Number(value) : NaN
		if (!Number.isSafeInteger(limit) || limit <= 0) {
			throw new Error('PostgreSQL returned an invalid max_identifier_length')
		}
		return limit
	} finally {
		for (const result of results) clear(result)
	}
}

async function notifyWaitIdle(
	conn: PGconn,
	intervalMs: number,
	signal: AbortSignal,
): Promise<void> {
	if (signal.aborted) {
		throw new DOMException('The signal has been aborted', 'AbortError')
	}

	const sock = socket(conn)
	if (sock < 0) {
		throw new Error(errorMessage(conn))
	}

	const endTime = getCurrentTimeUSec() + intervalMicroseconds(intervalMs)
	const result = await socketPoll(sock, true, false, endTime)
	if (signal.aborted) {
		throw new DOMException('The signal has been aborted', 'AbortError')
	}
	if (result < 0) {
		throw new Error('Socket poll failed')
	}

	consumeInput(conn)
}

function intervalMicroseconds(intervalMs: number): bigint {
	const wholeMs = Math.trunc(intervalMs)
	const fractionalMs = intervalMs - wholeMs
	const fractionalUsec = Math.ceil(fractionalMs * Number(USEC_PER_MS))
	return BigInt(wholeMs) * USEC_PER_MS + BigInt(fractionalUsec)
}
