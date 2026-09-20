/**
 * Devin OAuth (authorization-code + PKCE + local callback).
 * Endpoints from oh-my-pi catalog auth/devin.kdl — do not invent URLs.
 * Prefer 127.0.0.1:59653/callback; fall back to paste callback URL via onPrompt.
 * refresh "none" — refreshDevinToken is a no-op / re-login hint.
 * Never log tokens.
 */

import http from "node:http";
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";

const DEVIN_AUTHORIZE_URL = "https://app.devin.ai/auth/cli/continue";
const DEVIN_TOKEN_URL = "https://api.devin.ai/auth/cli/token";
const DEVIN_API_ENDPOINT = "https://api.devin.ai";
const DEVIN_APP_URL = "https://app.devin.ai";

const CALLBACK_HOSTNAME = "127.0.0.1";
const CALLBACK_PORT = 59653;
const CALLBACK_PATH = "/callback";
const DEFAULT_REDIRECT_URI = `http://${CALLBACK_HOSTNAME}:${CALLBACK_PORT}${CALLBACK_PATH}`;

/** Matches oh-my-pi packages/catalog/src/wire/devin.ts */
const DEVIN_SESSION_TOKEN_PREFIX = "devin-session-token$";

/** JWT expires skew 5m; KDL fallback-ms=31536000000 (1y). */
const EXPIRES_SKEW_MS = 5 * 60 * 1000;
const EXPIRES_FALLBACK_MS = 31_536_000_000;

const LOGIN_TIMEOUT_MS = 300_000;

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
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

function decodeJwtPayload(token: string): Record<string, unknown> | undefined {
	const parts = token.split(".");
	if (parts.length !== 3 || !parts[1]) return undefined;
	try {
		return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"))) as Record<string, unknown>;
	} catch {
		return undefined;
	}
}

export function tokenExpiresAt(token: string): number {
	const payload = decodeJwtPayload(token);
	if (payload && typeof payload.exp === "number") {
		return payload.exp * 1000 - EXPIRES_SKEW_MS;
	}
	return Date.now() + EXPIRES_FALLBACK_MS;
}

/**
 * Copy of oh-my-pi `normalizeDevinSessionToken` (wire/devin.ts).
 * Session token as the wire format carries it: the scheme prefix is required.
 */
export function normalizeDevinSessionToken(apiKey: string | undefined): string {
	if (!apiKey) return "";
	return apiKey.startsWith(DEVIN_SESSION_TOKEN_PREFIX) ? apiKey : `${DEVIN_SESSION_TOKEN_PREFIX}${apiKey}`;
}

export function buildDevinAuthorizeUrl(opts: { challenge: string; state: string; redirectUri: string }): string {
	const params = new URLSearchParams({
		response_type: "code",
		redirect_uri: opts.redirectUri,
		code_challenge: opts.challenge,
		code_challenge_method: "S256",
		state: opts.state,
		prompt: "select_account",
	});
	return `${DEVIN_AUTHORIZE_URL}?${params.toString()}`;
}

export async function generateDevinAuthParams(redirectUri = DEFAULT_REDIRECT_URI): Promise<{
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
		loginUrl: buildDevinAuthorizeUrl({ challenge, state, redirectUri }),
	};
}

export async function exchangeDevinToken(
	code: string,
	codeVerifier: string,
	signal?: AbortSignal,
): Promise<{ token: string }> {
	const response = await fetch(DEVIN_TOKEN_URL, {
		method: "POST",
		headers: {
			Accept: "application/json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ code, code_verifier: codeVerifier }),
		signal,
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(`Devin token exchange failed: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`);
	}

	const data = (await response.json()) as { token?: string };
	if (!data.token) {
		throw new Error("Devin token exchange returned empty token");
	}
	return { token: data.token };
}

type CallbackWaitResult = { code: string; state: string };

/**
 * Bind a one-shot HTTP listener on 127.0.0.1:59653/callback.
 * Returns null if the port cannot be bound (caller should paste-URL fallback).
 */
export function tryStartDevinCallbackServer(
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
					rejectWait(new Error("Devin OAuth state mismatch"));
					return;
				}
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(
					"<html><body><h1>Devin login complete</h1><p>You can close this tab and return to the CLI.</p></body></html>",
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
				const err = new Error("Devin authentication aborted");
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
	// Providers may echo `code#state` (oh-my-pi oauth-code engine).
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
		// Bare code paste
		if (/^[A-Za-z0-9_-]+$/.test(trimmed)) {
			return { code: trimmed, state: expectedState };
		}
		throw new Error("Could not parse Devin callback URL or code");
	}
}

/**
 * Extension oauth.login: PKCE authorize → local callback (or paste) → token JSON.
 */
export async function loginDevin(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const { verifier, challenge, state, loginUrl } = await generateDevinAuthParams();

	const server = await tryStartDevinCallbackServer(state, callbacks.signal);

	const authUrl = server ? buildDevinAuthorizeUrl({ challenge, state, redirectUri: server.redirectUri }) : loginUrl;

	callbacks.onAuth({
		url: authUrl,
		instructions: server
			? "Sign in to Devin in your browser. This session waits on http://127.0.0.1:59653/callback (no paste needed)."
			: "Sign in to Devin in your browser. Local callback port 59653 was unavailable — paste the full callback URL after redirect.",
	});
	callbacks.onProgress?.(
		server ? "Waiting for Devin browser authentication on local callback…" : "Waiting for pasted Devin callback URL…",
	);

	let code: string;
	try {
		if (server) {
			const timeout = sleep(LOGIN_TIMEOUT_MS).then(() => {
				throw new Error("Devin authentication timed out waiting for callback");
			});
			const result = await Promise.race([server.wait, timeout]);
			code = (result as CallbackWaitResult).code;
			server.close();
		} else {
			const pasted = await callbacks.onPrompt({
				message: "Paste the Devin callback URL (or code#state):",
			});
			const parsed = parseCallbackInput(pasted, state);
			if (parsed.state && parsed.state !== state) {
				throw new Error("Devin OAuth state mismatch");
			}
			code = parsed.code;
		}
	} catch (err) {
		server?.close();
		throw err;
	}

	const { token } = await exchangeDevinToken(code, verifier, callbacks.signal);

	return {
		access: token,
		refresh: token,
		expires: tokenExpiresAt(token),
	};
}

/**
 * Devin KDL refresh is "none". Keep credentials if not expired; otherwise ask for re-login.
 */
export async function refreshDevinToken(
	credentials: OAuthCredentials,
	_signal?: AbortSignal,
): Promise<OAuthCredentials> {
	if (credentials.expires && credentials.expires > Date.now()) {
		return credentials;
	}
	throw new Error(
		"Devin session expired and refresh is not supported. Run /login devin again (or set DEVIN_API_KEY).",
	);
}

/** getApiKey for registerProvider oauth — applies session-token prefix. */
export function getDevinApiKey(cred: OAuthCredentials): string {
	return normalizeDevinSessionToken(cred.access);
}

export const DEVIN_OAUTH_URLS = {
	authorize: DEVIN_AUTHORIZE_URL,
	token: DEVIN_TOKEN_URL,
	apiEndpoint: DEVIN_API_ENDPOINT,
	app: DEVIN_APP_URL,
	redirectUri: DEFAULT_REDIRECT_URI,
	callbackPort: CALLBACK_PORT,
	callbackPath: CALLBACK_PATH,
	callbackHostname: CALLBACK_HOSTNAME,
} as const;
