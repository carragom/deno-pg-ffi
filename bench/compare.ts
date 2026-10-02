import postgres from 'npm:postgres@3'
import pg from 'npm:pg@8'

import { PGURL } from '../src/constants.ts'
import { Client } from '../src/mod.ts'

if ((Deno.env.get(PGURL) ?? '').trim() === '') {
	Deno.env.set(PGURL, 'postgresql://localhost')
}

const pgurl = jsConnectionUrl(Deno.env.get(PGURL)!)
const WORLD_SIZE = 10_000
const SELECT_SQL = 'SELECT randomnumber FROM bench_world WHERE id = $1'

function jsConnectionUrl(raw: string): string {
	const url = new URL(raw)
	if (url.username === '') {
		const user = Deno.env.get('PGUSER') || Deno.env.get('USER')
		if (user !== undefined && user !== '') {
			url.username = user
		}
	}
	if (url.password === '') {
		const password = Deno.env.get('PGPASSWORD') ?? passwordFromPgpass(url)
		if (password !== undefined && password !== '') {
			url.password = password
		}
	}
	if (url.pathname === '' || url.pathname === '/') {
		const db = Deno.env.get('PGDATABASE') || url.username
		if (db !== undefined && db !== '') {
			url.pathname = `/${db}`
		}
	}
	return url.href
}

function passwordFromPgpass(url: URL): string | undefined {
	const home = Deno.env.get('HOME')
	if (home === undefined) {
		return undefined
	}
	let text: string
	try {
		text = Deno.readTextFileSync(`${home}/.pgpass`)
	} catch {
		return undefined
	}
	const host = url.hostname || 'localhost'
	const port = url.port || '5432'
	const db = url.pathname.replace(/^\//, '') || Deno.env.get('PGDATABASE') ||
		'*'
	const user = url.username || Deno.env.get('PGUSER') ||
		Deno.env.get('USER') ||
		'*'
	for (const line of text.split('\n')) {
		if (line.startsWith('#') || line.trim() === '') {
			continue
		}
		const parts = line.split(':')
		if (parts.length < 5) {
			continue
		}
		const [phost, pport, pdb, puser, ...rest] = parts
		if (
			hostMatch(phost, host) && wildcard(pport, port) &&
			wildcard(pdb, db) && wildcard(puser, user)
		) {
			return rest.join(':').replaceAll('\\:', ':')
		}
	}
	return undefined
}

function wildcard(pattern: string | undefined, value: string): boolean {
	return pattern === '*' || pattern === value
}

function hostMatch(pattern: string | undefined, host: string): boolean {
	if (wildcard(pattern, host)) {
		return true
	}
	const aliases = new Set(['localhost', '127.0.0.1'])
	return pattern !== undefined && aliases.has(pattern) && aliases.has(host)
}

const db = await Client.connect(pgurl)
await using _world = await db.exec(`
	CREATE TABLE IF NOT EXISTS bench_world (
		id int PRIMARY KEY,
		randomnumber int NOT NULL
	);
	TRUNCATE bench_world;
	INSERT INTO bench_world (id, randomnumber)
	SELECT i, (random() * ${WORLD_SIZE})::int
	FROM generate_series(1, ${WORLD_SIZE}) AS i;
`)

const SIMPLE_SQL = 'SELECT randomnumber FROM bench_world WHERE id = 1'
const PREPARED_NAME = 'bench_world_by_id'

const sql = postgres(pgurl, { max: 1, prepare: true })
const nodePg = new pg.Client({ connectionString: pgurl })
await nodePg.connect()
const prepared = await db.prepare(SELECT_SQL, PREPARED_NAME)

function randomId(): number {
	return Math.floor(Math.random() * WORLD_SIZE) + 1
}

function requireNumber(value: unknown, label: string): void {
	if (typeof value !== 'number') {
		throw new Error(`${label} missing randomnumber`)
	}
}

Deno.bench({
	name: 'Client',
	group: 'prepared-params',
	baseline: true,
	async fn() {
		await using r = await prepared.execute<{ randomnumber: number }>([
			randomId(),
		])
		requireNumber(r.rows[0].randomnumber, 'Client')
	},
})

Deno.bench({
	name: 'postgres.js',
	group: 'prepared-params',
	async fn() {
		const id = randomId()
		const rows = await sql`
			SELECT randomnumber FROM bench_world WHERE id = ${id}
		`
		requireNumber(rows[0]?.randomnumber, 'postgres.js')
	},
})

Deno.bench({
	name: 'npm:pg',
	group: 'prepared-params',
	async fn() {
		const result = await nodePg.query({
			name: PREPARED_NAME,
			text: SELECT_SQL,
			values: [randomId()],
		})
		requireNumber(result.rows[0]?.randomnumber, 'npm:pg')
	},
})

Deno.bench({
	name: 'Client',
	group: 'simple-no-params',
	baseline: true,
	async fn() {
		await using results = await db.exec(SIMPLE_SQL)
		requireNumber(results[0].rows[0].randomnumber, 'Client')
	},
})

Deno.bench({
	name: 'postgres.js',
	group: 'simple-no-params',
	async fn() {
		const rows = await sql.unsafe(SIMPLE_SQL)
		requireNumber(rows[0]?.randomnumber, 'postgres.js')
	},
})

Deno.bench({
	name: 'npm:pg',
	group: 'simple-no-params',
	async fn() {
		const result = await nodePg.query(SIMPLE_SQL)
		requireNumber(result.rows[0]?.randomnumber, 'npm:pg')
	},
})

Deno.bench({
	name: 'Client',
	group: 'simple-params',
	baseline: true,
	async fn() {
		await using r = await db.query<{ randomnumber: number }>(
			SELECT_SQL,
			[randomId()],
		)
		requireNumber(r.rows[0].randomnumber, 'Client')
	},
})

Deno.bench({
	name: 'postgres.js',
	group: 'simple-params',
	async fn() {
		const rows = await sql.unsafe(SELECT_SQL, [randomId()])
		requireNumber(rows[0]?.randomnumber, 'postgres.js')
	},
})

Deno.bench({
	name: 'npm:pg',
	group: 'simple-params',
	async fn() {
		const result = await nodePg.query(SELECT_SQL, [randomId()])
		requireNumber(result.rows[0]?.randomnumber, 'npm:pg')
	},
})
