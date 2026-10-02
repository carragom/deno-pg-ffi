/** Verify that distributed notices contain the licenses used by the build. @module */
import { parseArgs } from '@std/cli'

const args = parseArgs(Deno.args, { string: ['openssl-license'] })
const notices = await Deno.readTextFile(
	new URL('../THIRD_PARTY_LICENSES.txt', import.meta.url),
)
const postgresLicense = await Deno.readTextFile(
	new URL('../postgres/COPYRIGHT', import.meta.url),
)
if (
	postgresLicense.trim() === '' || !notices.includes(postgresLicense.trim())
) {
	throw new Error(
		'THIRD_PARTY_LICENSES.txt must include the current postgres/COPYRIGHT text.',
	)
}

if (args['openssl-license'] !== undefined) {
	const opensslLicense = await Deno.readTextFile(args['openssl-license'])
	if (
		opensslLicense.trim() === '' || !notices.includes(opensslLicense.trim())
	) {
		throw new Error(
			'THIRD_PARTY_LICENSES.txt must include the license of the bundled OpenSSL build.',
		)
	}
}
