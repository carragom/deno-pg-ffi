import { assertEquals, assertThrows } from '@std/assert'
import { parseArrayText } from './array_text.ts'

Deno.test('parseArrayText reads nested text and a dimension prefix', () => {
	assertEquals(parseArrayText('{}'), [])
	assertEquals(parseArrayText('{1,NULL,3}'), ['1', null, '3'])
	assertEquals(parseArrayText('{"NULL",""}'), ['NULL', ''])
	assertEquals(parseArrayText('[0:1]={1,2}'), ['1', '2'])
	assertEquals(parseArrayText('{{1,2},{3,4}}'), [
		['1', '2'],
		['3', '4'],
	])
	assertEquals(parseArrayText('{"a\\"b"}'), ['a"b'])
	assertEquals(parseArrayText('{"\\\\x0102ff"}'), ['\\x0102ff'])
})

Deno.test('parseArrayText rejects a malformed literal', () => {
	assertThrows(
		() => parseArrayText('{1,'),
		TypeError,
		'Malformed array literal',
	)
	assertThrows(() => parseArrayText('{1,}'), TypeError)
	assertThrows(() => parseArrayText('nope'), TypeError)
})

Deno.test('parseArrayText honors semicolons at every rank', () => {
	const first = '(3,4),(1,2)'
	const second = '(7,8),(5,6)'
	assertEquals(parseArrayText(`{${first};${second}}`, ';'), [first, second])
	assertEquals(parseArrayText('{}', ';'), [])
	assertEquals(parseArrayText(`{${first};NULL}`, ';'), [first, null])
	assertEquals(
		parseArrayText(`[0:1][2:3]={{${first};NULL};{${second};${first}}}`, ';'),
		[[first, null], [second, first]],
	)
})

Deno.test('parseArrayText preserves quoted and escaped custom delimiters', () => {
	assertEquals(
		parseArrayText(
			String.raw`{"a;b,c";a\;b;"a\"b";"a\\b";"NULL";NULL;""}`,
			';',
		),
		['a;b,c', 'a;b', 'a"b', 'a\\b', 'NULL', null, ''],
	)
	assertEquals(parseArrayText('{a,b|c,d}', '|'), ['a,b', 'c,d'])
	assertEquals(parseArrayText('{a;b,c;d}'), ['a;b', 'c;d'])
})

Deno.test('parseArrayText rejects malformed semicolon arrays and invalid delimiters', () => {
	for (const text of ['{;a}', '{a;}', '{a;;b}', '{"a"b}', '{a;', '{{a};}']) {
		assertThrows(
			() => parseArrayText(text, ';'),
			TypeError,
			'Malformed array literal',
		)
	}
	for (
		const delimiter of [
			'',
			';;',
			'{',
			'}',
			'"',
			'\\',
			' ',
			'\t',
			'\0',
			'\x7f',
			'é',
		]
	) {
		assertThrows(
			() => parseArrayText('{}', delimiter),
			TypeError,
			'Invalid array delimiter',
		)
	}
})
