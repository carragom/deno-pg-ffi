import { assertEquals } from '@std/assert'
import {
	conninfoFromUrl,
	conninfoParamsFromUrl,
	conninfoToString,
} from './conninfo.ts'

Deno.test('conninfoToString', async (t) => {
	await t.step('omits undefined connection options', () => {
		assertEquals(conninfoToString({}), '')
		assertEquals(conninfoToString({ host: undefined, user: undefined }), '')
		const config: { host?: string; user?: string } = { user: 'alice' }
		assertEquals(
			conninfoToString({
				host: config.host,
				user: config.user,
				dbname: 'app',
			}),
			'user=alice dbname=app',
		)
	})

	await t.step('preserves explicit strings and escaping', () => {
		assertEquals(
			conninfoToString({ host: 'undefined', password: '', port: undefined }),
			'host=undefined password=',
		)
		assertEquals(
			conninfoToString({
				application_name: "Alice's \\ app",
				host: undefined,
			}),
			"application_name='Alice\\'s \\\\ app'",
		)
	})

	await t.step('preserves URL and keyword-string behavior', () => {
		const url = 'postgresql://alice@localhost/app?application_name=demo'
		const expected =
			'host=localhost user=alice dbname=app application_name=demo'
		assertEquals(conninfoToString(url), expected)
		assertEquals(conninfoToString(new URL(url)), expected)
		const keyword = "host=localhost application_name='demo app'"
		assertEquals(conninfoToString(keyword), keyword)
	})
})

Deno.test('conninfoParamsFromUrl', async (t) => {
	await t.step('strips IPv6 URI brackets from host', () => {
		const params = conninfoParamsFromUrl(new URL('postgresql://[::1]/db'))
		assertEquals(params.host, '::1')
		assertEquals(params.dbname, 'db')
		assertEquals(
			conninfoFromUrl(new URL('postgresql://[::1]/db')),
			'host=::1 dbname=db',
		)
	})

	await t.step('preserves query parameters for libpq to validate', () => {
		const params = conninfoParamsFromUrl(
			new URL(
				'postgresql://alice@db.example/app?require_auth=scram-sha-256&sslnegotiation=direct',
			),
		)
		assertEquals(params.user, 'alice')
		assertEquals(params.host, 'db.example')
		assertEquals(params.dbname, 'app')
		assertEquals(params.require_auth, 'scram-sha-256')
		assertEquals(params.sslnegotiation, 'direct')
	})

	await t.step('lets query parameters override authority fields', () => {
		const params = conninfoParamsFromUrl(
			new URL('postgresql://host1/db?host=host2'),
		)
		assertEquals(params.host, 'host2')
		assertEquals(params.dbname, 'db')
	})

	await t.step('omits dbname when the URL has no database path', () => {
		const params = conninfoParamsFromUrl(
			new URL('postgresql://alice@db.example'),
		)
		assertEquals(params.user, 'alice')
		assertEquals(params.host, 'db.example')
		assertEquals(params.dbname, undefined)
	})

	await t.step('skips empty query parameter values', () => {
		const params = conninfoParamsFromUrl(
			new URL('postgresql://db.example/app?sslmode=&application_name=demo'),
		)
		assertEquals(params.sslmode, undefined)
		assertEquals(params.application_name, 'demo')
	})
})
