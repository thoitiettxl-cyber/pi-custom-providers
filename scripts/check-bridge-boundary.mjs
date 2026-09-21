#!/usr/bin/env node
/**
 * Bridge boundary: fail if providers or native adapters reference
 * @oh-my-pi/pi-ai/providers (any form). Keeps streams on the Adapter layer.
 *
 * Scans: providers/ (recursive .ts), shared/native-*.ts, shared/xai-oauth-native.ts
 * Ignores: node_modules
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const FORBIDDEN = "@oh-my-pi/pi-ai/providers";
const ROOT = join(fileURLToPath(import.meta.url), "..", "..");

/** @param {string} dir @param {string[]} [out] */
function walkTs(dir, out = []) {
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return out;
	}
	for (const ent of entries) {
		if (ent.name === "node_modules" || ent.name === ".git") continue;
		const full = join(dir, ent.name);
		if (ent.isDirectory()) {
			walkTs(full, out);
		} else if (ent.isFile() && ent.name.endsWith(".ts")) {
			out.push(full);
		}
	}
	return out;
}

/** @returns {string[]} */
function collectTargets() {
	const files = walkTs(join(ROOT, "providers"));
	const shared = join(ROOT, "shared");
	try {
		for (const name of readdirSync(shared)) {
			if (name === "node_modules") continue;
			const full = join(shared, name);
			try {
				if (!statSync(full).isFile()) continue;
			} catch {
				continue;
			}
			if (name.startsWith("native-") && name.endsWith(".ts")) {
				files.push(full);
			} else if (name === "xai-oauth-native.ts") {
				files.push(full);
			}
		}
	} catch {
		/* no shared */
	}
	return files;
}

function main() {
	const files = collectTargets();
	/** @type {{ file: string; line: number; text: string }[]} */
	const hits = [];
	for (const file of files) {
		const body = readFileSync(file, "utf8");
		if (!body.includes(FORBIDDEN)) continue;
		const lines = body.split(/\r?\n/);
		for (let i = 0; i < lines.length; i++) {
			if (lines[i].includes(FORBIDDEN)) {
				hits.push({
					file: relative(ROOT, file),
					line: i + 1,
					text: lines[i].trimEnd(),
				});
			}
		}
	}

	if (hits.length === 0) {
		console.log(
			`check-bridge-boundary: ok (${files.length} files, no ${FORBIDDEN})`,
		);
		process.exit(0);
	}

	console.error(
		`check-bridge-boundary: FAIL — ${hits.length} hit(s) of ${FORBIDDEN}:\n`,
	);
	for (const h of hits) {
		console.error(`  ${h.file}:${h.line}: ${h.text}`);
	}
	console.error(
		"\nHandlers/native adapters must not import omp provider streams. Use native streamSimple.",
	);
	process.exit(1);
}

main();
