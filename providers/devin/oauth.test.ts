/**
 * Lightweight checks (no live Devin login).
 * Run: bun test ./oauth.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURATED_DEVIN_MODELS } from "./models.ts";
import {
	buildDevinAuthorizeUrl,
	DEVIN_OAUTH_URLS,
	generateDevinAuthParams,
	generatePKCE,
	normalizeDevinSessionToken,
	tokenExpiresAt,
} from "./oauth.ts";
import { DEVIN_API_ID, DEVIN_API_URL, probeStreamDevinImport } from "./stream.ts";

describe("devin oauth helpers", () => {
	it("uses documented Devin auth URLs from oh-my-pi KDL", () => {
		assert.equal(DEVIN_OAUTH_URLS.authorize, "https://app.devin.ai/auth/cli/continue");
		assert.equal(DEVIN_OAUTH_URLS.token, "https://api.devin.ai/auth/cli/token");
		assert.equal(DEVIN_OAUTH_URLS.redirectUri, "http://127.0.0.1:59653/callback");
		assert.equal(DEVIN_OAUTH_URLS.callbackPort, 59653);
		assert.equal(DEVIN_OAUTH_URLS.callbackPath, "/callback");
		assert.equal(DEVIN_OAUTH_URLS.callbackHostname, "127.0.0.1");
	});

	it("generatePKCE returns verifier + challenge", async () => {
		const { verifier, challenge } = await generatePKCE();
		assert.ok(verifier.length > 20);
		assert.ok(challenge.length > 20);
		assert.notEqual(verifier, challenge);
	});

	it("generateDevinAuthParams builds authorize URL with PKCE + state + prompt", async () => {
		const params = await generateDevinAuthParams();
		const url = new URL(params.loginUrl);
		assert.equal(url.origin + url.pathname, "https://app.devin.ai/auth/cli/continue");
		assert.equal(url.searchParams.get("response_type"), "code");
		assert.equal(url.searchParams.get("code_challenge_method"), "S256");
		assert.equal(url.searchParams.get("code_challenge"), params.challenge);
		assert.equal(url.searchParams.get("state"), params.state);
		assert.equal(url.searchParams.get("prompt"), "select_account");
		assert.equal(url.searchParams.get("redirect_uri"), params.redirectUri);
	});

	it("buildDevinAuthorizeUrl is deterministic for fixed inputs", () => {
		const url = new URL(
			buildDevinAuthorizeUrl({
				challenge: "chal",
				state: "st",
				redirectUri: "http://127.0.0.1:59653/callback",
			}),
		);
		assert.equal(url.searchParams.get("code_challenge"), "chal");
		assert.equal(url.searchParams.get("state"), "st");
	});

	it("normalizeDevinSessionToken prefixes once", () => {
		assert.equal(normalizeDevinSessionToken("raw"), "devin-session-token$raw");
		assert.equal(normalizeDevinSessionToken("devin-session-token$already"), "devin-session-token$already");
		assert.equal(normalizeDevinSessionToken(""), "");
		assert.equal(normalizeDevinSessionToken(undefined), "");
	});

	it("tokenExpiresAt falls back to ~1y when not a JWT", () => {
		const expires = tokenExpiresAt("not-a-jwt");
		const delta = expires - Date.now();
		assert.ok(delta > 30_000_000_000);
		assert.ok(delta < 32_000_000_000);
	});
});

describe("devin provider constants", () => {
	it("points stream at server.codeium.com with devin-agent api id", () => {
		assert.equal(DEVIN_API_URL, "https://server.codeium.com");
		assert.equal(DEVIN_API_ID, "devin-agent");
	});

	it("ships curated models swe-1-6 and swe-1-6-fast", () => {
		assert.ok(CURATED_DEVIN_MODELS.some((m) => m.id === "swe-1-6"));
		assert.ok(CURATED_DEVIN_MODELS.some((m) => m.id === "swe-1-6-fast"));
		assert.equal(CURATED_DEVIN_MODELS.length, 2);
	});
});

describe("streamDevin import", () => {
	it("reports native-unavailable (omp stream fallback disabled)", async () => {
		const { probeStreamDevinImport } = await import("./stream.ts");
		const probe = await probeStreamDevinImport();
		assert.equal(probe.ok, false);
		assert.ok(probe.engine?.includes("native"));
		assert.ok(probe.error?.includes("omp") || probe.error?.includes("native"));
	});
});
