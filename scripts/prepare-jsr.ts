/** Prepare the exact JSR package using verified GitHub release assets. @module */
import { parseArgs } from '@std/cli'
import { expandGlob } from '@std/fs'
import { dirname, fromFileUrl, join, relative, resolve } from '@std/path'
import { releaseArtifactFilenames } from '../src/native/artifacts.ts'

interface ReleaseAsset {
	name: string
	url: string
	size: number
	digest: string | null
}

interface Release {
	tagName: string
	isDraft: boolean
	assets: ReleaseAsset[]
}

/** Download, verify, and stage the files selected by the publishing config. */
export async function preparePackage(
	root: string,
	release: Release,
	tag: string,
	output: string,
): Promise<
	{ files: string[]; size: number; checksums: Record<string, string> }
> {
	root = resolve(root)
	output = resolve(output)
	if (output === root || !relative(root, output).startsWith('..')) {
		throw new Error('Stage the package outside the source checkout.')
	}
	const config = JSON.parse(await Deno.readTextFile(join(root, 'deno.json')))
	if (
		config.name !== '@carragom/deno-pg-ffi' || tag !== `v${config.version}` ||
		release.tagName !== tag || release.isDraft !== false
	) {
		throw new Error('The package version must match a published release tag.')
	}
	if (
		Object.keys(config.exports).sort().join(',') !== '.,./libpq' ||
		config.exports['.'] !== './src/mod.ts' ||
		config.exports['./libpq'] !== './src/libpq.ts'
	) throw new Error('Expected only the managed and raw public entry points.')
	try {
		for await (const _entry of Deno.readDir(output)) {
			throw new Error('The package staging directory must be empty.')
		}
	} catch (error) {
		if (!(error instanceof Deno.errors.NotFound)) throw error
	}
	const names = ['linux', 'darwin'].flatMap((os) =>
		(['x86_64', 'aarch64'] as const).flatMap((arch) =>
			releaseArtifactFilenames(os as 'linux' | 'darwin', arch)
		)
	)
	const checksums: Record<string, string> = {}
	await Deno.mkdir(join(root, 'prebuilds'), { recursive: true })
	const downloads = await Promise.allSettled(
		[...names, 'THIRD_PARTY_LICENSES.txt'].map(async (name) => {
			const matches = release.assets.filter((asset) => asset.name === name)
			if (matches.length !== 1) {
				throw new Error(`Expected one release asset: ${name}`)
			}
			const asset = matches[0]
			if (
				asset.url !== `${config.github}/releases/download/${tag}/${name}` ||
				!asset.digest?.match(/^sha256:[a-f0-9]{64}$/) ||
				asset.size <= 0 || asset.size >= 20 * 1024 * 1024
			) throw new Error(`Invalid release asset metadata: ${name}`)
			const response = await fetch(asset.url)
			if (!response.ok) {
				throw new Error(`Downloading ${name}: HTTP ${response.status}`)
			}
			const bytes = new Uint8Array(await response.arrayBuffer())
			const digest = await sha256(bytes)
			if (bytes.length !== asset.size || digest !== asset.digest) {
				throw new Error(`Release asset size or SHA-256 mismatch: ${name}`)
			}
			if (name === 'THIRD_PARTY_LICENSES.txt') {
				if (
					await sha256(await Deno.readFile(join(root, name))) !== digest
				) {
					throw new Error(
						'Release licenses differ from the selected source commit.',
					)
				}
			} else {
				await Deno.writeFile(join(root, 'prebuilds', name), bytes)
			}
			checksums[name] = digest
		}),
	)
	for (const download of downloads) {
		if (download.status === 'rejected') throw download.reason
	}
	const files = new Set<string>()
	for (const pattern of config.publish.include) {
		for await (
			const entry of expandGlob(pattern, {
				root,
				exclude: config.publish.exclude.filter((pattern: string) =>
					!pattern.startsWith('!')
				),
				includeDirs: false,
			})
		) {
			if (!entry.isFile || entry.isSymlink) {
				throw new Error(
					`Only regular package files are allowed: ${entry.path}`,
				)
			}
			files.add(relative(root, entry.path))
		}
	}
	for (
		const name of [
			'deno.json',
			'LICENSE',
			'THIRD_PARTY_LICENSES.txt',
			...names.map((name) => join('prebuilds', name)),
		]
	) {
		if (!files.has(name)) throw new Error(`Missing package file: ${name}`)
	}
	if (
		[...files].some((name) => /(?:^|\/)(README\.md|.*_test\.ts)$/.test(name))
	) {
		throw new Error('README and tests must not be published.')
	}
	if (
		[...files].filter((name) => name.startsWith('prebuilds/')).length !==
			names.length
	) {
		throw new Error(
			'The package must contain exactly the six release binaries.',
		)
	}
	let size = 0
	for (const name of files) {
		const bytes = await Deno.readFile(join(root, name))
		size += bytes.length
		if (bytes.length >= 20 * 1024 * 1024 || size >= 20 * 1024 * 1024) {
			throw new Error('The package exceeds the JSR 20 MiB size limit.')
		}
		const destination = join(output, name)
		await Deno.mkdir(dirname(destination), { recursive: true })
		await Deno.writeFile(destination, bytes)
	}
	return { files: [...files].sort(), size, checksums }
}

async function sha256(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
	return `sha256:${
		Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
	}`
}

if (import.meta.main) {
	const args = parseArgs(Deno.args, { string: ['release', 'tag', 'output'] })
	if (!args.release || !args.tag || !args.output) {
		throw new Error(
			'Required: --release <json> --tag <tag> --output <directory>',
		)
	}
	const release = JSON.parse(await Deno.readTextFile(args.release))
	const result = await preparePackage(
		fromFileUrl(new URL('../', import.meta.url)),
		release,
		args.tag,
		args.output,
	)
	await Deno.stdout.write(
		new TextEncoder().encode(`${JSON.stringify(result, null, 2)}\n`),
	)
}
