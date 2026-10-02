import { assertEquals, assertExists } from '@std/assert'
import meta from '../deno.json' with { type: 'json' }
import {
	ConnStatusType,
	ExecStatusType,
	type Libpq,
	libpq,
	PGDiag,
} from './libpq.ts'

const raw: Libpq = libpq
const encoder = new TextEncoder()
const cString = (value: string): Uint8Array<ArrayBuffer> =>
	encoder.encode(value + '\0')

Deno.test('package exports only the managed API and raw libpq', () => {
	assertEquals(meta.exports, {
		'.': './src/mod.ts',
		'./libpq': './src/libpq.ts',
	})
})

Deno.test('raw connection failures return a caller-owned bad connection', () => {
	const conn = raw.PQconnectdb(cString('invalid_connection_option=1'))
	assertExists(conn)
	try {
		assertEquals(raw.PQstatus(conn), ConnStatusType.CONNECTION_BAD)
		const message = raw.PQerrorMessage(conn)
		assertExists(message)
		assertEquals(
			new Deno.UnsafePointerView(message).getCString().length > 0,
			true,
		)
	} finally {
		raw.PQfinish(conn)
	}
})

Deno.test('raw SQL failures return an error result without throwing', () => {
	const conn = raw.PQconnectdb(cString(Deno.env.get('PGURL') ?? ''))
	assertExists(conn)
	try {
		assertEquals(raw.PQstatus(conn), ConnStatusType.CONNECTION_OK)
		const result = raw.PQexec(conn, cString('SELECT 1 / 0'))
		assertExists(result)
		try {
			assertEquals(
				raw.PQresultStatus(result),
				ExecStatusType.PGRES_FATAL_ERROR,
			)
			const sqlstate = raw.PQresultErrorField(result, PGDiag.SQLSTATE)
			assertExists(sqlstate)
			assertEquals(
				new Deno.UnsafePointerView(sqlstate).getCString(),
				'22012',
			)
		} finally {
			raw.PQclear(result)
		}
	} finally {
		raw.PQfinish(conn)
	}
})
