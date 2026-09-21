#!/usr/bin/env node
/**
 * Print whether ~/.pi/agent/auth.json has a usable xai-omp grant — never dumps tokens.
 * Exit 0 if access token present and not expired (with 60s skew); 1 otherwise.
 *
 * Usage:
 *   node scripts/check-xai-omp-auth.mjs
 *   PI_AUTH_JSON=/path/to/auth.json node scripts/check-xai-omp-auth.mjs
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const AUTH_PATH = process.env.PI_AUTH_JSON || join(homedir(), ".pi/agent/auth.json");
const SKEW_MS = Number(process.env.XAI_AUTH_SKEW_MS || 60_000);

function summarize(creds, key) {
	if (!creds) return { key, present: false };
	const expiresMs = creds.expires != null ? Number(creds.expires) : null;
	const now = Date.now();
	const hoursLeft =
		expiresMs != null && Number.isFinite(expiresMs) ? +((expiresMs - now) / 3_600_000).toFixed(2) : null;
	const accessOk = Boolean(creds.access) && (expiresMs == null || expiresMs > now + SKEW_MS);
	return {
		key,
		present: true,
		type: creds.type ?? null,
		expiresIso: expiresMs != null ? new Date(expiresMs).toISOString() : null,
		hoursLeft,
		accessLen: (creds.access || "").length,
		refreshLen: (creds.refresh || "").length,
		accessUsable: accessOk,
		hasRefresh: Boolean(creds.refresh),
	};
}

if (!existsSync(AUTH_PATH)) {
	console.log(JSON.stringify({ ok: false, reason: "auth.json missing", pathHint: "~/.pi/agent/auth.json" }, null, 2));
	process.exit(1);
}

let auth;
try {
	auth = JSON.parse(readFileSync(AUTH_PATH, "utf8"));
} catch (e) {
	console.log(JSON.stringify({ ok: false, reason: "auth.json parse error", detail: String(e?.message || e).slice(0, 200) }, null, 2));
	process.exit(1);
}

const st = statSync(AUTH_PATH);
const preferred = summarize(auth["xai-omp"], "xai-omp");
const aliases = ["xai-oauth", "xai"].map((k) => summarize(auth[k], k)).filter((s) => s.present);

const report = {
	ok: preferred.accessUsable === true,
	authMtimeIso: st.mtime.toISOString(),
	xaiOmp: preferred,
	otherXaiEntries: aliases,
	hint: preferred.accessUsable
		? "Box xai-omp access is usable — you can copy the post-refresh xai-omp object from this machine's auth.json into yours (replace the whole xai-omp entry). Do not paste tokens into chat."
		: preferred.present
			? "xai-omp present but access expired/unusable — run /login xai-omp on one machine only, then copy that entry OR re-login on each machine (never refresh the same grant concurrently on two machines)."
			: "No xai-omp entry — run /login xai-omp (web OAuth only).",
};

console.log(JSON.stringify(report, null, 2));
process.exitCode = report.ok ? 0 : 1;
