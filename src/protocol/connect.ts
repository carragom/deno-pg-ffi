/** Shared nonblocking connection handshake. @module */
import {
	connectPoll,
	connectStart,
	conninfo as connectionInfo,
	errorMessage,
	finish,
	getCurrentTimeUSec,
	setnonblocking,
	status,
} from '../native/wrappers.ts'
import {
	ConnStatusType,
	type PGconn,
	PostgresPollingStatusType,
} from '../native/types.ts'
import { type ConnectOptions, resolveConninfo } from '../conninfo.ts'
import { INFINITE_END_TIME, waitSocket } from './socket.ts'

const USEC_PER_SEC = 1_000_000n

function connectTimeoutEndTime(timeout: string | undefined): bigint {
	if (timeout === undefined) return INFINITE_END_TIME
	const value = timeout.trim()
	if (!/^\+?\d+$/.test(value)) return INFINITE_END_TIME
	const seconds = Number.parseInt(value, 10)
	if (!Number.isFinite(seconds) || seconds <= 0) {
		return INFINITE_END_TIME
	}

	return getCurrentTimeUSec() + BigInt(seconds) * USEC_PER_SEC
}

export async function connectPollLoop(
	conninfo?: string | URL | ConnectOptions,
): Promise<PGconn> {
	const resolved = resolveConninfo(conninfo)
	const conn = connectStart(resolved)

	try {
		// PQconninfo reports libpq's effective option (including environment and
		// service defaults). Reuse one deadline across every read/write poll step.
		const endTime = connectTimeoutEndTime(
			connectionInfo(conn).connect_timeout ?? undefined,
		)
		if (status(conn) === ConnStatusType.CONNECTION_BAD) {
			throw new Error(errorMessage(conn))
		}

		let forRead = false
		let forWrite = true

		while (true) {
			await waitSocket(conn, forRead, forWrite, endTime)
			const pollStatus = connectPoll(conn)

			switch (pollStatus) {
				case PostgresPollingStatusType.PGRES_POLLING_OK:
					if (status(conn) !== ConnStatusType.CONNECTION_OK) {
						throw new Error(errorMessage(conn))
					}
					setnonblocking(conn, true)
					return conn

				case PostgresPollingStatusType.PGRES_POLLING_FAILED:
					throw new Error(errorMessage(conn))

				case PostgresPollingStatusType.PGRES_POLLING_READING:
					forRead = true
					forWrite = false
					break

				case PostgresPollingStatusType.PGRES_POLLING_WRITING:
					forRead = false
					forWrite = true
					break

				default:
					throw new Error(`Unknown polling status: ${pollStatus}`)
			}
		}
	} catch (error) {
		finish(conn)
		throw error
	}
}
