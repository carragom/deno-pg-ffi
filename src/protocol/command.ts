/**
 * Shared command transport for managed clients and notifiers.
 * Successful collection transfers ownership of each PGresult to the caller.
 * Partial results are cleared if collection fails; SQL status is left to callers.
 * @module
 */
import {
	clear,
	consumeInput,
	flush,
	getResult,
	isBusy,
} from '../native/wrappers.ts'
import type { PGconn, PGresult } from '../native/types.ts'
import { INFINITE_END_TIME, waitSocket } from './socket.ts'

export function clearAll(results: PGresult[]): void {
	for (const res of results) {
		clear(res)
	}
}

async function flushOutput(conn: PGconn): Promise<void> {
	while (true) {
		const result = flush(conn)
		if (result === 0) {
			return
		}

		// Read while output is blocked, so a server reply cannot stall flushing.
		await waitSocket(conn, true, true, INFINITE_END_TIME)
		consumeInput(conn)
	}
}

function abandonResults(conn: PGconn): void {
	// Failure cleanup drains only results already available; waiting for more
	// input here could hang forever on the failed connection.
	try {
		consumeInput(conn)
	} catch {
		// Connection may already be dead.
	}

	while (isBusy(conn) === 0) {
		const result = getResult(conn)
		if (result === null) {
			return
		}
		clear(result)
	}
}

async function collectResults(conn: PGconn): Promise<PGresult[]> {
	const results: PGresult[] = []

	try {
		while (true) {
			consumeInput(conn)

			if (isBusy(conn) === 1) {
				await waitSocket(conn, true, false, INFINITE_END_TIME)
				continue
			}

			// Drain through NULL even after an error result; managed callers inspect
			// SQL statuses only once transport ownership has fully transferred.
			const result = getResult(conn)
			if (result === null) {
				return results
			}
			results.push(result)
		}
	} catch (error) {
		for (const res of results) {
			clear(res)
		}
		abandonResults(conn)
		throw error
	}
}

export async function afterSend(conn: PGconn): Promise<PGresult[]> {
	try {
		await flushOutput(conn)
		return await collectResults(conn)
	} catch (error) {
		abandonResults(conn)
		throw error
	}
}
