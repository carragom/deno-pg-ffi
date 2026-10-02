/** libpq pointer types, notification payloads, and enums. @module */
/** A `LISTEN` / `NOTIFY` payload. */
export interface Notify {
	/** Channel name. */
	relname: string
	/** Backend process id of the notifying session. */
	bePid: number
	/** Payload sent with the notification. */
	extra: string
}

/** PostgreSQL object/type identifier, represented as a JavaScript number. */
export type Oid = number
/** Opaque caller-owned cancel handle from PQgetCancel; release with PQfreeCancel. */
export type PGcancel = Deno.PointerObject
/** Opaque connection handle. Raw callers release it with PQfinish after pending calls complete. */
export type PGconn = Deno.PointerObject
/** Opaque independently owned result handle. Release with PQclear; its borrowed field pointers then become invalid. */
export type PGresult = Deno.PointerObject
/** Nullable pointer to an allocated PGnotify structure from PQnotifies. A non-null structure is released with PQfreemem after copying its fields. */
export type PGnotify = Deno.PointerValue

/** C result status codes returned by PQresultStatus. */
export enum ExecStatusType {
	/** Empty query string was executed. */
	PGRES_EMPTY_QUERY,
	/** A query command that doesn't return anything was executed properly by the backend. */
	PGRES_COMMAND_OK,
	/** A query command that returns tuples was executed properly by the backend, PGresult contains the result tuples. */
	PGRES_TUPLES_OK,
	/** Copy Out data transfer in progress. */
	PGRES_COPY_OUT,
	/** Copy In data transfer in progress. */
	PGRES_COPY_IN,
	/** An unexpected response was recv'd from the backend. */
	PGRES_BAD_RESPONSE,
	/** Notice or warning message. */
	PGRES_NONFATAL_ERROR,
	/** Query failed. */
	PGRES_FATAL_ERROR,
	/** Copy In/Out data transfer in progress. */
	PGRES_COPY_BOTH,
	/** Single tuple from larger resultset. */
	PGRES_SINGLE_TUPLE,
	/** Pipeline synchronization point. */
	PGRES_PIPELINE_SYNC,
	/** Command did not run because of an abort earlier in the pipeline. */
	PGRES_PIPELINE_ABORTED,
}

/** C connection status codes returned by PQstatus; intermediate values describe a poll handshake. */
export enum ConnStatusType {
	/** The connection is ready to use. */
	CONNECTION_OK,
	/** The connection failed or is unusable; inspect PQerrorMessage. */
	CONNECTION_BAD,
	/** Waiting for connection to be made. */
	CONNECTION_STARTED,
	/** Connection OK; waiting to send. */
	CONNECTION_MADE,
	/** Waiting for a response from the postmaster. */
	CONNECTION_AWAITING_RESPONSE,
	/** Received authentication; waiting for backend startup. */
	CONNECTION_AUTH_OK,
	/** This state is no longer used. */
	CONNECTION_SETENV,
	/** Negotiating SSL. */
	CONNECTION_SSL_STARTUP,
	/** Internal state: connect() needed. */
	CONNECTION_NEEDED,
	/** Checking if session is read-write. */
	CONNECTION_CHECK_WRITABLE,
	/** Consuming any extra messages. */
	CONNECTION_CONSUME,
	/** Negotiating GSSAPI. */
	CONNECTION_GSS_STARTUP,
	/** Checking target server properties. */
	CONNECTION_CHECK_TARGET,
	/** Checking if server is in standby mode. */
	CONNECTION_CHECK_STANDBY,
}

/** C poll-step outcomes from PQconnectPoll and PQresetPoll. */
export enum PostgresPollingStatusType {
	/** The async operation failed. */
	PGRES_POLLING_FAILED,
	/** Async operation waiting for reading. */
	PGRES_POLLING_READING,
	/** Async operation waiting for writing. */
	PGRES_POLLING_WRITING,
	/** Async operation completed successfully. */
	PGRES_POLLING_OK,
	/** Deprecated, should not appear. */
	PGRES_POLLING_ACTIVE,
}

/** Controls whether formatted diagnostics include the server CONTEXT field. */
export enum PGContextVisibility {
	/** Never show CONTEXT field. */
	PQSHOW_CONTEXT_NEVER,
	/** Show CONTEXT for errors only (default). */
	PQSHOW_CONTEXT_ERRORS,
	/** Always show CONTEXT field. */
	PQSHOW_CONTEXT_ALWAYS,
}

/** Controls the detail of server error messages formatted by libpq. */
export enum PGVerbosity {
	/** Single-line error messages. */
	PQERRORS_TERSE,
	/** Recommended style. */
	PQERRORS_DEFAULT,
	/** Include detailed diagnostics. */
	PQERRORS_VERBOSE,
	/** Only error severity and SQLSTATE code. */
	PQERRORS_SQLSTATE,
}

/** Server availability outcomes returned by PQping. */
export enum PGPing {
	/** Server is accepting connections. */
	PQPING_OK,
	/** Server is alive but rejecting connections. */
	PQPING_REJECT,
	/** Could not establish connection. */
	PQPING_NO_RESPONSE,
	/** Connection not attempted (bad params). */
	PQPING_NO_ATTEMPT,
}

/** Transaction state codes returned by PQtransactionStatus. */
export enum PGTransactionStatusType {
	/** Connection idle. */
	PQTRANS_IDLE,
	/** Command in progress. */
	PQTRANS_ACTIVE,
	/** Idle, within transaction block. */
	PQTRANS_INTRANS,
	/** Idle, within failed transaction. */
	PQTRANS_INERROR,
	/** Cannot determine status. */
	PQTRANS_UNKNOWN,
}

/**
 * Error field codes for use with PQresultErrorField
 * Based on postgres_ext.h PG_DIAG_* constants
 * Each value corresponds to the ASCII code of a single character
 */
export enum PGDiag {
	/** Localized severity, such as ERROR or FATAL. */
	SEVERITY = 83,
	/** Nonlocalized severity, suitable for programmatic comparisons. */
	SEVERITY_NONLOCALIZED = 86,
	/** Five-character SQLSTATE diagnostic code. */
	SQLSTATE = 67,
	/** Primary human-readable error message. */
	MESSAGE_PRIMARY = 77,
	/** Secondary explanation of the failure. */
	MESSAGE_DETAIL = 68,
	/** Suggested action to address the failure. */
	MESSAGE_HINT = 72,
	/** One-based character position in the submitted statement, returned as text. */
	STATEMENT_POSITION = 80,
	/** One-based character position in the internally generated statement, returned as text. */
	INTERNAL_POSITION = 112,
	/** Internally generated statement associated with the error. */
	INTERNAL_QUERY = 113,
	/** Server execution-context details. */
	CONTEXT = 87,
	/** Schema associated with the error. */
	SCHEMA_NAME = 115,
	/** Table associated with the error. */
	TABLE_NAME = 116,
	/** Column associated with the error. */
	COLUMN_NAME = 99,
	/** Data type associated with the error. */
	DATATYPE_NAME = 100,
	/** Constraint associated with the error. */
	CONSTRAINT_NAME = 110,
	/** Server source file where the error was reported. */
	SOURCE_FILE = 70,
	/** Server source line where the error was reported, returned as text. */
	SOURCE_LINE = 76,
	/** Server source function where the error was reported. */
	SOURCE_FUNCTION = 82,
}
