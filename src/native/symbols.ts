/** libpq function signatures and native symbol declarations. @module */
import type { PGconn } from './types.ts'

/**
 * Internal signatures of the eagerly loaded libpq symbol table.
 * Public function contracts are documented on the named exports in src/libpq.ts.
 */
export interface LibpqSymbols {
	PQbackendPID: (conn: Deno.PointerObject) => number
	PQbinaryTuples: (res: Deno.PointerObject) => number
	PQcancel: (
		cancel: Deno.PointerObject,
		errbuf: BufferSource,
		errbufsize: number,
	) => number
	PQclear: (res: Deno.PointerObject) => void
	PQcmdStatus: (res: Deno.PointerObject) => Deno.PointerValue
	PQcmdTuples: (res: Deno.PointerObject) => Deno.PointerValue
	PQconnectdb: (conninfo: BufferSource) => Deno.PointerValue
	PQconnectdbAsync: (
		conninfo: BufferSource,
	) => Promise<Deno.PointerValue>
	PQconnectPoll: (conn: Deno.PointerObject) => number
	PQconnectStart: (conninfo: BufferSource) => Deno.PointerValue
	PQconninfo: (conn: PGconn) => Deno.PointerValue
	PQconninfoFree: (options: Deno.PointerObject) => void
	PQconsumeInput: (conn: Deno.PointerObject) => number
	PQdb: (conn: Deno.PointerObject) => Deno.PointerValue
	PQdescribePrepared: (
		conn: Deno.PointerObject,
		stmt: BufferSource,
	) => Deno.PointerValue
	PQerrorMessage: (conn: Deno.PointerObject) => Deno.PointerValue
	PQescapeIdentifier: (
		conn: Deno.PointerObject,
		str: BufferSource,
		len: bigint,
	) => Deno.PointerValue
	PQescapeLiteral: (
		conn: Deno.PointerObject,
		str: BufferSource,
		len: bigint,
	) => Deno.PointerValue
	PQexec: (
		conn: Deno.PointerObject,
		query: BufferSource,
	) => Deno.PointerValue
	PQexecAsync: (
		conn: Deno.PointerObject,
		query: BufferSource,
	) => Promise<Deno.PointerValue>
	PQexecParams: (
		conn: Deno.PointerObject,
		command: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => Deno.PointerValue
	PQexecParamsAsync: (
		conn: Deno.PointerObject,
		command: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => Promise<Deno.PointerValue>
	PQexecPrepared: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		nParams: number,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => Deno.PointerValue
	PQexecPreparedAsync: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		nParams: number,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => Promise<Deno.PointerValue>
	PQfformat: (res: Deno.PointerObject, field_num: number) => number
	PQfinish: (conn: Deno.PointerObject) => void
	PQfinishAsync: (conn: Deno.PointerObject) => Promise<void>
	PQflush: (conn: Deno.PointerObject) => number
	PQfmod: (res: Deno.PointerObject, field_num: number) => number
	PQfname: (
		res: Deno.PointerObject,
		field_num: number,
	) => Deno.PointerValue
	PQfnumber: (
		res: Deno.PointerObject,
		field_name: BufferSource,
	) => number
	PQfreeCancel: (cancel: Deno.PointerObject) => void
	PQfreemem: (ptr: Deno.PointerValue) => void
	PQunescapeBytea: (
		strtext: BufferSource,
		retbuflen: Deno.PointerValue,
	) => Deno.PointerValue
	PQfsize: (res: Deno.PointerObject, field_num: number) => number
	PQftable: (res: Deno.PointerObject, field_num: number) => number
	PQftablecol: (
		res: Deno.PointerObject,
		field_num: number,
	) => number
	PQftype: (res: Deno.PointerObject, field_num: number) => number
	PQgetCancel: (conn: Deno.PointerObject) => Deno.PointerValue
	PQgetisnull: (
		res: Deno.PointerObject,
		tup_num: number,
		field_num: number,
	) => number
	PQgetlength: (
		res: Deno.PointerObject,
		tup_num: number,
		field_num: number,
	) => number
	PQgetResult: (conn: Deno.PointerObject) => Deno.PointerValue
	PQgetvalue: (
		res: Deno.PointerObject,
		tup_num: number,
		field_num: number,
	) => Deno.PointerValue
	PQhost: (conn: Deno.PointerObject) => Deno.PointerValue
	PQisBusy: (conn: Deno.PointerObject) => number
	PQisnonblocking: (conn: Deno.PointerObject) => number
	PQnfields: (res: Deno.PointerObject) => number
	PQnparams: (res: Deno.PointerObject) => number
	PQnotifies: (conn: Deno.PointerObject) => Deno.PointerValue
	PQoidValue: (res: Deno.PointerObject) => number
	PQoptions: (conn: Deno.PointerObject) => Deno.PointerValue
	PQparameterStatus: (
		conn: Deno.PointerObject,
		paramName: BufferSource,
	) => Deno.PointerValue
	PQparamtype: (
		res: Deno.PointerObject,
		param_num: number,
	) => number
	PQntuples: (res: Deno.PointerObject) => number
	PQprepare: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		query: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
	) => Deno.PointerValue
	PQprepareAsync: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		query: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
	) => Promise<Deno.PointerValue>
	PQprotocolVersion: (conn: Deno.PointerObject) => number
	PQresetPoll: (conn: Deno.PointerObject) => number
	PQresetStart: (conn: Deno.PointerObject) => number
	PQresStatus: (status: number) => Deno.PointerValue
	PQresultErrorMessage: (
		res: Deno.PointerObject,
	) => Deno.PointerValue
	PQresultErrorField: (
		res: Deno.PointerObject,
		fieldcode: number,
	) => Deno.PointerValue
	PQresultStatus: (res: Deno.PointerObject) => number
	PQresultVerboseErrorMessage: (
		res: Deno.PointerObject,
		verbosity: number,
		show_context: number,
	) => Deno.PointerValue
	PQsendPrepare: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		query: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
	) => number
	PQsendQuery: (
		conn: Deno.PointerObject,
		query: BufferSource,
	) => number
	PQsendQueryParams: (
		conn: Deno.PointerObject,
		command: BufferSource,
		nParams: number,
		paramTypes: Deno.PointerValue,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => number
	PQsendQueryPrepared: (
		conn: Deno.PointerObject,
		stmtName: BufferSource,
		nParams: number,
		paramValues: BufferSource | null,
		paramLengths: Deno.PointerValue,
		paramFormats: Deno.PointerValue,
		resultFormat: number,
	) => number
	PQserverVersion: (conn: Deno.PointerObject) => number
	PQsetnonblocking: (
		conn: Deno.PointerObject,
		arg: number,
	) => number
	PQsocket: (conn: Deno.PointerObject) => number
	PQsocketPollAsync: (
		sock: number,
		forRead: number,
		forWrite: number,
		endTime: bigint,
	) => Promise<number>
	PQgetCurrentTimeUSec: () => bigint
	PQstatus: (conn: Deno.PointerObject) => number
	PQtransactionStatus: (conn: Deno.PointerObject) => number
	PQuser: (conn: Deno.PointerObject) => Deno.PointerValue
	PQping: (conninfo: BufferSource) => number
	PQport: (conn: Deno.PointerObject) => Deno.PointerValue
	PQreset: (conn: Deno.PointerObject) => void
	PQresetAsync: (conn: Deno.PointerObject) => Promise<void>
}

export const symbols = {
	PQbackendPID: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'i32', // int
	},
	PQbinaryTuples: {
		parameters: ['pointer'], // const PGresult *res
		result: 'i32', // int
	},
	PQcancel: {
		parameters: [
			'pointer', // PGcancel *cancel
			'buffer', // char *errbuf
			'i32', // int errbufsize
		],
		result: 'i32', // int
	},
	PQclear: {
		parameters: ['pointer'], // const PGresult *res
		result: 'void',
	},
	PQcmdStatus: {
		parameters: [
			'pointer', // PGresult *res
		],
		result: 'buffer', // char *
	},
	PQcmdTuples: {
		parameters: ['pointer'], // const PGresult *res
		result: 'buffer', // char *
	},
	PQconnectdb: {
		parameters: [
			'buffer', // const char *conninfo
		],
		result: 'pointer', // PGconn *
	},
	PQconnectdbAsync: {
		parameters: [
			'buffer', // const char *conninfo
		],
		result: 'pointer', // PGconn *
		name: 'PQconnectdb',
		nonblocking: true,
	},
	PQconnectPoll: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // PostgresPollingStatusType
	},
	PQconnectStart: {
		parameters: [
			'buffer', // const char *conninfo
		],
		result: 'pointer', // PGconn *
	},
	PQconninfo: {
		parameters: ['pointer'], // PGconn *conn
		result: 'pointer', // PQconninfoOption *
	},
	PQconninfoFree: {
		parameters: ['pointer'], // PQconninfoOption *connOptions
		result: 'void',
	},
	PQconsumeInput: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQdb: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'buffer', // char *
	},
	PQdescribePrepared: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmt
		],
		result: 'pointer', // PGresult *
	},
	PQerrorMessage: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'buffer', // char *
	},
	PQescapeIdentifier: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *str
			'usize', // size_t len
		],
		result: 'pointer', // char * (must be freed with PQfreemem)
	},
	PQescapeLiteral: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *str
			'usize', // size_t len
		],
		result: 'pointer', // char * (must be freed with PQfreemem)
	},
	PQexec: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *query
		],
		result: 'pointer', /// PGresult *
	},
	PQexecAsync: {
		name: 'PQexec',
		nonblocking: true,
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *query
		],
		result: 'pointer', // PGresult *
	},
	PQexecParams: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *command
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats
			'i32', // int resultFormat
		],
		result: 'pointer', // PGresult *
	},
	PQexecParamsAsync: {
		name: 'PQexecParams',
		nonblocking: true,
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *command
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats
			'i32', // int resultFormat
		],
		result: 'pointer', // PGresult *
	},
	PQexecPrepared: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'i32', // int nParams
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats,
			'i32', //int resultFormat
		],
		result: 'pointer', // PGresult *
	},
	PQexecPreparedAsync: {
		name: 'PQexecPrepared',
		nonblocking: true,
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'i32', // int nParams
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats,
			'i32', //int resultFormat
		],
		result: 'pointer', // PGresult *
	},
	PQfformat: {
		parameters: [
			'pointer', // PGresult *res
			'i32', // int field_num
		],
		result: 'i32', // int
	},
	PQfinish: { parameters: ['pointer'], result: 'void' },
	PQfinishAsync: {
		name: 'PQfinish',
		result: 'void',
		nonblocking: true,
		parameters: [
			'pointer',
		],
	},
	PQflush: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQfmod: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int field_num
		],
		result: 'i32', // int
	},
	PQfname: {
		parameters: [
			'pointer', // PGresult *res
			'i32', // int field_num
		],
		result: 'buffer', // char *
	},
	PQfnumber: { parameters: ['pointer', 'buffer'], result: 'i32' },
	PQfreeCancel: {
		parameters: ['pointer'], // PGcancel *cancel
		result: 'void',
	},
	PQunescapeBytea: {
		parameters: ['buffer', 'pointer'], // const unsigned char *strtext, size_t *retbuflen
		result: 'pointer', // unsigned char * (must be freed with PQfreemem)
	},
	PQfreemem: {
		parameters: ['pointer'], // void *ptr
		result: 'void',
	},
	PQfsize: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int field_num
		],
		result: 'i32', // int
	},
	PQftable: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int field_num
		],
		result: 'u32', // Oid
	},
	PQftablecol: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int field_num
		],
		result: 'i32', // int
	},
	PQftype: {
		parameters: [
			'pointer', // PGresult *res
			'i32', // int field_num
		],
		result: 'u32', // Oid
	},
	PQgetCancel: {
		parameters: ['pointer'], // PGconn *conn
		result: 'pointer', // PGcancel *
	},
	PQgetisnull: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
	PQgetlength: { parameters: ['pointer', 'i32', 'i32'], result: 'i32' },
	PQgetResult: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'pointer', // PGresult *
	},
	PQgetvalue: { parameters: ['pointer', 'i32', 'i32'], result: 'buffer' },
	PQhost: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'buffer', // char *
	},
	PQisBusy: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQisnonblocking: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQnfields: { parameters: ['pointer'], result: 'i32' },
	PQnparams: {
		parameters: ['pointer'], // const PGresult *res
		result: 'i32', // int
	},
	PQnotifies: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'pointer', // PGnotify *
	},
	PQoidValue: {
		parameters: ['pointer'], // const PGresult *res
		result: 'u32', // Oid
	},
	PQoptions: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'buffer', // char *
	},
	PQparameterStatus: {
		parameters: [
			'pointer', // const PGconn *conn
			'buffer', // const char *paramName
		],
		result: 'buffer', // const char *
	},
	PQparamtype: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int param_num
		],
		result: 'u32', // Oid
	},
	PQntuples: { parameters: ['pointer'], result: 'i32' },
	PQprepare: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'buffer', // const char *query
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
		],
		result: 'pointer', // PGresult *
	},
	PQprepareAsync: {
		name: 'PQprepare',
		nonblocking: true,
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'buffer', // const char *query
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
		],
		result: 'pointer', // PGresult *
	},
	PQprotocolVersion: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'i32', // int
	},
	PQresetPoll: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // PostgresPollingStatusType
	},
	PQresetStart: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQresStatus: { parameters: ['i32'], result: 'buffer' },
	PQresultErrorMessage: {
		parameters: [
			'pointer', // PGresult *res
		],
		result: 'buffer', // char *
	},
	PQresultErrorField: {
		parameters: [
			'pointer', // const PGresult *res
			'i32', // int fieldcode
		],
		result: 'buffer', // char *
	},
	PQresultStatus: { parameters: ['pointer'], result: 'i32' },
	PQresultVerboseErrorMessage: {
		parameters: [
			'pointer', // PGresult *res
			'i32', // int verbosity
			'i32', // int show_context
		],
		result: 'buffer', // char *
	},
	PQsendPrepare: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'buffer', // const char *query
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
		],
		result: 'i32', // int
	},
	PQsendQuery: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *query
		],
		result: 'i32', // int
	},
	PQsendQueryParams: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *command
			'i32', // int nParams
			'pointer', // const Oid *paramTypes
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats
			'i32', // int resultFormat
		],
		result: 'i32', // int
	},
	PQsendQueryPrepared: {
		parameters: [
			'pointer', // PGconn *conn
			'buffer', // const char *stmtName
			'i32', // int nParams
			'buffer', // const char *const *paramValues
			'pointer', // const int *paramLengths
			'pointer', // const int *paramFormats
			'i32', // int resultFormat
		],
		result: 'i32', // int
	},
	PQserverVersion: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'i32', // int
	},
	PQsetnonblocking: {
		parameters: [
			'pointer', // PGconn *conn
			'i32', // int arg
		],
		result: 'i32', // int
	},
	PQsocket: {
		parameters: ['pointer'], // PGconn *conn
		result: 'i32', // int
	},
	PQsocketPollAsync: {
		name: 'PQsocketPoll',
		nonblocking: true,
		parameters: [
			'i32', // int sock
			'i32', // int forRead
			'i32', // int forWrite
			'i64', // pg_usec_time_t end_time
		],
		result: 'i32', // int
	},
	PQgetCurrentTimeUSec: {
		parameters: [],
		result: 'i64', // pg_usec_time_t
	},
	PQstatus: { parameters: ['pointer'], result: 'i32' },
	PQtransactionStatus: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'i32', // PGTransactionStatusType
	},
	PQuser: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'buffer', // char *
	},
	PQping: {
		parameters: [
			'buffer', // const char *conninfo
		],
		result: 'i32', // PGPing (enum value)
	},
	PQport: {
		parameters: ['pointer'], // const PGconn *conn
		result: 'buffer', // char *
	},
	PQreset: {
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'void',
	},
	PQresetAsync: {
		name: 'PQreset',
		nonblocking: true,
		parameters: [
			'pointer', // PGconn *conn
		],
		result: 'void',
	},
} as const satisfies Deno.ForeignLibraryInterface
