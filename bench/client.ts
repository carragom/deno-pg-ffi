import { PGURL } from '../src/constants.ts'
import { Client } from '../src/mod.ts'

if ((Deno.env.get(PGURL) ?? '').trim() === '') {
	Deno.env.set(PGURL, 'postgresql://localhost')
}

const db = await Client.connect()
await using _insertTable = await db.exec(
	'CREATE TEMP TABLE bench_insert (n int)',
)
const prepared = await db.prepare('SELECT $1::int4 AS n', 'bench_select_n')

Deno.bench('query SELECT 1', async () => {
	await using r = await db.query<{ n: number }>('SELECT 1::int4 AS n')
	if (r.rows[0].n !== 1) {
		throw new Error('unexpected query SELECT 1 result')
	}
})

Deno.bench('query with $1', async () => {
	await using r = await db.query<{ n: number }>(
		'SELECT $1::int4 AS n',
		[7],
	)
	if (r.rows[0].n !== 7) {
		throw new Error('unexpected query $1 result')
	}
})

Deno.bench('query 100 rows', async () => {
	await using r = await db.query<{ n: number }>(
		'SELECT generate_series(1, 100)::int4 AS n',
	)
	let last = 0
	for (const row of r.rows) {
		last = row.n
	}
	if (last !== 100) {
		throw new Error('unexpected 100-row result')
	}
})

Deno.bench('prepared execute', async () => {
	await using r = await prepared.execute<{ n: number }>([3])
	if (r.rows[0].n !== 3) {
		throw new Error('unexpected prepared result')
	}
})

Deno.bench('exec SELECT 1', async () => {
	await using results = await db.exec('SELECT 1::int4 AS n')
	if (results[0].rows[0].n !== 1) {
		throw new Error('unexpected exec result')
	}
})

Deno.bench('insert one row', async () => {
	await using r = await db.query(
		'INSERT INTO bench_insert VALUES ($1)',
		[1],
	)
	if (r.affectedRows !== 1) {
		throw new Error('unexpected insert affectedRows')
	}
})
