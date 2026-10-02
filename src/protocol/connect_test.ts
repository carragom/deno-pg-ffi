import { assert, assertRejects } from '@std/assert'
import { delay } from '@std/async'

import { Client } from '../client/client.ts'
import { Notifier } from '../client/notifier.ts'

type Connector = (conninfo: Record<string, string>) => Promise<unknown>

async function stalledHandshake(
	connect: Connector,
	conninfo: Record<string, string>,
	connectTimeout: string | undefined,
	check: (pending: Promise<unknown>) => Promise<void>,
): Promise<void> {
	const previousTimeout = Deno.env.get('PGCONNECT_TIMEOUT')
	const listener = Deno.listen({ hostname: '127.0.0.1', port: 0 })
	let socket: Deno.Conn | undefined
	let pending: Promise<unknown> | undefined

	try {
		if (connectTimeout === undefined) {
			Deno.env.delete('PGCONNECT_TIMEOUT')
		} else {
			Deno.env.set('PGCONNECT_TIMEOUT', connectTimeout)
		}

		const accepting = listener.accept()
		pending = connect({
			host: '127.0.0.1',
			port: String((listener.addr as Deno.NetAddr).port),
			sslmode: 'disable',
			...conninfo,
		})
		socket = await accepting
		await check(pending)
	} finally {
		socket?.close()
		listener.close()
		if (pending !== undefined) await pending.catch(() => {})
		if (previousTimeout === undefined) {
			Deno.env.delete('PGCONNECT_TIMEOUT')
		} else {
			Deno.env.set('PGCONNECT_TIMEOUT', previousTimeout)
		}
	}
}

async function settlesWithin(
	pending: Promise<unknown>,
	milliseconds: number,
): Promise<void> {
	const settled = await Promise.race([
		pending.then(() => true, () => true),
		delay(milliseconds).then(() => false),
	])
	assert(settled, `connection did not time out within ${milliseconds}ms`)
}

let testLock = Promise.resolve()

function withTestLock(action: () => Promise<void>): Promise<void> {
	const current = testLock.then(action)
	testLock = current.then(() => {}, () => {})
	return current
}

Deno.test('Client.connect honors PGCONNECT_TIMEOUT during a stalled handshake', async () => {
	await withTestLock(() =>
		stalledHandshake(
			(conninfo) => Client.connect(conninfo),
			{},
			'1',
			async (pending) => {
				await settlesWithin(pending, 2500)
				await assertRejects(() => pending)
			},
		)
	)
})

Deno.test('explicit connect_timeout takes precedence over PGCONNECT_TIMEOUT', async () => {
	await withTestLock(() =>
		stalledHandshake(
			(conninfo) => Client.connect(conninfo),
			{ connect_timeout: '1' },
			'5',
			async (pending) => {
				await settlesWithin(pending, 2500)
				await assertRejects(() => pending)
			},
		)
	)
})

Deno.test('Notifier.connect honors PGCONNECT_TIMEOUT during a stalled handshake', async () => {
	await withTestLock(() =>
		stalledHandshake(
			(conninfo) => Notifier.connect(conninfo),
			{},
			'1',
			async (pending) => {
				await settlesWithin(pending, 2500)
				await assertRejects(() => pending)
			},
		)
	)
})

Deno.test('zero connect_timeout leaves the stalled handshake unlimited', async () => {
	await withTestLock(() =>
		stalledHandshake(
			(conninfo) => Client.connect(conninfo),
			{ connect_timeout: '0' },
			undefined,
			async (pending) => {
				const settled = await Promise.race([
					pending.then(() => true, () => true),
					delay(250).then(() => false),
				])
				assert(
					!settled,
					'zero timeout should not end the connection attempt',
				)
			},
		)
	)
})
