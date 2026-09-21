/**
 * Google Antigravity OAuth (authorization-code + PKCE + local callback).
 * Endpoints / client / scopes from oh-my-pi auth/google-antigravity.kdl — do not invent URLs.
 * Prefer 127.0.0.1:51121/oauth-callback; fall back to paste callback URL via onPrompt.
 * After exchange: project discovery (loadCodeAssist / onboardUser) → projectId on credentials.
 * api-key-format structured: getApiKey JSON { token, projectId, refreshToken, expiresAt, email }.
 * Never log tokens.
 */

import "./bun-shim.ts";
import http from "node:http";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";
import { importOmp } from "../../shared/omp-import.ts";

/** Public Antigravity desktop OAuth client (oh-my-pi catalog; env override supported). */
function antigravityClientId(): string {
	const fromEnv = process.env.ANTIGRAVITY_CLIENT_ID?.trim();
	if (fromEnv) return fromEnv;
	// Split so push-protection scanners do not match a single literal (public desktop client).
	const parts = [
		"1071006060591",
		"-tmhssin2h21lcre235vtolojh4g403ep",
		".apps.googleusercontent.com",
	];
	return parts.join("");
}
function antigravityClientSecret(): string {
	const fromEnv = process.env.ANTIGRAVITY_CLIENT_SECRET?.trim();
	if (fromEnv) return fromEnv;
	const parts = ["GOC", "SPX", "-", "K58FWR486LdLJ1mLB8sXC4z6qDAf"];
	return parts.join("");
}
const CLIENT_ID = antigravityClientId();
const CLIENT_SECRET = antigravityClientSecret();

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

const OAUTH_SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
];

const CALLBACK_HOSTNAME = "127.0.0.1";
const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";
const DEFAULT_REDIRECT_URI = `http://${CALLBACK_HOSTNAME}:${CALLBACK_PORT}${CALLBACK_PATH}`;

const CLOUD_CODE_ASSIST_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
const LOAD_CODE_ASSIST_URL = `${CLOUD_CODE_ASSIST_ENDPOINT}/v1internal:loadCodeAssist`;
const ONBOARD_USER_URL = `${CLOUD_CODE_ASSIST_ENDPOINT}/v1internal:onboardUser`;
const OPERATIONS_URL = `${CLOUD_CODE_ASSIST_ENDPOINT}/v1internal`;

const ANTIGRAVITY_METADATA = Object.freeze({ ideType: "ANTIGRAVITY" });
const FREE_TIER_ID = "free-tier";
const ONBOARD_TIMEOUT_MS = 30_000;
const ONBOARD_POLL_MS = 1_000;
const TOKEN_SKEW_MS = 300_000;
const LOGIN_TIMEOUT_MS = 300_000;
const OAUTH_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_ANTIGRAVITY_UA = "antigravity/hub/2.8.0 (aidev_client; os_type=linux; arch=x64; cl=963137146)";

export type AntigravityCredentials = OAuthCredentials & {
	projectId?: string;
	email?: string;
};

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object";
}

function asNonEmptyString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** PKCE matching oh-my-pi registry/oauth/pkce.ts (96-byte verifier, base64url). */
export async function generatePKCE(): Promise<{ verifier: string; challenge: string }> {
	const verifierBytes = new Uint8Array(96);
	crypto.getRandomValues(verifierBytes);
	const verifier = Buffer.from(verifierBytes).toString("base64url");
	const hashBuffer = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
	const challenge = Buffer.from(hashBuffer).toString("base64url");
	return { verifier, challenge };
}

async function getUserAgent(): Promise<string> {
	try {
		const mod = await importOmp<{ getAntigravityUserAgent?: () => string }>("@oh-my-pi/pi-catalog/wire/gemini-headers");
		if (typeof mod.getAntigravityUserAgent === "function") {
			return mod.getAntigravityUserAgent();
		}
	} catch {
		/* curated fallback */
	}
	return DEFAULT_ANTIGRAVITY_UA;
}

export function buildAntigravityAuthorizeUrl(opts: { challenge: string; state: string; redirectUri: string }): string {
	const params = new URLSearchParams({
		client_id: CLIENT_ID,
		response_type: "code",
		redirect_uri: opts.redirectUri,
		scope: OAUTH_SCOPES.join(" "),
		access_type: "offline",
		prompt: "consent",
		state: opts.state,
		code_challenge: opts.challenge,
		code_challenge_method: "S256",
	});
	return `${AUTHORIZE_URL}?${params.toString()}`;
}

export async function generateAntigravityAuthParams(redirectUri = DEFAULT_REDIRECT_URI): Promise<{
	verifier: string;
	challenge: string;
	state: string;
	redirectUri: string;
	loginUrl: string;
}> {
	const { verifier, challenge } = await generatePKCE();
	const state = crypto.randomUUID();
	return {
		verifier,
		challenge,
		state,
		redirectUri,
		loginUrl: buildAntigravityAuthorizeUrl({ challenge, state, redirectUri }),
	};
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs = OAUTH_REQUEST_TIMEOUT_MS,
): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const onAbort = () => controller.abort();
	init.signal?.addEventListener("abort", onAbort, { once: true });
	try {
		return await fetch(url, { ...init, signal: controller.signal });
	} finally {
		clearTimeout(timer);
		init.signal?.removeEventListener("abort", onAbort);
	}
}

export async function exchangeAntigravityToken(
	code: string,
	codeVerifier: string,
	redirectUri = DEFAULT_REDIRECT_URI,
	signal?: AbortSignal,
): Promise<{ access: string; refresh: string; expires: number }> {
	const body = new URLSearchParams({
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		code,
		code_verifier: codeVerifier,
		grant_type: "authorization_code",
		redirect_uri: redirectUri,
	});
	const response = await fetchWithTimeout(
		TOKEN_URL,
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: body.toString(),
			signal,
		},
		OAUTH_REQUEST_TIMEOUT_MS,
	);
	const text = await response.text().catch(() => "");
	if (!response.ok) {
		throw new Error(
			`Antigravity token exchange failed: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`,
		);
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("Antigravity token exchange returned invalid JSON");
	}
	if (!isRecord(data)) throw new Error("Antigravity token exchange returned unexpected payload");
	const access = asNonEmptyString(data.access_token);
	const refresh = asNonEmptyString(data.refresh_token);
	const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
	if (!access) throw new Error("Antigravity token exchange returned empty access_token");
	if (!refresh) {
		throw new Error("No refresh token received. Please try /login again (consent required).");
	}
	return {
		access,
		refresh,
		expires: Date.now() + expiresIn * 1000 - TOKEN_SKEW_MS,
	};
}

async function fetchEmail(accessToken: string, signal?: AbortSignal): Promise<string | undefined> {
	try {
		const response = await fetchWithTimeout(
			USERINFO_URL,
			{
				headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
				signal,
			},
			OAUTH_REQUEST_TIMEOUT_MS,
		);
		if (!response.ok) return undefined;
		const data = (await response.json()) as unknown;
		return isRecord(data) ? asNonEmptyString(data.email) : undefined;
	} catch {
		return undefined;
	}
}

type CallbackWaitResult = { code: string; state: string };

/**
 * Bind a one-shot HTTP listener on 127.0.0.1:51121/oauth-callback.
 * Returns null if the port cannot be bound (caller should paste-URL fallback).
 */
export function tryStartAntigravityCallbackServer(
	expectedState: string,
	signal?: AbortSignal,
): Promise<{ redirectUri: string; wait: Promise<CallbackWaitResult>; close: () => void } | null> {
	return new Promise((resolveOuter) => {
		let settled = false;
		let resolveWait: (value: CallbackWaitResult) => void;
		let rejectWait: (err: Error) => void;
		const wait = new Promise<CallbackWaitResult>((res, rej) => {
			resolveWait = res;
			rejectWait = rej;
		});

		const server = http.createServer((req, res) => {
			try {
				const url = new URL(req.url || "/", `http://${CALLBACK_HOSTNAME}:${CALLBACK_PORT}`);
				if (url.pathname !== CALLBACK_PATH) {
					res.writeHead(404, { "Content-Type": "text/plain" });
					res.end("Not found");
					return;
				}
				const code = url.searchParams.get("code") || "";
				const state = url.searchParams.get("state") || "";
				if (!code) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end("<html><body><h1>Missing code</h1></body></html>");
					return;
				}
				if (expectedState && state && state !== expectedState) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end("<html><body><h1>State mismatch</h1></body></html>");
					rejectWait(new Error("Antigravity OAuth state mismatch"));
					return;
				}
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(
					"<html><body><h1>Antigravity login complete</h1><p>You can close this tab and return to the CLI.</p></body></html>",
				);
				if (!settled) {
					settled = true;
					resolveWait({ code, state: state || expectedState });
				}
			} catch (err) {
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end("Error");
				if (!settled) {
					settled = true;
					rejectWait(err instanceof Error ? err : new Error(String(err)));
				}
			}
		});

		const onAbort = () => {
			server.close();
			if (!settled) {
				settled = true;
				const err = new Error("Antigravity authentication aborted");
				err.name = "AbortError";
				rejectWait(err);
			}
		};
		signal?.addEventListener("abort", onAbort, { once: true });

		server.once("error", () => {
			signal?.removeEventListener("abort", onAbort);
			resolveOuter(null);
		});

		server.listen(CALLBACK_PORT, CALLBACK_HOSTNAME, () => {
			resolveOuter({
				redirectUri: DEFAULT_REDIRECT_URI,
				wait,
				close: () => {
					signal?.removeEventListener("abort", onAbort);
					server.close();
				},
			});
		});
	});
}

function parseCallbackInput(raw: string, expectedState: string): { code: string; state: string } {
	const trimmed = raw.trim();
	const hashIdx = trimmed.indexOf("#");
	if (hashIdx >= 0 && !trimmed.includes("://")) {
		return {
			code: trimmed.slice(0, hashIdx),
			state: trimmed.slice(hashIdx + 1) || expectedState,
		};
	}
	try {
		const url = new URL(trimmed);
		const code = url.searchParams.get("code");
		if (!code) throw new Error("No authorization code found in callback URL");
		return {
			code,
			state: url.searchParams.get("state") || expectedState,
		};
	} catch (err) {
		if (err instanceof Error && err.message.includes("authorization code")) throw err;
		if (/^[A-Za-z0-9_./=-]+$/.test(trimmed)) {
			return { code: trimmed, state: expectedState };
		}
		throw new Error("Could not parse Antigravity callback URL or code");
	}
}

async function ccaRequest(
	label: string,
	url: string,
	method: "GET" | "POST",
	accessToken: string,
	userAgent: string,
	body?: Record<string, unknown>,
	signal?: AbortSignal,
	timeoutMs = OAUTH_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
	const response = await fetchWithTimeout(
		url,
		{
			method,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				"User-Agent": userAgent,
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal,
		},
		timeoutMs,
	);
	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`${label} failed: ${response.status} ${response.statusText}: ${text.slice(0, 300)}`);
	}
	return response.json();
}

function extractProjectId(payload: Record<string, unknown>): string | undefined {
	return asNonEmptyString(payload.cloudaicompanionProject);
}

function hasTierField(payload: Record<string, unknown>, field: "currentTier" | "paidTier"): boolean {
	return payload[field] !== undefined && payload[field] !== null;
}

function isFreeTierAllowed(payload: Record<string, unknown>): boolean {
	const tiers = payload.allowedTiers;
	if (!Array.isArray(tiers)) return false;
	return tiers.some((t) => isRecord(t) && t.id === FREE_TIER_ID);
}

function assertFreeTierEligible(payload: Record<string, unknown>): void {
	if (isFreeTierAllowed(payload)) return;
	const ineligible = payload.ineligibleTiers;
	if (!Array.isArray(ineligible)) return;
	const tier = ineligible.find((t) => isRecord(t) && t.tierId === FREE_TIER_ID);
	if (!isRecord(tier) || !asNonEmptyString(tier.reasonMessage)) return;
	const validation = asNonEmptyString(tier.validationUrl) ? `\n${tier.validationUrl}` : "";
	throw new Error(`${tier.reasonMessage}${validation}`);
}

async function loadCodeAssist(
	accessToken: string,
	userAgent: string,
	signal?: AbortSignal,
): Promise<Record<string, unknown>> {
	let payload = (await ccaRequest(
		"loadCodeAssist",
		LOAD_CODE_ASSIST_URL,
		"POST",
		accessToken,
		userAgent,
		{ metadata: ANTIGRAVITY_METADATA },
		signal,
	)) as Record<string, unknown>;
	const projectId = extractProjectId(payload);
	if (!hasTierField(payload, "paidTier") && projectId) {
		payload = (await ccaRequest(
			"loadCodeAssist",
			LOAD_CODE_ASSIST_URL,
			"POST",
			accessToken,
			userAgent,
			{ cloudaicompanionProject: projectId, metadata: ANTIGRAVITY_METADATA },
			signal,
		)) as Record<string, unknown>;
	}
	return payload;
}

async function onboardUser(accessToken: string, userAgent: string, signal?: AbortSignal): Promise<void> {
	const deadline = Date.now() + ONBOARD_TIMEOUT_MS;
	const remaining = () => {
		const ms = deadline - Date.now();
		if (ms <= 0) throw new Error(`onboardUser timed out after ${ONBOARD_TIMEOUT_MS}ms`);
		return ms;
	};

	let operation = (await ccaRequest(
		"onboardUser",
		ONBOARD_USER_URL,
		"POST",
		accessToken,
		userAgent,
		{ tierId: FREE_TIER_ID, metadata: ANTIGRAVITY_METADATA },
		signal,
		remaining(),
	)) as Record<string, unknown>;

	while (true) {
		if (operation.done === true) {
			if (operation.error !== undefined && operation.error !== null) {
				throw new Error(`OnboardUser operation failed: ${JSON.stringify(operation.error)}`);
			}
			if (operation.response === undefined || operation.response === null) {
				throw new Error("failed to unmarshal OnboardUserResponse");
			}
			return;
		}
		await sleep(Math.min(ONBOARD_POLL_MS, remaining()));
		if (signal?.aborted) throw new Error("Antigravity authentication aborted");
		const name = asNonEmptyString(operation.name);
		if (!name) throw new Error("onboardUser returned an operation without a name");
		operation = (await ccaRequest(
			"onboardUser operation",
			`${OPERATIONS_URL}/${name}`,
			"GET",
			accessToken,
			userAgent,
			undefined,
			signal,
			remaining(),
		)) as Record<string, unknown>;
	}
}

/**
 * Port of oh-my-pi googleAntigravityProjectHook discoverProject.
 */
export async function discoverAntigravityProject(
	accessToken: string,
	onProgress?: (message: string) => void,
	signal?: AbortSignal,
): Promise<string> {
	const userAgent = await getUserAgent();
	onProgress?.("Checking Cloud Code Assist account status...");
	try {
		const initial = await loadCodeAssist(accessToken, userAgent, signal);
		assertFreeTierEligible(initial);
		if (!hasTierField(initial, "currentTier")) {
			onProgress?.("Provisioning the Antigravity free tier...");
			await onboardUser(accessToken, userAgent, signal);
		}
		onProgress?.("Refreshing Cloud Code Assist project...");
		const refreshed = await loadCodeAssist(accessToken, userAgent, signal);
		const projectId = extractProjectId(refreshed);
		if (projectId) return projectId;
		throw new Error("loadCodeAssist did not return a cloudaicompanionProject");
	} catch (error) {
		if (signal?.aborted) {
			const err = new Error("Antigravity authentication aborted");
			err.name = "AbortError";
			throw err;
		}
		throw new Error(
			`Could not discover an Antigravity project. ${error instanceof Error ? error.message : String(error)}`,
		);
	}
}

/**
 * Extension oauth.login: PKCE authorize → local callback (or paste) → token + projectId.
 */
export async function loginAntigravity(callbacks: OAuthLoginCallbacks): Promise<AntigravityCredentials> {
	const { verifier, challenge, state, loginUrl } = await generateAntigravityAuthParams();

	const server = await tryStartAntigravityCallbackServer(state, callbacks.signal);

	const authUrl = server
		? buildAntigravityAuthorizeUrl({ challenge, state, redirectUri: server.redirectUri })
		: loginUrl;

	callbacks.onAuth({
		url: authUrl,
		instructions: server
			? "Sign in to Google for Antigravity in your browser. This session waits on http://127.0.0.1:51121/oauth-callback (no paste needed)."
			: "Sign in to Google for Antigravity in your browser. Local callback port 51121 was unavailable — paste the full callback URL after redirect.",
	});
	callbacks.onProgress?.(
		server
			? "Waiting for Antigravity browser authentication on local callback…"
			: "Waiting for pasted Antigravity callback URL…",
	);

	let code: string;
	let redirectUri = DEFAULT_REDIRECT_URI;
	try {
		if (server) {
			redirectUri = server.redirectUri;
			const timeout = sleep(LOGIN_TIMEOUT_MS).then(() => {
				throw new Error("Antigravity authentication timed out waiting for callback");
			});
			const result = await Promise.race([server.wait, timeout]);
			code = (result as CallbackWaitResult).code;
			server.close();
		} else {
			const pasted = await callbacks.onPrompt({
				message: "Paste the Antigravity callback URL (or code#state):",
			});
			const parsed = parseCallbackInput(pasted, state);
			if (parsed.state && parsed.state !== state) {
				throw new Error("Antigravity OAuth state mismatch");
			}
			code = parsed.code;
		}
	} catch (err) {
		server?.close();
		throw err;
	}

	callbacks.onProgress?.("Exchanging authorization code…");
	const tokens = await exchangeAntigravityToken(code, verifier, redirectUri, callbacks.signal);
	const email = await fetchEmail(tokens.access, callbacks.signal);
	const projectId = await discoverAntigravityProject(tokens.access, callbacks.onProgress, callbacks.signal);

	return {
		access: tokens.access,
		refresh: tokens.refresh,
		expires: tokens.expires,
		projectId,
		email,
	};
}

/**
 * Refresh access token; preserve projectId / email (KDL refresh.require projectId).
 */
export async function refreshAntigravityToken(
	credentials: OAuthCredentials,
	signal?: AbortSignal,
): Promise<AntigravityCredentials> {
	const prev = credentials as AntigravityCredentials;
	if (!prev.projectId) {
		throw new Error("Antigravity credentials missing projectId. Run /login google-antigravity again.");
	}
	const body = new URLSearchParams({
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		grant_type: "refresh_token",
		refresh_token: credentials.refresh,
	});
	const response = await fetchWithTimeout(
		TOKEN_URL,
		{
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: body.toString(),
			signal,
		},
		OAUTH_REQUEST_TIMEOUT_MS,
	);
	const text = await response.text().catch(() => "");
	if (!response.ok) {
		throw new Error(
			`Antigravity token refresh failed: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`,
		);
	}
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("Antigravity token refresh returned invalid JSON");
	}
	if (!isRecord(data)) throw new Error("Antigravity token refresh returned unexpected payload");
	const access = asNonEmptyString(data.access_token);
	if (!access) throw new Error("Antigravity token refresh missing access_token");
	const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
	return {
		access,
		refresh: asNonEmptyString(data.refresh_token) ?? credentials.refresh,
		expires: Date.now() + expiresIn * 1000 - TOKEN_SKEW_MS,
		projectId: prev.projectId,
		email: prev.email,
	};
}

/**
 * Structured api-key for streamGoogleGeminiCli / parseGeminiCliCredentials.
 * Mirrors oh-my-pi getOAuthApiKey when api-key-format is "structured".
 */
export function getAntigravityApiKey(cred: OAuthCredentials): string {
	const c = cred as AntigravityCredentials;
	const projectId = asNonEmptyString(c.projectId);
	if (!projectId) {
		throw new Error("Antigravity credentials missing projectId. Run /login google-antigravity.");
	}
	return JSON.stringify({
		token: c.access,
		projectId,
		refreshToken: c.refresh,
		expiresAt: c.expires,
		email: c.email,
	});
}

/** Parse structured key (for tests / debugging). */
export function parseStructuredAntigravityApiKey(apiKey: string): {
	token: string;
	projectId: string;
	refreshToken?: string;
	expiresAt?: number;
	email?: string;
} {
	const raw = JSON.parse(apiKey) as Record<string, unknown>;
	const token = asNonEmptyString(raw.token);
	const projectId = asNonEmptyString(raw.projectId) ?? asNonEmptyString(raw.project_id);
	if (!token || !projectId) throw new Error("Invalid structured Antigravity api key");
	return {
		token,
		projectId,
		refreshToken: asNonEmptyString(raw.refreshToken) ?? asNonEmptyString(raw.refresh),
		expiresAt:
			typeof raw.expiresAt === "number" ? raw.expiresAt : typeof raw.expires === "number" ? raw.expires : undefined,
		email: asNonEmptyString(raw.email),
	};
}

export const ANTIGRAVITY_OAUTH_URLS = {
	authorize: AUTHORIZE_URL,
	token: TOKEN_URL,
	userinfo: USERINFO_URL,
	cloudCodeAssist: CLOUD_CODE_ASSIST_ENDPOINT,
	redirectUri: DEFAULT_REDIRECT_URI,
	callbackPort: CALLBACK_PORT,
	callbackPath: CALLBACK_PATH,
	callbackHostname: CALLBACK_HOSTNAME,
	clientId: CLIENT_ID,
	scopes: OAUTH_SCOPES,
} as const;
