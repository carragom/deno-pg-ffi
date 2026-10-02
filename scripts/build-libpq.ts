#! /usr/bin/env -S deno run --allow-run --allow-read --allow-write --allow-env

// deno-lint-ignore-file no-console
import { parseArgs } from '@std/cli'
import { existsSync } from '@std/fs'
import { basename, join, resolve } from '@std/path'
import { libraryFilename } from '../src/native/artifacts.ts'

/** Options for the local build and macOS release builds. */
export interface BuildOptions {
	/** Overrides the default filename under dist/. */
	output?: string
	/** Rebuilds even when the output already exists. */
	force?: boolean
	/** Prefix containing OpenSSL headers and libraries, e.g. brew --prefix openssl@3. */
	opensslPrefix?: string
	/** Links OpenSSL archives into a macOS dylib and checks its dependencies. */
	staticOpenssl?: boolean
}

/** Builds libpq, replacing the output only after success. */
export function buildLibpq(
	options: BuildOptions = {},
	projectDir = resolve(import.meta.dirname!, '..'),
): void {
	if (Deno.build.os !== 'linux' && Deno.build.os !== 'darwin') {
		throw new Error(`Building libpq on ${Deno.build.os} is not implemented.`)
	}
	if (
		options.staticOpenssl &&
		(Deno.build.os !== 'darwin' || !options.opensslPrefix)
	) {
		throw new Error('--static-openssl requires macOS and --openssl-prefix.')
	}
	const postgresDir = join(projectDir, 'postgres')
	const srcDir = join(postgresDir, 'src', 'interfaces', 'libpq')
	const libPath = join(srcDir, libraryFilename(Deno.build.os))
	const distDir = join(projectDir, 'dist')
	const outPath = resolve(
		distDir,
		options.output ?? libraryFilename(Deno.build.os, Deno.build.arch),
	)

	if (!options.force && existsSync(outPath)) {
		console.log(
			`libpq already exists at ${outPath}, skipping build. Use --force to rebuild.`,
		)
		return
	}

	let staticDir: string | undefined
	let stagedPath: string | undefined
	try {
		const configureArgs = [
			'--with-ssl=openssl',
			'--without-gssapi',
			'--without-icu',
			'--without-readline',
			'--without-zlib',
		]
		const opensslPrefix = options.opensslPrefix ??
			(Deno.build.os === 'darwin' ? homebrewOpenSSL() : undefined)
		if (opensslPrefix) {
			let libraryDir = join(opensslPrefix, 'lib')
			if (options.staticOpenssl) {
				// A directory containing only archives prevents accidental dylib linkage.
				staticDir = Deno.makeTempDirSync({ prefix: 'libpq-openssl-' })
				for (const name of ['libssl.a', 'libcrypto.a']) {
					Deno.copyFileSync(join(libraryDir, name), join(staticDir, name))
				}
				libraryDir = staticDir
			}
			configureArgs.push(
				`--with-includes=${join(opensslPrefix, 'include')}`,
				`--with-libraries=${libraryDir}`,
			)
		}
		run('./configure', configureArgs, postgresDir)
		// Configuration changes do not reliably invalidate existing objects.
		for (const dir of ['common', 'port', 'interfaces/libpq']) {
			run(
				'make',
				['-C', join(postgresDir, 'src', dir), 'clean'],
				postgresDir,
			)
		}
		// The default target's exit-symbol check also sees static OpenSSL's
		// atexit/pthread_exit references. Build the libraries directly in that case.
		run(
			'make',
			['-C', srcDir, ...(options.staticOpenssl ? ['all-lib'] : [])],
			postgresDir,
		)

		Deno.mkdirSync(distDir, { recursive: true })
		stagedPath = `${outPath}.${crypto.randomUUID()}.tmp`
		Deno.copyFileSync(libPath, stagedPath)
		if (options.staticOpenssl) {
			run('install_name_tool', [
				'-id',
				`@rpath/${basename(outPath)}`,
				stagedPath,
			], postgresDir)
			checkMacosDependencies(stagedPath)
			// Modifying the install name invalidates the linker's ad hoc signature.
			run('codesign', ['--force', '--sign', '-', stagedPath], postgresDir)
		}
		Deno.renameSync(stagedPath, outPath)
		stagedPath = undefined
		console.log(
			`Successfully built libpq for ${Deno.build.os} (${Deno.build.arch}) at ${outPath}`,
		)
	} finally {
		if (stagedPath && existsSync(stagedPath)) Deno.removeSync(stagedPath)
		if (staticDir) Deno.removeSync(staticDir, { recursive: true })
	}
}

function homebrewOpenSSL(): string | undefined {
	try {
		const output = new Deno.Command('brew', {
			args: ['--prefix', 'openssl@3'],
			stdout: 'piped',
			stderr: 'null',
		}).outputSync()
		return output.success
			? new TextDecoder().decode(output.stdout).trim() || undefined
			: undefined
	} catch {
		// An explicit prefix or compiler flags can select a non-Homebrew install.
		return undefined
	}
}

/** Rejects external dylibs in macOS release builds. */
function checkMacosDependencies(path: string): void {
	const output = new Deno.Command('otool', {
		args: ['-L', path],
		stdout: 'piped',
		stderr: 'piped',
	}).outputSync()
	if (!output.success) {
		throw new Error(
			`otool failed: ${new TextDecoder().decode(output.stderr)}`,
		)
	}
	const entries = new TextDecoder().decode(output.stdout).trim().split('\n')
		.slice(1).map((line) =>
			line.trim().replace(/\s+\(compatibility version.*$/, '')
		)
	if (entries.length < 2) throw new Error('Could not read dylib dependencies.')
	// The first entry is the library's own install name.
	for (const dependency of entries.slice(1)) {
		if (
			!dependency.startsWith('/usr/lib/') &&
			!dependency.startsWith('/System/Library/')
		) {
			throw new Error(`Non-system dylib dependency: ${dependency}`)
		}
	}
}

function run(command: string, args: string[], cwd: string): void {
	const status = new Deno.Command(command, {
		args,
		cwd,
		stdout: 'inherit',
		stderr: 'inherit',
	}).outputSync()
	if (!status.success) {
		throw new Error(`${command} failed with exit code ${status.code}.`)
	}
}

if (import.meta.main) {
	const args = parseArgs(Deno.args, {
		string: ['output', 'openssl-prefix'],
		boolean: ['force', 'static-openssl'],
		alias: { o: 'output', f: 'force' },
	})
	buildLibpq({
		output: args.output,
		force: args.force,
		opensslPrefix: args['openssl-prefix'],
		staticOpenssl: args['static-openssl'],
	})
}
