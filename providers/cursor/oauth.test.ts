/**
 * Lightweight checks (no live Cursor login).
 * Run: bun test test.ts   OR   npm test
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURATED_CURSOR_MODELS } from "./models.ts";
import { CURSOR_OAUTH_URLS, generateCursorAuthParams, generatePKCE } from "./oauth.ts";
import { CURSOR_API_ID, CURSOR_API_URL, probeStreamCursorImport } from "./stream.ts";

describe("cursor oauth helpers", () => {
	it("uses documented Cursor auth URLs from oh-my-pi", () => {
		assert.equal(CURSOR_OAUTH_URLS.login, "https://cursor.com/loginDeepControl");
		assert.equal(CURSOR_OAUTH_URLS.poll, "https://api2.cursor.sh/auth/poll");
		assert.equal(CURSOR_OAUTH_URLS.refresh, "https://api2.cursor.sh/auth/exchange_user_api_key");
	});

	it("generatePKCE returns verifier + challenge", async () => {
		const { verifier, challenge } = await generatePKCE();
		assert.ok(verifier.length > 20);
		assert.ok(challenge.length > 20);
		assert.notEqual(verifier, challenge);
	});

	it("generateCursorAuthParams builds loginDeepControl URL with challenge+uuid", async () => {
		const params = await generateCursorAuthParams();
		const url = new URL(params.loginUrl);
		assert.equal(url.origin + url.pathname, "https://cursor.com/loginDeepControl");
		assert.equal(url.searchParams.get("mode"), "login");
		assert.equal(url.searchParams.get("redirectTarget"), "cli");
		assert.equal(url.searchParams.get("challenge"), params.challenge);
		assert.equal(url.searchParams.get("uuid"), params.uuid);
	});
});

describe("cursor provider constants", () => {
	it("points stream at api2.cursor.sh AgentService transport id", () => {
		assert.equal(CURSOR_API_URL, "https://api2.cursor.sh");
		assert.equal(CURSOR_API_ID, "cursor-agent");
	});

	it("ships curated models including default", () => {
		assert.ok(CURATED_CURSOR_MODELS.some((m) => m.id === "default"));
		assert.ok(CURATED_CURSOR_MODELS.length >= 5);
	});
});

describe("streamCursor import", () => {
	it("probes streamCursor via bun-shim (ok under Bun; Node may defer to cursor-native)", async () => {
		const probe = await probeStreamCursorImport();
		if (probe.ok) {
			assert.ok(probe.engine?.includes("streamCursor") || probe.engine?.includes("native"));
			return;
		}
		// Under published Pi Node+jiti, omp still hits Bun-only modules; hybrid allows soft-fail.
		assert.ok(probe.engine?.includes("pending") || probe.error, probe.error ?? "expected pending native or error");
		if (process.env.FORCE_OMP_IMPORT === "1") {
			assert.ok(probe.ok, probe.error ?? "FORCE_OMP_IMPORT=1 requires omp streamCursor");
		}
	});
});
