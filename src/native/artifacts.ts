/** Pure platform naming shared by builds, local tasks, and downloads. @module */

/** Formats a library filename, optionally including an architecture suffix. */
export function libraryFilename(
	os: (typeof Deno.build)['os'],
	arch: (typeof Deno.build)['arch'] | null = null,
	name = 'pq',
): string {
	let prefix = 'lib'
	let extension: string
	switch (os) {
		case 'linux':
			extension = 'so'
			break
		case 'darwin':
			extension = 'dylib'
			break
		case 'windows':
			prefix = ''
			extension = 'dll'
			break
		default:
			throw new Error(`Unsupported platform: ${os}`)
	}
	return `${prefix}${name}${arch === null ? '' : `_${arch}`}.${extension}`
}

/** Lists release filenames in load order; Linux tries OpenSSL 3 before 1.1. */
export function releaseArtifactFilenames(
	os: (typeof Deno.build)['os'],
	arch: (typeof Deno.build)['arch'],
): string[] {
	const names = os === 'linux' ? ['pq-openssl3', 'pq-openssl11'] : ['pq']
	return names.map((name) => libraryFilename(os, arch, name))
}
