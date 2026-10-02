/**
 * OID maps for receiving values over the text protocol.
 *
 * Built-in maps are module-level and never mutated. Each {@linkcode TypeRegistry}
 * holds an override layer on top of those defaults.
 *
 * @module
 */

import {
	type ArrayText,
	parseArrayText,
	validateArrayDelimiter,
} from './array_text.ts'
import { unescapeBytea } from '../native/wrappers.ts'

/**
 * Convert one non-NULL PostgreSQL text value to a JavaScript value.
 * Passed to Client.registerScalar or Pool.registerScalar. Matching array leaves
 * use the same function; SQL NULL remains null without calling it.
 * @param text Server text for the registered scalar type.
 * @returns The value to expose in a materialized row.
 */
export type Deserialize = (text: string) => unknown

const OID_BOOL = 16
const OID_BYTEA = 17
const OID_NAME = 19
const OID_INT8 = 20
const OID_INT2 = 21
const OID_INT4 = 23
const OID_TEXT = 25
const OID_JSON = 114
const OID_FLOAT4 = 700
const OID_FLOAT8 = 701
const OID_BPCHAR = 1042
const OID_VARCHAR = 1043
const OID_DATE = 1082
const OID_TIME = 1083
const OID_TIMESTAMP = 1114
const OID_TIMESTAMPTZ = 1184
const OID_INTERVAL = 1186
const OID_NUMERIC = 1700
const OID_JSONB = 3802

function deserializeNumber(text: string): number {
	return Number(text)
}

function deserializeBigint(text: string): bigint {
	return BigInt(text)
}

function deserializeBoolean(text: string): boolean {
	return text === 't' || text === 'true'
}

function deserializeBytea(text: string): Uint8Array {
	if (!text.startsWith('\\x') && !text.startsWith('\\X')) {
		return unescapeBytea(text)
	}
	const body = text.slice(2)
	if (body.length % 2 !== 0) {
		throw new TypeError(`Invalid bytea text: ${text}`)
	}
	const bytes = new Uint8Array(body.length / 2)
	for (let i = 0; i < bytes.length; i++) {
		const pair = body.slice(i * 2, i * 2 + 2)
		if (!/^[0-9a-f]{2}$/i.test(pair)) {
			throw new TypeError(`Invalid bytea text: ${text}`)
		}
		bytes[i] = Number.parseInt(pair, 16)
	}
	return bytes
}

function deserializePlainDate(text: string): Temporal.PlainDate {
	return Temporal.PlainDate.from(text.trim())
}

function deserializePlainDateTime(text: string): Temporal.PlainDateTime {
	return Temporal.PlainDateTime.from(text.trim().replace(' ', 'T'))
}

/** Decode time text without normalizing the end-of-day value. */
function deserializePlainTime(text: string): Temporal.PlainTime {
	try {
		return Temporal.PlainTime.from(text.trim())
	} catch (cause) {
		throw new RangeError(
			`Cannot decode PostgreSQL time ${
				JSON.stringify(text)
			} as Temporal.PlainTime`,
			{ cause },
		)
	}
}

// PostgreSQL emits independently signed components, not Temporal's leading
// duration sign. Months and days must stay separate from elapsed time.
const ISO_INTERVAL =
	/^P(?:(-?\d+)Y)?(?:(-?\d+)M)?(?:(-?\d+)D)?(?:T(?:(-?\d+)H)?(?:(-?\d+)M)?(?:(-?\d+)(?:\.(\d{1,6}))?S)?)?$/

/** Decode PostgreSQL IntervalStyle=iso_8601 text. */
function deserializeDuration(text: string): Temporal.Duration {
	try {
		const iso = text.trim()
		if (iso === 'infinity' || iso === '-infinity') {
			throw new RangeError('Temporal.Duration cannot represent infinity')
		}
		const parts = ISO_INTERVAL.exec(iso)
		if (
			parts === null || parts.slice(1, 7).every((part) =>
				part === undefined
			) ||
			(iso.includes('T') &&
				parts.slice(4, 7).every((part) => part === undefined))
		) {
			throw new RangeError('Expected PostgreSQL iso_8601 interval text')
		}
		const fields = parts.slice(1, 7).map((part) => Number(part ?? 0))
		if (!fields.every(Number.isSafeInteger)) {
			throw new RangeError(
				'Interval component exceeds the safe integer range',
			)
		}
		const [years, months, days, hours, minutes, seconds] = fields
		const fraction = (parts[7] ?? '').padEnd(6, '0')
		// Number('-0') loses the token's sign for comparisons; -0.x seconds still
		// require negative millisecond/microsecond components.
		const sign = parts[6]?.startsWith('-') ? -1 : 1
		return Temporal.Duration.from({
			years,
			months,
			days,
			hours,
			minutes,
			seconds,
			milliseconds: sign * Number(fraction.slice(0, 3)),
			microseconds: sign * Number(fraction.slice(3)),
		})
	} catch (cause) {
		throw new RangeError(
			`Cannot decode PostgreSQL interval ${
				JSON.stringify(text)
			} as Temporal.Duration`,
			{ cause },
		)
	}
}

function deserializeJson(text: string): unknown {
	return JSON.parse(text)
}

function deserializeInstant(text: string): Temporal.Instant {
	let iso = text.trim().replace(' ', 'T')
	iso = iso.replace(/([+-])(\d{2})$/, '$1$2:00')
	if (iso.endsWith('Z')) {
		iso = `${iso.slice(0, -1)}+00:00`
	}
	return Temporal.Instant.from(iso)
}

const identity = (text: string): string => text

/** Built-in scalar OID → deserializer. Never mutated. */
const BUILTIN_SCALARS: ReadonlyMap<number, Deserialize> = new Map([
	[OID_BOOL, deserializeBoolean],
	[OID_BYTEA, deserializeBytea],
	[OID_NAME, identity],
	[OID_INT8, deserializeBigint],
	[OID_INT2, deserializeNumber],
	[OID_INT4, deserializeNumber],
	[OID_TEXT, identity],
	[OID_JSON, deserializeJson],
	[OID_FLOAT4, deserializeNumber],
	[OID_FLOAT8, deserializeNumber],
	[OID_BPCHAR, identity],
	[OID_VARCHAR, identity],
	[OID_DATE, deserializePlainDate],
	[OID_TIMESTAMP, deserializePlainDateTime],
	[OID_TIMESTAMPTZ, deserializeInstant],
	[OID_NUMERIC, identity],
	[OID_JSONB, deserializeJson],
])

interface ArrayType {
	readonly elementOid: number | null
	readonly delimiter: string
}

function arrayType(elementOid: number | null, delimiter = ','): ArrayType {
	return { elementOid, delimiter }
}

/**
 * Built-in array OID → element OID and delimiter. `null` leaves stay text.
 * Never mutated. Excludes `anyarray` and `anycompatiblearray`.
 */
const BUILTIN_ARRAYS: ReadonlyMap<number, ArrayType> = new Map([
	[1000, arrayType(OID_BOOL)], // bool[]
	[1001, arrayType(OID_BYTEA)], // bytea[]
	[1002, arrayType(null)], // "char"[]
	[1003, arrayType(OID_NAME)], // name[]
	[1016, arrayType(OID_INT8)], // int8[]
	[1005, arrayType(OID_INT2)], // int2[]
	[1006, arrayType(null)], // int2vector[]
	[1007, arrayType(OID_INT4)], // int4[]
	[1008, arrayType(null)], // regproc[]
	[1009, arrayType(OID_TEXT)], // text[]
	[1028, arrayType(null)], // oid[]
	[1010, arrayType(null)], // tid[]
	[1011, arrayType(null)], // xid[]
	[1012, arrayType(null)], // cid[]
	[1013, arrayType(null)], // oidvector[]
	[210, arrayType(null)], // pg_type[]
	[270, arrayType(null)], // pg_attribute[]
	[272, arrayType(null)], // pg_proc[]
	[273, arrayType(null)], // pg_class[]
	[199, arrayType(OID_JSON)], // json[]
	[143, arrayType(null)], // xml[]
	[271, arrayType(null)], // xid8[]
	[1017, arrayType(null)], // point[]
	[1018, arrayType(null)], // lseg[]
	[1019, arrayType(null)], // path[]
	[1020, arrayType(null, ';')], // box[]
	[1027, arrayType(null)], // polygon[]
	[629, arrayType(null)], // line[]
	[1021, arrayType(OID_FLOAT4)], // float4[]
	[1022, arrayType(OID_FLOAT8)], // float8[]
	[719, arrayType(null)], // circle[]
	[791, arrayType(null)], // money[]
	[1040, arrayType(null)], // macaddr[]
	[1041, arrayType(null)], // inet[]
	[651, arrayType(null)], // cidr[]
	[775, arrayType(null)], // macaddr8[]
	[1034, arrayType(null)], // aclitem[]
	[1014, arrayType(OID_BPCHAR)], // bpchar[]
	[1015, arrayType(OID_VARCHAR)], // varchar[]
	[1182, arrayType(OID_DATE)], // date[]
	[1183, arrayType(null)], // time[]
	[1115, arrayType(OID_TIMESTAMP)], // timestamp[]
	[1185, arrayType(OID_TIMESTAMPTZ)], // timestamptz[]
	[1187, arrayType(null)], // interval[]
	[1270, arrayType(null)], // timetz[]
	[1561, arrayType(null)], // bit[]
	[1563, arrayType(null)], // varbit[]
	[1231, arrayType(OID_NUMERIC)], // numeric[]
	[2201, arrayType(null)], // refcursor[]
	[2207, arrayType(null)], // regprocedure[]
	[2208, arrayType(null)], // regoper[]
	[2209, arrayType(null)], // regoperator[]
	[2210, arrayType(null)], // regclass[]
	[4192, arrayType(null)], // regcollation[]
	[2211, arrayType(null)], // regtype[]
	[4097, arrayType(null)], // regrole[]
	[4090, arrayType(null)], // regnamespace[]
	[2951, arrayType(null)], // uuid[]
	[3221, arrayType(null)], // pg_lsn[]
	[3643, arrayType(null)], // tsvector[]
	[3644, arrayType(null)], // gtsvector[]
	[3645, arrayType(null)], // tsquery[]
	[3735, arrayType(null)], // regconfig[]
	[3770, arrayType(null)], // regdictionary[]
	[3807, arrayType(OID_JSONB)], // jsonb[]
	[4073, arrayType(null)], // jsonpath[]
	[2949, arrayType(null)], // txid_snapshot[]
	[5039, arrayType(null)], // pg_snapshot[]
	[3905, arrayType(null)], // int4range[]
	[3907, arrayType(null)], // numrange[]
	[3909, arrayType(null)], // tsrange[]
	[3911, arrayType(null)], // tstzrange[]
	[3913, arrayType(null)], // daterange[]
	[3927, arrayType(null)], // int8range[]
	[6150, arrayType(null)], // int4multirange[]
	[6151, arrayType(null)], // nummultirange[]
	[6152, arrayType(null)], // tsmultirange[]
	[6153, arrayType(null)], // tstzmultirange[]
	[6155, arrayType(null)], // datemultirange[]
	[6157, arrayType(null)], // int8multirange[]
	[1263, arrayType(null)], // cstring[]
	[2287, arrayType(null)], // record[]
])

/**
 * Per-client or per-pool OID maps for receiving values.
 *
 * Built-in maps are shared and never mutated. Overrides live on this object.
 */
export class TypeRegistry {
	#scalars = new Map<number, Deserialize>()
	#arrays = new Map<number, ArrayType>()

	/** @internal Seed this registry with independently enabled Temporal codecs. */
	constructor(temporalTime = false, temporalInterval = false) {
		if (temporalTime) {
			this.registerScalar(OID_TIME, deserializePlainTime)
			this.registerArray(1183, OID_TIME)
		}
		if (temporalInterval) {
			this.registerScalar(OID_INTERVAL, deserializeDuration)
			this.registerArray(1187, OID_INTERVAL)
		}
	}

	/**
	 * Register a scalar deserializer for `oid`.
	 *
	 * Replaces a previous override for the same OID. Does not change the
	 * built-in maps.
	 *
	 * @param {number} oid - Type OID from `PQftype`
	 * @param {Deserialize} deserialize - Converts field text
	 * @throws {TypeError} When `oid` is already an array OID
	 */
	registerScalar(oid: number, deserialize: Deserialize): void {
		if (this.#isArrayOid(oid)) {
			throw new TypeError(
				`OID ${oid} is already registered as an array type`,
			)
		}
		this.#scalars.set(oid, deserialize)
	}

	/**
	 * Register `arrayOid` as a Postgres array type.
	 *
	 * When `elementOid` is omitted, each leaf stays the element text. When
	 * given, every leaf uses that scalar deserializer. Replaces a previous
	 * override for the same array OID.
	 *
	 * @param {number} arrayOid - Array type OID from `PQftype`
	 * @param {number} [elementOid] - Scalar element OID. Must already have a
	 * deserializer
	 * @param {string} [delimiter] - Element delimiter. Defaults to the built-in
	 * delimiter (semicolon for `box[]`), or comma for custom array OIDs.
	 * Must be one non-whitespace ASCII character other than braces, quotes,
	 * or backslash. A custom array can use `registerArray(oid, undefined, ';')`.
	 * @throws {TypeError} When `arrayOid` is already a scalar OID,
	 * `elementOid` has no deserializer, or `delimiter` is invalid
	 */
	registerArray(
		arrayOid: number,
		elementOid?: number,
		delimiter?: string,
	): void {
		if (this.#isScalarOid(arrayOid)) {
			throw new TypeError(
				`OID ${arrayOid} is already registered as a scalar type`,
			)
		}
		if (elementOid !== undefined && !this.#isScalarOid(elementOid)) {
			throw new TypeError(
				`Element OID ${elementOid} has no scalar deserializer`,
			)
		}
		const separator = delimiter ?? BUILTIN_ARRAYS.get(arrayOid)?.delimiter ??
			','
		validateArrayDelimiter(separator)
		this.#arrays.set(arrayOid, arrayType(elementOid ?? null, separator))
	}

	/**
	 * Convert field text for `oid`.
	 *
	 * Array OIDs are checked first. A miss in both maps returns `text`.
	 */
	deserialize(oid: number, text: string): unknown {
		const type = this.#arrayType(oid)
		if (type !== undefined) {
			const { elementOid, delimiter } = type
			return mapArrayText(parseArrayText(text, delimiter), (leaf) => {
				if (elementOid === null) {
					return leaf
				}
				return this.#scalar(elementOid, leaf)
			})
		}
		return this.#scalar(oid, text)
	}

	#scalar(oid: number, text: string): unknown {
		const custom = this.#scalars.get(oid)
		if (custom !== undefined) {
			return custom(text)
		}
		const builtin = BUILTIN_SCALARS.get(oid)
		return builtin === undefined ? text : builtin(text)
	}

	/** Metadata when `oid` is an array, else `undefined`. */
	#arrayType(oid: number): ArrayType | undefined {
		if (this.#arrays.has(oid)) {
			return this.#arrays.get(oid)!
		}
		if (BUILTIN_ARRAYS.has(oid)) {
			return BUILTIN_ARRAYS.get(oid)!
		}
		return undefined
	}

	#isScalarOid(oid: number): boolean {
		return this.#scalars.has(oid) || BUILTIN_SCALARS.has(oid)
	}

	#isArrayOid(oid: number): boolean {
		return this.#arrays.has(oid) || BUILTIN_ARRAYS.has(oid)
	}
}

function mapArrayText(
	node: ArrayText,
	deserialize: (text: string) => unknown,
): unknown[] {
	const values: unknown[] = []
	for (const element of node) {
		if (element === null) {
			values.push(null)
		} else if (typeof element === 'string') {
			values.push(deserialize(element))
		} else {
			values.push(mapArrayText(element, deserialize))
		}
	}
	return values
}
