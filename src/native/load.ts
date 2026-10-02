/** Eagerly load libpq with all required symbols (libpq 17+). @module */
import { dlopen } from '@denosaurs/plug'
import { DENO_LIBPQ_PATH, DENO_LIBPQ_URL } from '../constants.ts'
import meta from '../../deno.json' with { type: 'json' }
import { releaseArtifactFilenames } from './artifacts.ts'
import { type Libpq, symbols } from './symbols.ts'

const libCustomPath = Deno.env.get(DENO_LIBPQ_PATH)
let lib: Deno.DynamicLibrary<Deno.ForeignLibraryInterface>

if (libCustomPath === undefined) {
	const base = Deno.env.get(DENO_LIBPQ_URL) ??
		`${meta.github}/releases/download/v${meta.version}/`
	const filenames = releaseArtifactFilenames(Deno.build.os, Deno.build.arch)
	const failures: unknown[] = []
	let loaded: typeof lib | undefined
	for (const filename of filenames) {
		try {
			loaded = await dlopen({
				url: new URL(filename, base.endsWith('/') ? base : `${base}/`),
			}, symbols)
			break
		} catch (error) {
			failures.push(error)
		}
	}
	if (loaded === undefined) {
		throw new Error(
			`Failed to load libpq dynamic library (tried ${
				filenames.join(' then ')
			}).`,
			{
				cause: Deno.build.os === 'linux'
					? { openssl3: failures[0], openssl11: failures[1] }
					: failures[0],
			},
		)
	}
	lib = loaded
} else {
	lib = Deno.dlopen(libCustomPath, symbols)
}

export const ffi = lib.symbols as unknown as Libpq
