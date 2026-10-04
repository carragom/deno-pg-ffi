/** Owned results and lazy row materialization. @module */
import {
	clear,
	cmdStatus,
	cmdTuples,
	fname,
	ftype,
	getisnull,
	getvalue,
	nfields,
	ntuples,
} from '../native/wrappers.ts'
import type { PGresult } from '../native/types.ts'
import type { TypeRegistry } from '../codecs/registry.ts'

/** Column metadata on {@linkcode Result.fields}. */
export interface Field {
	/** Column name from `PQfname`. */
	name: string
	/** Type OID from `PQftype`. */
	dataTypeID: number
}

// PQcmdTuples also counts SELECT. Filter the server's CommandComplete verb,
// not the submitted SQL (which might start with WITH or include RETURNING).
const DML_COMMANDS = new Set([
	'INSERT',
	'UPDATE',
	'DELETE',
	'COPY',
	'MERGE',
])

const resultRegistry = new FinalizationRegistry<PGresult>((res) => {
	try {
		clear(res)
	} catch {
		// Best-effort fallback. Explicit disposal unregisters this finalizer;
		// catching JavaScript errors cannot recover from a native double clear.
	}
})

function deserializeCell(
	res: PGresult,
	row: number,
	col: number,
	types: TypeRegistry,
): unknown {
	if (getisnull(res, row, col)) {
		return null
	}
	const text = getvalue(res, row, col)
	if (typeof text !== 'string') {
		throw new TypeError('Expected a text field value')
	}
	return types.deserialize(ftype(res, col), text)
}

function materializeRow<T>(
	res: PGresult,
	row: number,
	types: TypeRegistry,
): T {
	const object: Record<string, unknown> = {}
	const cols = nfields(res)
	for (let col = 0; col < cols; col++) {
		object[fname(res, col)] = deserializeCell(res, row, col, types)
	}
	return object as T
}

function commandFromTag(tag: string): string {
	const space = tag.indexOf(' ')
	return space === -1 ? tag : tag.slice(0, space)
}

function rowCountFromTag(tag: string): number | undefined {
	const parts = tag.trim().split(' ')
	const last = parts[parts.length - 1]
	if (last === undefined) {
		return undefined
	}
	const count = Number.parseInt(last, 10)
	return Number.isNaN(count) ? undefined : count
}

/**
 * Indexed, iterable rows on a {@linkcode Result}; this is not a JavaScript Array.
 * Reading an index materializes and caches that row as a plain object. Duplicate
 * column names overwrite earlier values; use distinct SQL aliases.
 * `T` describes the expected shape without runtime validation.
 *
 * {@linkcode Rows.at} and valid row-index accessors check disposal before reading
 * even a cached row. The length is a snapshot. Previously materialized objects
 * remain usable after disposal; `[...result.rows]` materializes all rows for use
 * outside the result's lifetime. Result conversion failures happen on first row access.
 *
 * @example
 * ```ts
 * import { Client } from '@carragom/deno-pg-ffi'
 *
 * await using db = await Client.connect()
 * await using r = await db.query<{ n: number }>(
 * 	'SELECT 1::int4 AS n UNION ALL SELECT 2::int4',
 * )
 * if (r.rows[0].n !== 1 || r.rows.at(-1)?.n !== 2) {
 * 	throw new Error('unexpected rows')
 * }
 * ```
 */
export interface Rows<T> extends Iterable<T> {
	/** Number of rows in the native result. */
	readonly length: number
	/** Materialize and cache a zero-based row; an existing index throws after disposal. */
	[index: number]: T
	/**
	 * Read a row, or undefined outside the result. Negative indices count from
	 * the end. Throws after disposal, including for rows already cached.
	 */
	at(index: number): T | undefined
	/** Iterate lazily, checking disposal when each row is read. */
	[Symbol.iterator](): Iterator<T>
}

/** @internal Implementation of the public row-list contract. */
class ResultRows<T> implements Rows<T> {
	readonly length: number
	#cache: Array<T | undefined>
	#read: (index: number) => T
	#alive: () => boolean

	constructor(
		length: number,
		read: (index: number) => T,
		alive: () => boolean,
	) {
		this.length = length
		this.#cache = Array.from({ length }, () => undefined)
		this.#read = read
		this.#alive = alive

		for (let i = 0; i < length; i++) {
			Object.defineProperty(this, i, {
				enumerable: true,
				configurable: false,
				get: () => this.at(i),
			})
		}
	}

	[index: number]: T

	/**
	 * Row at `index`, or `undefined` if out of range. Negative indexes count
	 * from the end, like {@linkcode https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at | Array.prototype.at}.
	 */
	at(index: number): T | undefined {
		// Cached row access still belongs to the result lifetime. The copied
		// object can survive disposal, but this accessor must not return it then.
		if (!this.#alive()) {
			throw new Error('Result has been disposed')
		}
		const i = index < 0 ? this.length + index : index
		if (i < 0 || i >= this.length) {
			return undefined
		}
		const cached = this.#cache[i]
		if (cached !== undefined) {
			return cached
		}
		const row = this.#read(i)
		this.#cache[i] = row
		return row
	}

	*[Symbol.iterator](): Iterator<T> {
		for (let i = 0; i < this.length; i++) {
			yield this.at(i) as T
		}
	}
}

/**
 * Independently owned statement result from query or prepared execution.
 * Dispose with `using`, `await using`, or {@linkcode Result.close}; closing the
 * client or releasing its pool checkout does not dispose this result.
 *
 * Commands buffer the full native result before returning. JavaScript row
 * decoding is lazy and can throw while indexing or iterating {@linkcode Result.rows}.
 * Dispose the result even when decoding fails; the connection remains usable.
 * Materialized row objects and copied metadata survive result disposal.
 * The generic `T` is a TypeScript contract, not runtime validation.
 *
 * @example
 * ```ts
 * import { Client } from '@carragom/deno-pg-ffi'
 *
 * await using db = await Client.connect()
 * await using r = await db.query('SELECT 1::int4 AS n')
 * await db.close() // The result is independent of the connection.
 * const row = r.rows[0]
 * r.close() // Subsequent reads through r.rows throw; row remains usable.
 * if (r.command !== 'SELECT' || row.n !== 1) {
 * 	throw new Error('unexpected result')
 * }
 * ```
 */
export class Result<T = Record<string, unknown>> implements Disposable {
	/** Lazy, cached rows; read them before disposal or materialize a copy. */
	readonly rows: Rows<T>
	/** Column names and PostgreSQL type OIDs in result order. */
	readonly fields: Field[]
	/** Server command-tag verb, such as SELECT or UPDATE. */
	readonly command: string
	/** Command-tag count, including SELECT; undefined for tags without a count. Use rows.length for returned rows. */
	readonly rowCount: number | undefined
	/** Rows written by INSERT, UPDATE, DELETE, COPY, or MERGE; zero for other commands. */
	readonly affectedRows: number
	#res: PGresult
	#types: TypeRegistry
	#cleared = false
	#token: object = {}

	/** @internal Take ownership of a native text result using the supplied registry. */
	constructor(res: PGresult, types: TypeRegistry) {
		this.#res = res
		this.#types = types
		resultRegistry.register(this, res, this.#token)

		const tag = cmdStatus(res)
		this.command = commandFromTag(tag)
		this.rowCount = rowCountFromTag(tag)
		const tuples = cmdTuples(res)
		this.affectedRows = DML_COMMANDS.has(this.command) && tuples >= 0
			? tuples
			: 0

		const fieldCount = nfields(res)
		const fields: Field[] = []
		for (let i = 0; i < fieldCount; i++) {
			fields.push({ name: fname(res, i), dataTypeID: ftype(res, i) })
		}
		this.fields = fields

		this.rows = new ResultRows<T>(
			ntuples(res),
			(index) => materializeRow<T>(this.#requireRes(), index, this.#types),
			() => !this.#cleared,
		)
	}

	#requireRes(): PGresult {
		if (this.#cleared) {
			throw new Error('Result has been disposed')
		}
		return this.#res
	}

	/** Clear the native `PGresult`. Safe to call more than once. */
	close(): void {
		this[Symbol.dispose]()
	}

	/** Dispose this resource synchronously; repeated disposal is safe. */
	[Symbol.dispose](): void {
		if (this.#cleared) {
			return
		}
		this.#cleared = true
		resultRegistry.unregister(this.#token)
		clear(this.#res)
	}
}

/**
 * Disposable list of {@linkcode Result} from {@linkcode Client.exec} /
 * {@linkcode PoolClient.exec} / {@linkcode Pool.exec}, in server statement order.
 * Closing the batch disposes every inner result; closing an inner result first
 * is safe. The batch's length is a snapshot, but `at()` and valid index accessors
 * throw after batch disposal. This list is iterable and indexed, not an Array.
 *
 * @example
 * ```ts
 * import { Client } from '@carragom/deno-pg-ffi'
 *
 * await using db = await Client.connect()
 * await using results = await db.exec('SELECT 1::int4 AS n; SELECT 2::int4 AS n')
 * if (results.length !== 2 || results[1].rows[0].n !== 2) {
 * 	throw new Error('expected two results')
 * }
 * ```
 */
export class Results implements Iterable<Result>, Disposable {
	/** Number of statement results in this batch. */
	readonly length: number
	#items: Result[]
	#disposed = false

	/** @internal Take ownership of the supplied results. */
	constructor(items: Result[]) {
		this.#items = items
		this.length = items.length
		for (let i = 0; i < items.length; i++) {
			Object.defineProperty(this, i, {
				enumerable: true,
				configurable: false,
				get: () => this.at(i),
			})
		}
	}

	/** Access a statement result by zero-based index; throws after batch disposal. */
	[index: number]: Result

	/**
	 * Result at `index`, or `undefined` if out of range. Negative indexes count
	 * from the end, like {@linkcode https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at | Array.prototype.at}. Throws after batch disposal.
	 */
	at(index: number): Result | undefined {
		if (this.#disposed) {
			throw new Error('Result batch has been disposed')
		}
		const i = index < 0 ? this.length + index : index
		if (i < 0 || i >= this.length) {
			return undefined
		}
		return this.#items[i]
	}

	/** Iterate in server order, checking batch disposal when each result is read. */
	*[Symbol.iterator](): Iterator<Result> {
		for (let i = 0; i < this.length; i++) {
			yield this.at(i) as Result
		}
	}

	/** Clear every inner `PGresult`. */
	close(): void {
		this[Symbol.dispose]()
	}

	/** Dispose this resource synchronously; repeated disposal is safe. */
	[Symbol.dispose](): void {
		if (this.#disposed) {
			return
		}
		this.#disposed = true
		for (const item of this.#items) {
			item.close()
		}
	}
}
