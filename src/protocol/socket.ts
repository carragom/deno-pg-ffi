/** Socket waits and deadlines through libpq's poll protocol. @module */
import { errorMessage, socket, socketPoll } from '../native/wrappers.ts'
import type { PGconn } from '../native/types.ts'

export const INFINITE_END_TIME = -1n

export async function waitSocket(
	conn: PGconn,
	forRead: boolean,
	forWrite: boolean,
	endTime: bigint,
): Promise<void> {
	const sock = socket(conn)
	if (sock < 0) {
		throw new Error(errorMessage(conn))
	}

	const result = await socketPoll(sock, forRead, forWrite, endTime)
	if (result > 0) {
		return
	}
	if (result === 0) {
		throw new Error('Connection timed out')
	}
	throw new Error('Socket poll failed')
}
