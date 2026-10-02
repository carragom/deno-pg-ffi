import { assertEquals, assertInstanceOf, assertRejects } from '@std/assert'
import { delay } from '@std/async'

import { PGURL } from '../constants.ts'
import { Client, PostgresError } from '../mod.ts'
import { Notifier } from './notifier.ts'

const DEFAULT_PGURL = 'postgresql://localhost'
const TEST_INTERVAL_MS = 25
let initialPgurl: string | undefined
let previousPgurl: string

Deno.test.beforeAll(() => {
	initialPgurl = Deno.env.get(PGURL)
	if (initialPgurl === undefined || initialPgurl.trim() === '') {
		Deno.env.set(PGURL, DEFAULT_PGURL)
	}
})

Deno.test.afterAll(() => {
	if (initialPgurl === undefined) {
		Deno.env.delete(PGURL)
	} else {
		Deno.env.set(PGURL, initialPgurl)
	}
})

Deno.test.beforeEach(() => {
	previousPgurl = Deno.env.get(PGURL)!
})

Deno.test.afterEach(() => {
	if (previousPgurl === undefined) {
		Deno.env.delete(PGURL)
	} else {
		Deno.env.set(PGURL, previousPgurl)
	}
})

function getPGURL(): string {
	const pgurl = Deno.env.get(PGURL)
	if (pgurl === undefined || pgurl.trim() === '') {
		throw new Error(`${PGURL} must be set for this test`)
	}

	return pgurl
}

function channelName(): string {
	return `notify_${crypto.randomUUID().replaceAll('-', '')}`
}

async function waitUntil(
	predicate: () => boolean,
	timeoutMs = 2000,
): Promise<void> {
	const deadline = Date.now() + timeoutMs
	while (!predicate()) {
		if (Date.now() >= deadline) {
			throw new Error('timed out waiting for notification')
		}
		await delay(10)
	}
}

Deno.test('Notifier two callbacks on one channel', async () => {
	const channel = channelName()
	await using db = await Client.connect(getPGURL())
	const n = await Notifier.connect(getPGURL(), {
		interval: TEST_INTERVAL_MS,
	})
	try {
		let first = 0
		let second = 0
		const onFirst = () => {
			first++
		}
		const onSecond = () => {
			second++
		}

		await n.listen(channel, onFirst)
		await n.listen(channel, onSecond)
		await db.query('SELECT pg_notify($1, $2)', [channel, 'one'])
		await waitUntil(() => first === 1 && second === 1)

		await n.unlisten(channel, onFirst)
		await db.query('SELECT pg_notify($1, $2)', [channel, 'two'])
		await waitUntil(() => second === 2)
		assertEquals(first, 1)

		await n.unlisten(channel)
		await db.query('SELECT pg_notify($1, $2)', [channel, 'three'])
		await delay(TEST_INTERVAL_MS * 4)
		assertEquals(first, 1)
		assertEquals(second, 2)
	} finally {
		await n.close()
	}
})

Deno.test('Notifier duplicate callback is a no-op', async () => {
	const channel = channelName()
	await using db = await Client.connect(getPGURL())
	const n = await Notifier.connect(getPGURL(), {
		interval: TEST_INTERVAL_MS,
	})
	try {
		let count = 0
		const cb = () => {
			count++
		}

		await n.listen(channel, cb)
		await n.listen(channel, cb)
		await db.query('SELECT pg_notify($1, $2)', [channel, 'once'])
		await waitUntil(() => count >= 1)
		await delay(TEST_INTERVAL_MS * 2)
		assertEquals(count, 1)
	} finally {
		await n.close()
	}
})

Deno.test('Notifier two instances both receive', async () => {
	const channel = channelName()
	await using db = await Client.connect(getPGURL())
	const a = await Notifier.connect(getPGURL(), {
		interval: TEST_INTERVAL_MS,
	})
	const b = await Notifier.connect(getPGURL(), {
		interval: TEST_INTERVAL_MS,
	})
	try {
		let fromA = 0
		let fromB = 0
		await a.listen(channel, () => {
			fromA++
		})
		await b.listen(channel, () => {
			fromB++
		})
		await db.query('SELECT pg_notify($1, $2)', [channel, 'both'])
		await waitUntil(() => fromA === 1 && fromB === 1)
	} finally {
		await a.close()
		await b.close()
	}
})

Deno.test('Notifier listen after close rejects', async () => {
	const n = await Notifier.connect(getPGURL(), {
		interval: TEST_INTERVAL_MS,
	})
	await n.close()
	await assertRejects(async () => {
		await n.listen(channelName(), () => {})
	})
})

Deno.test('Notifier await using finishes the connection', async () => {
	const channel = channelName()
	await using db = await Client.connect(getPGURL())
	let notifier: Notifier

	{
		await using n = await Notifier.connect(getPGURL(), {
			interval: TEST_INTERVAL_MS,
		})
		notifier = n
		let seen = false
		await n.listen(channel, () => {
			seen = true
		})
		await db.query('SELECT pg_notify($1, $2)', [channel, 'using'])
		await waitUntil(() => seen)
	}

	await assertRejects(async () => {
		await notifier.listen(channelName(), () => {})
	})
})

Deno.test('Notifier receives Notify from Client', async () => {
	const channel = channelName()
	await using db = await Client.connect(getPGURL())
	await using notifier = await Notifier.connect(getPGURL(), {
		interval: TEST_INTERVAL_MS,
	})

	const got = Promise.withResolvers<{
		relname: string
		bePid: number
		extra: string
	}>()
	await notifier.listen(channel, (n) => {
		got.resolve(n)
	})
	await db.query('SELECT pg_notify($1, $2)', [channel, 'hello'])
	const notify = await got.promise
	assertEquals(notify.relname, channel)
	assertEquals(notify.extra, 'hello')
	assertEquals(typeof notify.bePid, 'number')
})

Deno.test('Notifier enforces server identifier length in UTF-8 bytes', async () => {
	const asciiBoundary = 'a'.repeat(63)
	const multibyteBoundary = 'é'.repeat(31) + 'a'
	const tooLong = 'b'.repeat(64)
	const multibyteTooLong = 'é'.repeat(32)
	await using db = await Client.connect(getPGURL())
	await using notifier = await Notifier.connect(getPGURL(), {
		interval: TEST_INTERVAL_MS,
	})
	let received = 0
	await notifier.listen(asciiBoundary, () => received++)
	await notifier.listen(multibyteBoundary, () => received++)
	await db.query('SELECT pg_notify($1, $2)', [asciiBoundary, 'ascii'])
	await db.query('SELECT pg_notify($1, $2)', [multibyteBoundary, 'utf8'])
	await waitUntil(() => received === 2)

	for (const channel of [tooLong, multibyteTooLong]) {
		const listenError = await assertRejects(() =>
			notifier.listen(channel, () => {})
		)
		assertInstanceOf(listenError, RangeError)
		const unlistenError = await assertRejects(() =>
			notifier.unlisten(channel)
		)
		assertInstanceOf(unlistenError, RangeError)
	}
	await notifier.unlisten(asciiBoundary)
	await notifier.unlisten(multibyteBoundary)
})

Deno.test('Notifier accepts fractional intervals', async () => {
	const channel = channelName()
	await using db = await Client.connect(getPGURL())
	let receiveError: Error | undefined
	const notifier = await Notifier.connect(getPGURL(), {
		interval: 0.5,
		onError: (error) => {
			receiveError = error
		},
	})
	try {
		let seen = false
		await notifier.listen(channel, () => {
			seen = true
		})
		await db.query('SELECT pg_notify($1, $2)', [channel, 'fractional'])
		await waitUntil(() => seen)
		assertEquals(receiveError, undefined)
	} finally {
		await notifier.close()
	}
	assertEquals(receiveError, undefined)
})

Deno.test('Notifier listen failure is PostgresError', async () => {
	await using notifier = await Notifier.connect(getPGURL(), {
		interval: TEST_INTERVAL_MS,
	})
	const error = await assertRejects(async () => {
		await notifier.listen('', () => {})
	})
	assertInstanceOf(error, PostgresError)
})
