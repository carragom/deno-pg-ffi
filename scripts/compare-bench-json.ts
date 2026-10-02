#! /usr/bin/env -S deno run --allow-read

// deno-lint-ignore-file no-console

const THRESHOLD = 1.2

interface BenchOk {
	avg: number
}

interface BenchCase {
	name: string
	results: Array<{ ok?: BenchOk }>
}

interface BenchFile {
	benches: BenchCase[]
}

if (import.meta.main) {
	const [mainPath, prPath] = Deno.args
	if (mainPath === undefined || prPath === undefined) {
		console.error(
			'Usage: compare-bench-json.ts <main.json> <pr.json>',
		)
		Deno.exit(2)
	}
	const failed = compare(await readBench(mainPath), await readBench(prPath))
	Deno.exit(failed ? 1 : 0)
}

export function compare(mainFile: BenchFile, prFile: BenchFile): boolean {
	const mainAvgs = avgsByName(mainFile)
	const prAvgs = avgsByName(prFile)
	const names = [...mainAvgs.keys()]

	if (names.length === 0) {
		console.error('No benchmark names on the base run to compare')
		return true
	}

	let failed = false
	for (const name of names) {
		const mainAvg = mainAvgs.get(name)!
		const prAvg = prAvgs.get(name)
		if (prAvg === undefined) {
			console.error(`MISSING ${name} on PR`)
			failed = true
			continue
		}
		if (mainAvg <= 0) {
			console.error(`INVALID ${name}: base avg is ${mainAvg}`)
			failed = true
			continue
		}
		const ratio = prAvg / mainAvg
		const line = `${name}: main ${fmt(mainAvg)} → pr ${fmt(prAvg)} (${
			ratio.toFixed(2)
		}x)`
		if (ratio > THRESHOLD) {
			console.error(`REGRESSION ${line}`)
			failed = true
		} else {
			console.log(line)
		}
	}
	return failed
}

function avgsByName(file: BenchFile): Map<string, number> {
	const map = new Map<string, number>()
	for (const bench of file.benches) {
		const avg = bench.results[0]?.ok?.avg
		if (avg !== undefined) {
			map.set(bench.name, avg)
		}
	}
	return map
}

async function readBench(path: string): Promise<BenchFile> {
	return JSON.parse(await Deno.readTextFile(path)) as BenchFile
}

function fmt(ns: number): string {
	return `${ns.toFixed(1)} ns`
}
