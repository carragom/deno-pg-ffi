import { assertEquals, assertRejects } from '@std/assert'
import { join } from '@std/path'
import { preparePackage } from './prepare-jsr.ts'
import { releaseArtifactFilenames } from '../src/native/artifacts.ts'

async function fixture() {
	const temporary = await Deno.makeTempDir({ prefix: 'prepare-jsr-' })
	const root = join(temporary, 'source')
	const output = join(temporary, 'package')
	await Deno.mkdir(join(root, 'src'), { recursive: true })
	const bytes = new Uint8Array([0, 255, 42])
	const digest = `sha256:${
		Array.from(
			new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
			(byte) => byte.toString(16).padStart(2, '0'),
		).join('')
	}`
	const server = Deno.serve(
		{ hostname: '127.0.0.1', port: 0, onListen() {} },
		() => new Response(bytes),
	)
	const github = `http://127.0.0.1:${server.addr.port}`
	const tag = 'v0.1.0-alpha.1'
	const config = {
		name: '@carragom/deno-pg-ffi',
		version: '0.1.0-alpha.1',
		github,
		exports: { '.': './src/mod.ts', './libpq': './src/libpq.ts' },
		publish: {
			include: [
				'deno.json',
				'LICENSE',
				'THIRD_PARTY_LICENSES.txt',
				'src/**/*.ts',
				'prebuilds/*.so',
				'prebuilds/*.dylib',
			],
			exclude: ['src/**/*_test.ts', '!prebuilds/'],
		},
	}
	await Deno.writeTextFile(join(root, 'deno.json'), JSON.stringify(config))
	await Deno.writeTextFile(join(root, 'LICENSE'), 'License')
	await Deno.writeFile(join(root, 'THIRD_PARTY_LICENSES.txt'), bytes)
	for (const name of ['mod.ts', 'libpq.ts', 'mod_test.ts']) {
		await Deno.writeTextFile(join(root, 'src', name), 'export {}')
	}
	await Deno.writeTextFile(join(root, 'README.md'), 'Not in the JSR package')
	await Deno.writeTextFile(join(root, '.gitignore'), 'prebuilds/\n')
	const names = (['linux', 'darwin'] as const).flatMap((os) =>
		(['x86_64', 'aarch64'] as const).flatMap((arch) =>
			releaseArtifactFilenames(os, arch)
		)
	)
	const release = {
		tagName: tag,
		isDraft: false,
		assets: [...names, 'THIRD_PARTY_LICENSES.txt'].map((name) => ({
			name,
			url: `${github}/releases/download/${tag}/${name}`,
			size: bytes.length,
			digest,
		})),
	}
	return {
		root,
		output,
		tag,
		config,
		release,
		async [Symbol.asyncDispose]() {
			await server.shutdown()
			await Deno.remove(temporary, { recursive: true })
		},
	}
}

Deno.test('prepare JSR includes verified binaries and excludes README and tests', async () => {
	await using f = await fixture()
	const result = await preparePackage(f.root, f.release, f.tag, f.output)
	assertEquals(result.files.length, 11)
	assertEquals(result.files.includes('README.md'), false)
	assertEquals(result.files.includes('src/mod_test.ts'), false)
	assertEquals(
		result.files.filter((file) => file.startsWith('prebuilds/')).length,
		6,
	)
	assertEquals(Object.keys(result.checksums).length, 7)
	assertEquals(
		await Deno.readFile(
			join(f.output, 'prebuilds', f.release.assets[0].name),
		),
		new Uint8Array([0, 255, 42]),
	)
	const dryRun = await Deno.spawnAndWait(
		Deno.execPath(),
		['publish', '--dry-run'],
		{ cwd: f.root, stdout: 'piped', stderr: 'piped' },
	)
	const log = new TextDecoder().decode(dryRun.stdout) +
		new TextDecoder().decode(dryRun.stderr)
	assertEquals(dryRun.success, true, log)
	for (const file of result.files) {
		assertEquals(
			log.includes(`${file} (`),
			true,
			`Missing published file: ${file}\n${log}`,
		)
	}
})

Deno.test('prepare JSR rejects incompatible release metadata before staging', async (t) => {
	for (
		const scenario of [
			'draft',
			'tag',
			'missing',
			'duplicate',
			'digest',
			'size',
			'url',
		] as const
	) {
		await t.step(scenario, async () => {
			await using f = await fixture()
			switch (scenario) {
				case 'draft':
					f.release.isDraft = true
					break
				case 'tag':
					f.release.tagName = 'v1.0.0'
					break
				case 'missing':
					f.release.assets.pop()
					break
				case 'duplicate':
					f.release.assets.push(f.release.assets[0])
					break
				case 'digest':
					f.release.assets[0].digest = `sha256:${'0'.repeat(64)}`
					break
				case 'size':
					f.release.assets[0].size++
					break
				case 'url':
					f.release.assets[0].url += '?other=asset'
					break
			}
			await assertRejects(() =>
				preparePackage(f.root, f.release, f.tag, f.output)
			)
			await assertRejects(() => Deno.stat(f.output), Deno.errors.NotFound)
		})
	}
})

Deno.test('prepare JSR rejects license drift and unexpected stale binaries', async (t) => {
	await t.step('license drift', async () => {
		await using f = await fixture()
		await Deno.writeTextFile(
			join(f.root, 'THIRD_PARTY_LICENSES.txt'),
			'Different license',
		)
		await assertRejects(
			() => preparePackage(f.root, f.release, f.tag, f.output),
			Error,
			'licenses differ',
		)
	})
	await t.step('stale binary', async () => {
		await using f = await fixture()
		await Deno.mkdir(join(f.root, 'prebuilds'))
		await Deno.writeTextFile(
			join(f.root, 'prebuilds', 'unexpected.so'),
			'stale',
		)
		await assertRejects(
			() => preparePackage(f.root, f.release, f.tag, f.output),
			Error,
			'exactly the six',
		)
	})
})
