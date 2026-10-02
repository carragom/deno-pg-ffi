import { assertEquals, assertThrows } from '@std/assert'
import { libraryFilename, releaseArtifactFilenames } from './artifacts.ts'

Deno.test('local builds and macOS downloads share platform filenames', () => {
	for (const arch of ['x86_64', 'aarch64'] as const) {
		assertEquals(libraryFilename('linux', arch), `libpq_${arch}.so`)
		assertEquals(libraryFilename('darwin', arch), `libpq_${arch}.dylib`)
		assertEquals(libraryFilename('windows', arch), `pq_${arch}.dll`)
		assertEquals(releaseArtifactFilenames('darwin', arch), [
			libraryFilename('darwin', arch),
		])
		assertEquals(releaseArtifactFilenames('linux', arch), [
			`libpq-openssl3_${arch}.so`,
			`libpq-openssl11_${arch}.so`,
		])
	}
	assertEquals(libraryFilename('linux'), 'libpq.so')
	assertEquals(libraryFilename('darwin'), 'libpq.dylib')
	assertThrows(() => libraryFilename('freebsd'), Error, 'Unsupported platform')
})
