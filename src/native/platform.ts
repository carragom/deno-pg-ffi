/** Platform library version probes. @module */
export interface SemVersion {
	version: string
	major: number
	minor: number
	patch: number
}

/**
 * Retrieves the version of glibc installed on a Linux system by executing the
 * `getconf GNU_LIBC_VERSION` command. Parses the output to extract the major
 * and minor version numbers.
 *
 * @returns A Promise that resolves to a SemVersion object containing the glibc version
 *  or null if the version cannot be determined.
 */
export async function getGlibcVersion(): Promise<SemVersion | null> {
	try {
		const p = await Deno.spawnAndWait('getconf', ['GNU_LIBC_VERSION'], {
			stdout: 'piped',
			stderr: 'null',
		})

		if (!p.success) return null

		const text = new TextDecoder().decode(p.stdout).trim() // e.g. "glibc 2.28"
		const m = text.match(/\bglibc\s+((\d+)\.(\d+))\b/i)
		return m?.[1]
			? {
				version: m[1],
				major: Number.parseInt(m[2]),
				minor: Number.parseInt(m[3]),
				patch: 0,
			}
			: null // version not found in output
	} catch {
		return null // command not found, permission denied, not glibc, etc.
	}
}

export async function getOpenSSLVersion(): Promise<string | null> {
	try {
		const p = await Deno.spawnAndWait('openssl', ['version'], {
			stdout: 'piped',
			stderr: 'null',
		})

		if (!p.success) return null

		const text = new TextDecoder().decode(p.stdout).trim() // e.g. "OpenSSL 1.1.1k  25 Mar 2021"
		const m = text.match(/\bOpenSSL\s+(\d+(?:\.\d+)+[a-z]?)\b/i)
		return m?.[1] ?? null
	} catch {
		return null // command not found, permission denied, etc.
	}
}
