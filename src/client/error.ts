/** SQL errors copied from native results. @module */
import { ExecStatusType, PGDiag, type PGresult } from '../native/types.ts'
import {
	resultErrorField,
	resultErrorMessage,
	resultStatus,
} from '../native/wrappers.ts'

/**
 * Server SQL failure from a managed command, preparation, statement execution,
 * or Notifier listen/unlisten. Diagnostics are copied from PG_DIAG fields;
 * this error retains no native result. The native error result is already cleared.
 *
 * Connection, transport, closed-owner, and overlapping-command failures use
 * ordinary Errors. Parameter validation uses TypeError; decoder failures happen
 * later during lazy row access and propagate their own errors.
 *
 * @example
 * ```ts
 * import { PostgresError, Client } from '../mod.ts'
 *
 * await using db = await Client.connect()
 * try {
 * 	await using result = await db.query('SELECT 1 / 0')
 * } catch (error) {
 * 	if (!(error instanceof PostgresError) || error.sqlstate !== '22012') {
 * 		throw error
 * 	}
 * }
 * ```
 */
export class PostgresError extends Error {
	/** Five-character SQLSTATE code; empty if the server omitted it. */
	readonly sqlstate: string
	/** Server-reported severity, such as ERROR or FATAL; may be localized. */
	readonly severity: string
	/** Optional secondary explanation from PG_DIAG_MESSAGE_DETAIL. */
	readonly detail: string | undefined
	/** Optional suggested action from PG_DIAG_MESSAGE_HINT. */
	readonly hint: string | undefined
	/** Optional one-based character position in the submitted SQL, represented as text. */
	readonly position: string | undefined
	/** Optional schema name associated with the failure. */
	readonly schema: string | undefined
	/** Optional table name associated with the failure. */
	readonly table: string | undefined
	/** Optional column name associated with the failure. */
	readonly column: string | undefined
	/** Optional constraint name associated with the failure. */
	readonly constraint: string | undefined

	/**
	 * Construct an error from diagnostics already copied out of a PGresult.
	 * @param message Primary human-readable server message.
	 * @param fields Copied SQLSTATE, severity, and optional diagnostic fields.
	 */
	constructor(
		message: string,
		fields: {
			/** Five-character SQLSTATE code; empty if the server omitted it. */
			sqlstate: string
			/** Server-reported severity, such as ERROR or FATAL; may be localized. */
			severity: string
			/** Optional secondary explanation from PG_DIAG_MESSAGE_DETAIL. */
			detail?: string
			/** Optional suggested action from PG_DIAG_MESSAGE_HINT. */
			hint?: string
			/** Optional one-based character position in the submitted SQL, represented as text. */
			position?: string
			/** Optional schema name associated with the failure. */
			schema?: string
			/** Optional table name associated with the failure. */
			table?: string
			/** Optional column name associated with the failure. */
			column?: string
			/** Optional constraint name associated with the failure. */
			constraint?: string
		},
	) {
		super(message)
		this.name = 'PostgresError'
		this.sqlstate = fields.sqlstate
		this.severity = fields.severity
		this.detail = fields.detail
		this.hint = fields.hint
		this.position = fields.position
		this.schema = fields.schema
		this.table = fields.table
		this.column = fields.column
		this.constraint = fields.constraint
	}
}

function optionalField(res: PGresult, field: PGDiag): string | undefined {
	const value = resultErrorField(res, field)
	return value === null || value === '' ? undefined : value
}

export function pgErrorFromResult(res: PGresult): PostgresError {
	return new PostgresError(
		resultErrorMessage(res) || 'PostgreSQL error',
		{
			sqlstate: optionalField(res, PGDiag.SQLSTATE) ?? '',
			severity: optionalField(res, PGDiag.SEVERITY) ?? '',
			detail: optionalField(res, PGDiag.MESSAGE_DETAIL),
			hint: optionalField(res, PGDiag.MESSAGE_HINT),
			position: optionalField(res, PGDiag.STATEMENT_POSITION),
			schema: optionalField(res, PGDiag.SCHEMA_NAME),
			table: optionalField(res, PGDiag.TABLE_NAME),
			column: optionalField(res, PGDiag.COLUMN_NAME),
			constraint: optionalField(res, PGDiag.CONSTRAINT_NAME),
		},
	)
}

export function isFatalStatus(status: ExecStatusType): boolean {
	return status === ExecStatusType.PGRES_FATAL_ERROR ||
		status === ExecStatusType.PGRES_BAD_RESPONSE
}

export function throwIfFatal(results: PGresult[]): void {
	for (const res of results) {
		if (isFatalStatus(resultStatus(res))) {
			throw pgErrorFromResult(res)
		}
	}
}
