import { assertEquals, assertStringIncludes } from '@std/assert'
import { DENO_LIBPQ_PATH } from '../constants.ts'

Deno.test('import fails when lib is not found', async (t) => {
	for (const entry of ['mod', 'libpq']) {
		await t.step(entry, async () => {
			// A fresh process exercises eager loading through each public entry
			// without reusing the loader already cached by other tests.
			const url = new URL(`../${entry}.ts`, import.meta.url).href
			const output = await new Deno.Command(Deno.execPath(), {
				args: ['eval', `await import(${JSON.stringify(url)})`],
				env: { [DENO_LIBPQ_PATH]: 'fail.so' },
				stdout: 'null',
				stderr: 'piped',
			}).output()
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
			const output = await new Deno.Command(Deno.execPath(), {
				args: [
					'eval',
					`Deno.env.delete('DENO_LIBPQ_PATH'); await import(${
						JSON.stringify(url)
					})`,
				],
				env: {
					DENO_LIBPQ_URL: `http://127.0.0.1:${server.addr.port}/assets`,
				},
				stdout: 'piped',
				stderr: 'piped',
			}).output()
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
			const output = await new Deno.Command(Deno.execPath(), {
				args: [
					'eval',
					`Deno.env.delete('DENO_LIBPQ_PATH'); try { await import(${
						JSON.stringify(url)
					}) } catch(error) { if(!error.cause.openssl3 || !error.cause.openssl11) throw error; console.error(error.message); Deno.exit(1) }`,
				],
				env: { DENO_LIBPQ_URL: `http://127.0.0.1:${server.addr.port}/` },
				stdout: 'null',
				stderr: 'piped',
			}).output()
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
