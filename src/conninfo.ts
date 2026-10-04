import { PGURL } from './constants.ts'

/**
 * Supported libpq 17 connection option names for
 * {@linkcode ConnectOptions}. See the upstream
 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PARAMKEYWORDS | parameter keywords}.
 */
export type ConnectKeyword =
	| 'host'
	| 'hostaddr'
	| 'port'
	| 'dbname'
	| 'user'
	| 'password'
	| 'passfile'
	| 'require_auth'
	| 'channel_binding'
	| 'connect_timeout'
	| 'client_encoding'
	| 'options'
	| 'application_name'
	| 'fallback_application_name'
	| 'keepalives'
	| 'keepalives_idle'
	| 'keepalives_interval'
	| 'keepalives_count'
	| 'tcp_user_timeout'
	| 'replication'
	| 'gssencmode'
	| 'sslmode'
	| 'requiressl'
	| 'sslnegotiation'
	| 'sslcompression'
	| 'sslcert'
	| 'sslkey'
	| 'sslpassword'
	| 'sslcertmode'
	| 'sslrootcert'
	| 'sslcrl'
	| 'sslcrldir'
	| 'sslsni'
	| 'requirepeer'
	| 'ssl_min_protocol_version'
	| 'ssl_max_protocol_version'
	| 'krbsrvname'
	| 'gsslib'
	| 'gssdelegation'
	| 'service'
	| 'target_session_attrs'
	| 'load_balance_hosts'

/**
 * Connection options accepted by
 * {@linkcode Client.connect},
 * {@linkcode Pool.create}, and
 * {@linkcode Notifier.connect}.
 * Keys are libpq
 * {@link https://www.postgresql.org/docs/17/libpq-connect.html#LIBPQ-PARAMKEYWORDS | parameter keywords}.
 * Values are strings; properties set to `undefined` are omitted. An explicit
 * object bypasses `PGURL`; unspecified fields still use libpq's environment
 * variables, connection files, and defaults. For example, `{ connect_timeout:
 * '5' }` limits the poll handshake to five seconds while leaving other fields
 * at their defaults. See
 * {@linkcode Client.connect}
 * for all connection forms and precedence.
 */
export type ConnectOptions = { [K in ConnectKeyword]?: string }

export function resolveConninfo(
	conninfo?: string | URL | ConnectOptions,
): string {
	if (conninfo === undefined) {
		const pgurl = Deno.env.get(PGURL)
		if (pgurl !== undefined && pgurl.trim() !== '') {
			return conninfoToString(pgurl)
		}

		return ''
	}

	return conninfoToString(conninfo)
}

export function conninfoToString(
	conninfo: string | URL | ConnectOptions,
): string {
	if (conninfo instanceof URL) {
		return conninfoFromUrl(conninfo)
	} else if (typeof conninfo === 'object') {
		return Object.entries(conninfo).filter(([, v]) => v !== undefined)
			.map(([k, v]) => formatConninfoPair(k, v))
			.join(' ')
	} else {
		if (
			conninfo.startsWith('postgresql://') ||
			conninfo.startsWith('postgres://')
		) {
			try {
				return conninfoFromUrl(new URL(conninfo))
			} catch {
				return conninfo
			}
		}

		return conninfo
	}
}

export function conninfoFromUrl(url: URL): string {
	const params = conninfoParamsFromUrl(url)

	return Object.entries(params).map(([key, value]) =>
		formatConninfoPair(key, value)
	).join(' ')
}

export function conninfoParamsFromUrl(url: URL): ConnectOptions {
	const params = new Map<string, string>()
	const host = hostFromUrl(url)

	if (host !== '') {
		params.set('host', host)
	}

	if (url.port !== '') {
		params.set('port', url.port)
	}

	if (url.username !== '') {
		params.set('user', decodeURIComponent(url.username))
	}

	if (url.password !== '') {
		params.set('password', decodeURIComponent(url.password))
	}

	if (url.pathname.length > 1) {
		params.set('dbname', decodeURIComponent(url.pathname.slice(1)))
	}

	for (const [key, value] of url.searchParams.entries()) {
		if (value.trim() === '') {
			continue
		}

		params.set(key, value)
	}

	return Object.fromEntries(params) as ConnectOptions
}

function hostFromUrl(url: URL): string {
	const host = url.hostname

	// URL.hostname keeps RFC 3986 brackets on IPv6 literals (`[::1]`).
	// Keyword-form host= is passed to getaddrinfo(), which treats `[::1]`
	// as a DNS name and fails. Strip the brackets so host=::1.
	if (host.startsWith('[') && host.endsWith(']')) {
		return host.slice(1, -1)
	}

	return host
}

export function formatConninfoPair(key: string, value: string): string {
	return `${key}=${escapeConninfoValue(value)}`
}

export function escapeConninfoValue(value: string): string {
	if (!/[\s'\\]/.test(value)) {
		return value
	}

	const escaped = value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")
	return `'${escaped}'`
}
