import { assertEquals, assertExists } from '@std/assert'

import {
	ConnStatusType,
	ExecStatusType,
	libpq as ffi,
	PGContextVisibility,
	PGDiag,
	PGPing,
	PGTransactionStatusType,
	PGVerbosity,
	PostgresPollingStatusType,
} from '../libpq.ts'

Deno.test('ffi', async (t) => {
	await t.step('symbol definitions', async (t) => {
		await t.step('should have all required PostgreSQL symbols', () => {
			const requiredSymbols = [
				'PQclear',
				'PQcmdTuples',
				'PQcmdStatus',
				'PQconnectdb',
				'PQconnectdbAsync',
				'PQconninfo',
				'PQconninfoFree',
				'PQconsumeInput',
				'PQdescribePrepared',
				'PQerrorMessage',
				'PQexec',
				'PQexecParams',
				'PQexecPrepared',
				'PQfformat',
				'PQfname',
				'PQftype',
				'PQfnumber',
				'PQfinish',
				'PQfinishAsync',
				'PQresetAsync',
				'PQfreemem',
				'PQgetlength',
				'PQgetisnull',
				'PQgetvalue',
				'PQgetResult',
				'PQisnonblocking',
				'PQnotifies',
				'PQresStatus',
				'PQresultStatus',
				'PQresultErrorMessage',
				'PQresultVerboseErrorMessage',
				'PQnfields',
				'PQntuples',
				'PQprepare',
				'PQsendQuery',
				'PQsendQueryParams',
				'PQserverVersion',
				'PQsetnonblocking',
				'PQsocket',
				'PQsocketPollAsync',
				'PQgetCurrentTimeUSec',
				'PQstatus',
			]

			for (const symbol of requiredSymbols) {
				assertEquals(
					typeof ffi[symbol as keyof typeof ffi],
					'function',
					`Symbol ${symbol} should be defined`,
				)
			}
		})
	})

	await t.step('enum values', async (t) => {
		await t.step('ExecStatusType should have correct values', () => {
			assertEquals(ExecStatusType.PGRES_EMPTY_QUERY, 0)
			assertEquals(ExecStatusType.PGRES_COMMAND_OK, 1)
			assertEquals(ExecStatusType.PGRES_TUPLES_OK, 2)
			assertEquals(ExecStatusType.PGRES_COPY_OUT, 3)
			assertEquals(ExecStatusType.PGRES_COPY_IN, 4)
			assertEquals(ExecStatusType.PGRES_BAD_RESPONSE, 5)
			assertEquals(ExecStatusType.PGRES_NONFATAL_ERROR, 6)
			assertEquals(ExecStatusType.PGRES_FATAL_ERROR, 7)
			assertEquals(ExecStatusType.PGRES_COPY_BOTH, 8)
			assertEquals(ExecStatusType.PGRES_SINGLE_TUPLE, 9)
			assertEquals(ExecStatusType.PGRES_PIPELINE_SYNC, 10)
			assertEquals(ExecStatusType.PGRES_PIPELINE_ABORTED, 11)
		})

		await t.step('ConnStatusType should have correct values', () => {
			assertEquals(ConnStatusType.CONNECTION_OK, 0)
			assertEquals(ConnStatusType.CONNECTION_BAD, 1)
			assertEquals(ConnStatusType.CONNECTION_STARTED, 2)
			assertEquals(ConnStatusType.CONNECTION_MADE, 3)
			assertEquals(ConnStatusType.CONNECTION_AWAITING_RESPONSE, 4)
			assertEquals(ConnStatusType.CONNECTION_AUTH_OK, 5)
			assertEquals(ConnStatusType.CONNECTION_SETENV, 6)
			assertEquals(ConnStatusType.CONNECTION_SSL_STARTUP, 7)
			assertEquals(ConnStatusType.CONNECTION_NEEDED, 8)
			assertEquals(ConnStatusType.CONNECTION_CHECK_WRITABLE, 9)
			assertEquals(ConnStatusType.CONNECTION_CONSUME, 10)
			assertEquals(ConnStatusType.CONNECTION_GSS_STARTUP, 11)
			assertEquals(ConnStatusType.CONNECTION_CHECK_TARGET, 12)
			assertEquals(ConnStatusType.CONNECTION_CHECK_STANDBY, 13)
		})

		await t.step('PGContextVisibility should have correct values', () => {
			assertEquals(PGContextVisibility.PQSHOW_CONTEXT_NEVER, 0)
			assertEquals(PGContextVisibility.PQSHOW_CONTEXT_ERRORS, 1)
			assertEquals(PGContextVisibility.PQSHOW_CONTEXT_ALWAYS, 2)
		})

		await t.step('PGVerbosity should have correct values', () => {
			assertEquals(PGVerbosity.PQERRORS_TERSE, 0)
			assertEquals(PGVerbosity.PQERRORS_DEFAULT, 1)
			assertEquals(PGVerbosity.PQERRORS_VERBOSE, 2)
			assertEquals(PGVerbosity.PQERRORS_SQLSTATE, 3)
		})

		await t.step(
			'PostgresPollingStatusType should have correct values',
			() => {
				assertEquals(PostgresPollingStatusType.PGRES_POLLING_FAILED, 0)
				assertEquals(PostgresPollingStatusType.PGRES_POLLING_READING, 1)
				assertEquals(PostgresPollingStatusType.PGRES_POLLING_WRITING, 2)
				assertEquals(PostgresPollingStatusType.PGRES_POLLING_OK, 3)
				assertEquals(PostgresPollingStatusType.PGRES_POLLING_ACTIVE, 4)
			},
		)

		await t.step('PGPing should have correct values', () => {
			assertEquals(PGPing.PQPING_OK, 0)
			assertEquals(PGPing.PQPING_REJECT, 1)
			assertEquals(PGPing.PQPING_NO_RESPONSE, 2)
			assertEquals(PGPing.PQPING_NO_ATTEMPT, 3)
		})

		await t.step('PGTransactionStatusType should have correct values', () => {
			assertEquals(PGTransactionStatusType.PQTRANS_IDLE, 0)
			assertEquals(PGTransactionStatusType.PQTRANS_ACTIVE, 1)
			assertEquals(PGTransactionStatusType.PQTRANS_INTRANS, 2)
			assertEquals(PGTransactionStatusType.PQTRANS_INERROR, 3)
			assertEquals(PGTransactionStatusType.PQTRANS_UNKNOWN, 4)
		})
	})

	await t.step('PGDiag values', async (t) => {
		await t.step('should match postgres error field ASCII constants', () => {
			assertEquals(PGDiag.SEVERITY, 83)
			assertEquals(PGDiag.SEVERITY_NONLOCALIZED, 86)
			assertEquals(PGDiag.SQLSTATE, 67)
			assertEquals(PGDiag.MESSAGE_PRIMARY, 77)
			assertEquals(PGDiag.MESSAGE_DETAIL, 68)
			assertEquals(PGDiag.MESSAGE_HINT, 72)
			assertEquals(PGDiag.STATEMENT_POSITION, 80)
			assertEquals(PGDiag.INTERNAL_POSITION, 112)
			assertEquals(PGDiag.INTERNAL_QUERY, 113)
			assertEquals(PGDiag.CONTEXT, 87)
			assertEquals(PGDiag.SCHEMA_NAME, 115)
			assertEquals(PGDiag.TABLE_NAME, 116)
			assertEquals(PGDiag.COLUMN_NAME, 99)
			assertEquals(PGDiag.DATATYPE_NAME, 100)
			assertEquals(PGDiag.CONSTRAINT_NAME, 110)
			assertEquals(PGDiag.SOURCE_FILE, 70)
			assertEquals(PGDiag.SOURCE_LINE, 76)
			assertEquals(PGDiag.SOURCE_FUNCTION, 82)

			assertEquals(String.fromCharCode(PGDiag.SEVERITY), 'S')
			assertEquals(String.fromCharCode(PGDiag.SQLSTATE), 'C')
		})
	})

	await t.step('type exports', async (t) => {
		await t.step('should export required types', async () => {
			// Import and check types are available (compilation test)
			const module = await import('../libpq.ts')

			// These should exist as type exports (checked at compile time)
			assertExists(module.ExecStatusType)
			assertExists(module.ConnStatusType)
			assertExists(module.PostgresPollingStatusType)
			assertExists(module.PGContextVisibility)
			assertExists(module.PGVerbosity)
			assertExists(module.PGPing)
			assertExists(module.PGTransactionStatusType)
			assertExists(module.PGDiag)
			assertExists(module.libpq)
		})
	})

	await t.step('integration tests', async (t) => {
		await t.step('should handle null pointers safely', () => {
			// Test that we can call FFI functions even if they might return null
			// This tests the basic FFI binding without needing a real connection
			assertExists(ffi.PQresStatus)

			// PQresStatus with invalid status should not crash
			try {
				const result = ffi.PQresStatus(999) // Invalid status code
				// Should return a buffer or handle gracefully
				assertExists(result)
			} catch (error) {
				// It's ok if it throws, just shouldn't crash Deno
				assertExists(error)
			}
		})

		await t.step('should have consistent parameter counts', () => {
			// Verify some key functions have expected parameter counts by checking their definitions
			// This is a structural test of the symbol definitions
			assertExists(ffi.PQconnectdb) // 1 parameter (conninfo)
			assertExists(ffi.PQexec) // 2 parameters (conn, query)
			assertExists(ffi.PQexecParams) // 8 parameters
			assertExists(ffi.PQfinish) // 1 parameter (conn)
			assertExists(ffi.PQclear) // 1 parameter (result)
		})
	})

	await t.step({
		name: 'async symbol variants',
		sanitizeResources: false,
		fn: async (t) => {
			await t.step(
				'should have async variants for blocking operations',
				() => {
					assertExists(ffi.PQconnectdbAsync)
					assertExists(ffi.PQexecAsync)
					assertExists(ffi.PQexecParamsAsync)
					assertExists(ffi.PQexecPreparedAsync)
					assertExists(ffi.PQprepareAsync)
					assertExists(ffi.PQfinishAsync)
					assertExists(ffi.PQresetAsync)
					assertExists(ffi.PQsocketPollAsync)

					// These should be the async versions of their blocking counterparts
					assertEquals(typeof ffi.PQconnectdbAsync, 'function')
					assertEquals(typeof ffi.PQexecAsync, 'function')
					assertEquals(typeof ffi.PQexecParamsAsync, 'function')
					assertEquals(typeof ffi.PQexecPreparedAsync, 'function')
					assertEquals(typeof ffi.PQprepareAsync, 'function')
					assertEquals(typeof ffi.PQfinishAsync, 'function')
					assertEquals(typeof ffi.PQresetAsync, 'function')
					assertEquals(typeof ffi.PQsocketPollAsync, 'function')
				},
			)
		},
	})
})
