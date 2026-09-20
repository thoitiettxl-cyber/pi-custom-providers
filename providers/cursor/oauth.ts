/**
 * Cursor OAuth (loginDeepControl + poll + refresh).
 * Adapted from oh-my-pi packages/ai/src/registry/oauth/cursor.ts
 * for earendil ExtensionAPI registerProvider oauth hooks.
 * Uses setTimeout sleep (not Bun.sleep) for Node/bun portability.
 * Never log tokens.
 */

import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";

const CURSOR_LOGIN_URL = "https://cursor.com/loginDeepControl";
const CURSOR_POLL_URL = "https://api2.cursor.sh/auth/poll";
const CURSOR_REFRESH_URL = "https://api2.cursor.sh/auth/exchange_user_api_key";

const POLL_MAX_ATTEMPTS = 150;
const POLL_BASE_DELAY_MS = 1000;
const POLL_MAX_DELAY_MS = 10_000;
const POLL_BACKOFF = 1.2;

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

function tokenExpiresAt(token: string): number {
	const payload = decodeJwtPayload(token);
	if (payload && typeof payload.exp === "number") {
		return payload.exp * 1000 - 5 * 60 * 1000;
	}
	return Date.now() + 3600 * 1000;
}

export async function generateCursorAuthParams(): Promise<{
	verifier: string;
	challenge: string;
	uuid: string;
	loginUrl: string;
}> {
	const { verifier, challenge } = await generatePKCE();
	const uuid = crypto.randomUUID();
	const params = new URLSearchParams({
		challenge,
		uuid,
		mode: "login",
		redirectTarget: "cli",
	});
	return {
		verifier,
		challenge,
		uuid,
		loginUrl: `${CURSOR_LOGIN_URL}?${params.toString()}`,
	};
}

export async function pollCursorAuth(
	uuid: string,
	verifier: string,
	signal?: AbortSignal,
): Promise<{ accessToken: string; refreshToken: string }> {
	let delay = POLL_BASE_DELAY_MS;
	let consecutiveErrors = 0;

	for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
		if (signal?.aborted) {
			const err = new Error("Cursor authentication aborted");
			err.name = "AbortError";
			throw err;
		}
		await sleep(delay);

		try {
			const response = await fetch(
				`${CURSOR_POLL_URL}?uuid=${encodeURIComponent(uuid)}&verifier=${encodeURIComponent(verifier)}`,
				{ signal },
			);

			if (response.status === 404) {
				consecutiveErrors = 0;
				delay = Math.min(delay * POLL_BACKOFF, POLL_MAX_DELAY_MS);
				continue;
			}

			if (response.ok) {
				const data = (await response.json()) as {
					accessToken: string;
					refreshToken: string;
				};
				if (!data.accessToken) {
					throw new Error("Cursor poll returned empty accessToken");
				}
				return {
					accessToken: data.accessToken,
					refreshToken: data.refreshToken || "",
				};
			}

			throw new Error(`Cursor poll failed: HTTP ${response.status}`);
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") throw err;
			consecutiveErrors++;
			if (consecutiveErrors >= 3) {
				throw new Error(
					`Cursor auth polling failed after consecutive errors: ${
						err instanceof Error ? err.message : String(err)
					}`,
				);
			}
		}
	}

	throw new Error("Cursor authentication polling timed out");
}

/**
 * Extension oauth.login: open loginDeepControl, poll api2.cursor.sh until tokens arrive.
 */
export async function loginCursor(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const { verifier, uuid, loginUrl } = await generateCursorAuthParams();

	callbacks.onAuth({
		url: loginUrl,
		instructions:
			"Open the URL in a browser, sign in to Cursor, and approve CLI access. This session polls until login completes (no paste code).",
	});
	callbacks.onProgress?.("Waiting for Cursor browser authentication…");

	const { accessToken, refreshToken } = await pollCursorAuth(uuid, verifier, callbacks.signal);

	return {
		access: accessToken,
		refresh: refreshToken || accessToken,
		expires: tokenExpiresAt(accessToken),
	};
}

/**
 * Extension oauth.refreshToken: POST exchange_user_api_key with refresh bearer.
 */
export async function refreshCursorToken(
	credentials: OAuthCredentials,
	signal?: AbortSignal,
): Promise<OAuthCredentials> {
	const response = await fetch(CURSOR_REFRESH_URL, {
		method: "POST",
		headers: {
			Authorization: `Bearer ${credentials.refresh}`,
			"Content-Type": "application/json",
		},
		body: "{}",
		signal,
	});

	if (!response.ok) {
		const text = await response.text().catch(() => "");
		throw new Error(
			`Cursor token refresh failed: HTTP ${response.status}${text ? ` ${text.slice(0, 200)}` : ""}`,
		);
	}

	const data = (await response.json()) as {
		accessToken: string;
		refreshToken?: string;
	};

	return {
		access: data.accessToken,
		refresh: data.refreshToken || credentials.refresh,
		expires: tokenExpiresAt(data.accessToken),
	};
}

export const CURSOR_OAUTH_URLS = {
	login: CURSOR_LOGIN_URL,
	poll: CURSOR_POLL_URL,
	refresh: CURSOR_REFRESH_URL,
} as const;
