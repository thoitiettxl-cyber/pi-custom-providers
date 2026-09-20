/**
 * Lightweight checks (no live Google / Antigravity login).
 * Run: bun test ./oauth.test.ts
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CURATED_ANTIGRAVITY_MODELS } from "./models.ts";
import {
	ANTIGRAVITY_OAUTH_URLS,
	buildAntigravityAuthorizeUrl,
	generateAntigravityAuthParams,
	generatePKCE,
	getAntigravityApiKey,
	parseStructuredAntigravityApiKey,
} from "./oauth.ts";
import { ANTIGRAVITY_API_ID, ANTIGRAVITY_API_URL, ANTIGRAVITY_PROVIDER_ID, probeStreamGoogleGeminiCliImport } from "./stream.ts";

describe("antigravity oauth helpers", () => {
	it("uses documented Antigravity auth URLs from oh-my-pi KDL", () => {
		assert.equal(ANTIGRAVITY_OAUTH_URLS.authorize, "https://accounts.google.com/o/oauth2/v2/auth");
		assert.equal(ANTIGRAVITY_OAUTH_URLS.token, "https://oauth2.googleapis.com/token");
		assert.equal(ANTIGRAVITY_OAUTH_URLS.redirectUri, "http://127.0.0.1:51121/oauth-callback");
		assert.equal(ANTIGRAVITY_OAUTH_URLS.callbackPort, 51121);
		assert.equal(ANTIGRAVITY_OAUTH_URLS.callbackPath, "/oauth-callback");
		assert.equal(ANTIGRAVITY_OAUTH_URLS.callbackHostname, "127.0.0.1");
		assert.match(ANTIGRAVITY_OAUTH_URLS.clientId, /\.apps\.googleusercontent\.com$/);
		assert.equal(
			ANTIGRAVITY_OAUTH_URLS.clientId,
			["1071006060591", "-tmhssin2h21lcre235vtolojh4g403ep", ".apps.googleusercontent.com"].join(""),
		);
		assert.ok(ANTIGRAVITY_OAUTH_URLS.scopes.includes("https://www.googleapis.com/auth/cloud-platform"));
		assert.ok(ANTIGRAVITY_OAUTH_URLS.scopes.includes("https://www.googleapis.com/auth/cclog"));
	});

	it("generatePKCE returns verifier + challenge", async () => {
		const { verifier, challenge } = await generatePKCE();
		assert.ok(verifier.length > 20);
		assert.ok(challenge.length > 20);
		assert.notEqual(verifier, challenge);
	});

	it("generateAntigravityAuthParams builds authorize URL with PKCE + consent", async () => {
		const params = await generateAntigravityAuthParams();
		const url = new URL(params.loginUrl);
		assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
		assert.equal(url.searchParams.get("response_type"), "code");
		assert.equal(url.searchParams.get("code_challenge_method"), "S256");
		assert.equal(url.searchParams.get("code_challenge"), params.challenge);
		assert.equal(url.searchParams.get("state"), params.state);
		assert.equal(url.searchParams.get("access_type"), "offline");
		assert.equal(url.searchParams.get("prompt"), "consent");
		assert.equal(url.searchParams.get("redirect_uri"), params.redirectUri);
		assert.equal(url.searchParams.get("client_id"), ANTIGRAVITY_OAUTH_URLS.clientId);
		assert.ok((url.searchParams.get("scope") || "").includes("cloud-platform"));
	});

	it("buildAntigravityAuthorizeUrl is deterministic for fixed inputs", () => {
		const url = new URL(
			buildAntigravityAuthorizeUrl({
				challenge: "chal",
				state: "st",
				redirectUri: "http://127.0.0.1:51121/oauth-callback",
			}),
		);
		assert.equal(url.searchParams.get("code_challenge"), "chal");
		assert.equal(url.searchParams.get("state"), "st");
		assert.equal(url.searchParams.get("prompt"), "consent");
	});

	it("getAntigravityApiKey emits structured JSON with token + projectId", () => {
		const key = getAntigravityApiKey({
			access: "atok",
			refresh: "rtok",
			expires: 1_700_000_000_000,
			projectId: "proj-1",
			email: "u@example.com",
		});
		const parsed = parseStructuredAntigravityApiKey(key);
		assert.equal(parsed.token, "atok");
		assert.equal(parsed.projectId, "proj-1");
		assert.equal(parsed.refreshToken, "rtok");
		assert.equal(parsed.expiresAt, 1_700_000_000_000);
		assert.equal(parsed.email, "u@example.com");
		const asJson = JSON.parse(key) as Record<string, unknown>;
		assert.equal(asJson.token, "atok");
		assert.equal(asJson.projectId, "proj-1");
	});

	it("getAntigravityApiKey rejects missing projectId", () => {
		assert.throws(() => getAntigravityApiKey({ access: "a", refresh: "r", expires: 1 }), /projectId/);
	});
});

describe("antigravity provider constants", () => {
	it("points stream at daily-cloudcode-pa with google-gemini-cli api id", () => {
		assert.equal(ANTIGRAVITY_API_URL, "https://daily-cloudcode-pa.googleapis.com");
		assert.equal(ANTIGRAVITY_API_ID, "google-gemini-cli");
		assert.equal(ANTIGRAVITY_PROVIDER_ID, "google-antigravity");
	});

	it("ships curated gemini-3.1-pro, gemini-3.7-flash, gemini-3.1-flash-lite", () => {
		const ids = CURATED_ANTIGRAVITY_MODELS.map((m) => m.id);
		assert.ok(ids.includes("gemini-3.1-pro"));
		assert.ok(ids.includes("gemini-3.7-flash"));
		assert.ok(ids.includes("gemini-3.1-flash-lite"));
		const pro = CURATED_ANTIGRAVITY_MODELS.find((m) => m.id === "gemini-3.1-pro");
		assert.equal(pro?.requestModelId, "gemini-3.1-pro-low");
	});
});

describe("streamGoogleGeminiCli import", () => {
	it("native CCA stream module loads (Node-safe; no Bun/@oh-my-pi required)", async () => {
		const probe = await probeStreamGoogleGeminiCliImport();
		assert.ok(probe.ok, probe.error ?? "native CCA stream probe failed");
		assert.equal(probe.engine, "cca-native-fetch-sse");
	});
});
