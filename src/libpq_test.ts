import { assertEquals, assertExists } from '@std/assert'
import meta from '../deno.json' with { type: 'json' }
import {
	ConnStatusType,
	ExecStatusType,
	PGDiag,
	PQclear,
	PQconnectdb,
	PQerrorMessage,
	PQexec,
	PQfinish,
	PQresultErrorField,
	PQresultStatus,
	PQstatus,
} from './libpq.ts'

import * as raw from './libpq.ts'
import { ffi } from './native/load.ts'
import { symbols } from './native/symbols.ts'
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
	const conn = PQconnectdb(cString('invalid_connection_option=1'))
	assertExists(conn)
	try {
		assertEquals(PQstatus(conn), ConnStatusType.CONNECTION_BAD)
		const message = PQerrorMessage(conn)
		assertExists(message)
		assertEquals(
			new Deno.UnsafePointerView(message).getCString().length > 0,
			true,
		)
	} finally {
		PQfinish(conn)
	}
})

Deno.test('raw SQL failures return an error result without throwing', () => {
	const conn = PQconnectdb(cString(Deno.env.get('PGURL') ?? ''))
	assertExists(conn)
	try {
		assertEquals(PQstatus(conn), ConnStatusType.CONNECTION_OK)
		const result = PQexec(conn, cString('SELECT 1 / 0'))
		assertExists(result)
		try {
			assertEquals(
				PQresultStatus(result),
				ExecStatusType.PGRES_FATAL_ERROR,
			)
			const sqlstate = PQresultErrorField(result, PGDiag.SQLSTATE)
			assertExists(sqlstate)
			assertEquals(
				new Deno.UnsafePointerView(sqlstate).getCString(),
				'22012',
			)
		} finally {
			PQclear(result)
		}
	} finally {
		PQfinish(conn)
	}
})

Deno.test('raw entry point exports each loaded function directly without a table object', () => {
	assertEquals(
		Object.keys(raw).filter((name) => name.startsWith('PQ')).sort(),
		Object.keys(symbols).sort(),
	)
	for (const name of Object.keys(symbols) as (keyof typeof symbols)[]) {
		assertEquals(raw[name], ffi[name], name)
	}
	assertEquals('libpq' in raw, false)
})
