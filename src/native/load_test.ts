import { assertEquals, assertStringIncludes } from '@std/assert'
import { DENO_LIBPQ_PATH } from '../constants.ts'
import { copy } from '@std/fs'
import { fromFileUrl, join } from '@std/path'

Deno.test('import fails when lib is not found', async (t) => {
	for (const entry of ['mod', 'libpq']) {
		await t.step(entry, async () => {
			// A fresh process exercises eager loading through each public entry
			// without reusing the loader already cached by other tests.
			const url = new URL(`../${entry}.ts`, import.meta.url).href
			const output = await Deno.spawnAndWait(
				Deno.execPath(),
				['eval', `await import(${JSON.stringify(url)})`],
				{
					env: { [DENO_LIBPQ_PATH]: 'fail.so' },
					stdout: 'null',
					stderr: 'piped',
				},
			)
			assertEquals(output.success, false)
			assertStringIncludes(
				new TextDecoder().decode(output.stderr),
				'fail.so',
			)
		})
	}
})

const localPath = Deno.env.get(DENO_LIBPQ_PATH)

Deno.test({
	name:
		'packaged libraries load beside local and remote modules without GitHub',
	ignore: localPath === undefined,
	async fn(t) {
		const { releaseArtifactFilenames } = await import('./artifacts.ts')
		const filenames = releaseArtifactFilenames(Deno.build.os, Deno.build.arch)
		const temporary = await Deno.makeTempDir({ prefix: 'libpq-package-' })
		const requests: string[] = []
		let server: Deno.HttpServer<Deno.NetAddr> | undefined
		try {
			await copy(
				fromFileUrl(new URL('../', import.meta.url)),
				join(temporary, 'src'),
			)
			await Deno.copyFile(
				new URL('../../deno.json', import.meta.url),
				join(temporary, 'deno.json'),
			)
			await Deno.mkdir(join(temporary, 'prebuilds'))
			for (const filename of filenames) {
				await Deno.writeFile(
					join(temporary, 'prebuilds', filename),
					filename === filenames.at(-1)
						? await Deno.readFile(localPath!)
						: new TextEncoder().encode('unloadable first candidate'),
				)
			}
			server = Deno.serve(
				{ hostname: '127.0.0.1', port: 0, onListen() {} },
				async (request) => {
					const path = new URL(request.url).pathname
					requests.push(path)
					if (!path.startsWith('/package/')) {
						return new Response('missing', { status: 404 })
					}
					try {
						const bytes = await Deno.readFile(
							join(temporary, path.slice('/package/'.length)),
						)
						return new Response(bytes, {
							headers: {
								'content-type': path.endsWith('.ts')
									? 'application/typescript'
									: path.endsWith('.json')
									? 'application/json'
									: 'application/octet-stream',
							},
						})
					} catch (error) {
						if (!(error instanceof Deno.errors.NotFound)) {
							throw error
						}
						return new Response('missing', { status: 404 })
					}
				},
			)
			for (
				const base of [
					`file://${temporary}/`,
					`http://127.0.0.1:${server.addr.port}/package/`,
				]
			) {
				await t.step(
					base.startsWith('file:') ? 'local package' : 'remote package',
					async () => {
						const managed = new URL('src/mod.ts', base).href
						const raw = new URL('src/libpq.ts', base).href
						const output = await Deno.spawnAndWait(Deno.execPath(), [
							'eval',
							`Deno.env.delete('DENO_LIBPQ_PATH'); Deno.env.delete('DENO_LIBPQ_URL'); await import(${
								JSON.stringify(managed)
							}); const {libpq} = await import(${
								JSON.stringify(raw)
							}); if(typeof libpq.PQgetCurrentTimeUSec() !== 'bigint') throw new Error('invalid libpq')`,
						], { stdout: 'null', stderr: 'piped' })
						assertEquals(
							output.success,
							true,
							new TextDecoder().decode(output.stderr),
						)
					},
				)
			}
			assertEquals(
				requests.filter((path) => path.includes('/prebuilds/')),
				filenames.map((name) => `/package/prebuilds/${name}`),
			)
		} finally {
			await server?.shutdown()
			await Deno.remove(temporary, { recursive: true })
		}
	},
})

Deno.test({
	name:
		'download loader selects platform assets and falls back after an unloadable library',
	ignore: localPath === undefined,
	async fn() {
		const { releaseArtifactFilenames } = await import('./artifacts.ts')
		const filenames = releaseArtifactFilenames(Deno.build.os, Deno.build.arch)
		const bytes = await Deno.readFile(localPath!)
		const requests: string[] = []
		const server = Deno.serve({
			hostname: '127.0.0.1',
			port: 0,
			onListen() {},
		}, (request) => {
			const path = new URL(request.url).pathname
			requests.push(path)
			return path === `/assets/${filenames.at(-1)}`
				? new Response(bytes)
				: new Response('not a dynamic library')
		})
		try {
			const url = new URL('../libpq.ts', import.meta.url).href
			const output = await Deno.spawnAndWait(
				Deno.execPath(),
				[
					'eval',
					`Deno.env.delete('DENO_LIBPQ_PATH'); await import(${
						JSON.stringify(url)
					})`,
				],
				{
					env: {
						DENO_LIBPQ_URL: `http://127.0.0.1:${server.addr.port}/assets`,
					},
					stdout: 'piped',
					stderr: 'piped',
				},
			)
			assertEquals(
				output.success,
				true,
				new TextDecoder().decode(output.stderr),
			)
			assertEquals(requests, filenames.map((name) => `/assets/${name}`))
		} finally {
			await server.shutdown()
		}
	},
})

Deno.test({
	name: 'download loader reports every failed Linux candidate',
	ignore: Deno.build.os !== 'linux',
	async fn() {
		const server = Deno.serve({
			hostname: '127.0.0.1',
			port: 0,
			onListen() {},
		}, () => new Response('missing', { status: 404 }))
		try {
			const url = new URL('../mod.ts', import.meta.url).href
			const output = await Deno.spawnAndWait(
				Deno.execPath(),
				[
					'eval',
					`Deno.env.delete('DENO_LIBPQ_PATH'); try { await import(${
						JSON.stringify(url)
					}) } catch(error) { if(!error.cause.openssl3 || !error.cause.openssl11) throw error; console.error(error.message); Deno.exit(1) }`,
				],
				{
					env: { DENO_LIBPQ_URL: `http://127.0.0.1:${server.addr.port}/` },
					stdout: 'null',
					stderr: 'piped',
				},
			)
			assertEquals(output.code, 1)
			const stderr = new TextDecoder().decode(output.stderr)
			assertStringIncludes(stderr, 'Failed to load libpq dynamic library')
			assertStringIncludes(
				stderr,
				`libpq-openssl3_${Deno.build.arch}.so then libpq-openssl11_${Deno.build.arch}.so`,
			)
		} finally {
			await server.shutdown()
		}
	},
})
