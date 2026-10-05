/** Exercise both entry points from a prepared package or the JSR registry. @module */
const [managedSpecifier, rawSpecifier] = Deno.args
if (!managedSpecifier || !rawSpecifier) {
	throw new Error('Provide the managed and raw entry point specifiers.')
}
if (Deno.env.get('DENO_LIBPQ_PATH') || Deno.env.get('DENO_LIBPQ_URL')) {
	throw new Error('Smoke verification must use the default packaged library.')
}
const { Client, Pool, Notifier } = await import(managedSpecifier)
const { PQgetCurrentTimeUSec, PQconnectdb, PQfinish } = await import(
	rawSpecifier
)
if (
	!Client || !Pool || !Notifier ||
	typeof PQconnectdb !== 'function' || typeof PQfinish !== 'function' ||
	typeof PQgetCurrentTimeUSec() !== 'bigint'
) {
	throw new Error('Package exports or the loaded libpq version are invalid.')
}
if (Deno.env.get('PGURL')) {
	await using client = await Client.connect()
	await using result = await client.query('SELECT 42::int4 AS answer')
	if (result.rows[0].answer !== 42) {
		throw new Error('Package query smoke failed.')
	}
}
