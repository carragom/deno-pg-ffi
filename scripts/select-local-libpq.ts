/** Select the local libpq build before test or benchmark modules load. @module */
import { fromFileUrl } from '@std/path'
import { DENO_LIBPQ_PATH } from '../src/constants.ts'
import { libraryFilename } from '../src/native/artifacts.ts'

Deno.env.set(
	DENO_LIBPQ_PATH,
	fromFileUrl(
		new URL(
			`../dist/${libraryFilename(Deno.build.os, Deno.build.arch)}`,
			import.meta.url,
		),
	),
)
