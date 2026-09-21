/**
 * Pi-compatible SuperGrok device OAuth (same client/tokens as first-party `xai`).
 * Used by xai-omp so refresh/login do not depend on @oh-my-pi/pi-ai/registry
 * (Node/jiti often cannot load omp's TS exports the same way bun does).
 */
import type { OAuthCredentials, OAuthLoginCallbacks } from "@earendil-works/pi-ai/compat";

const XAI_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const XAI_SCOPE = "openid profile email offline_access grok-cli:access api:access";
const XAI_DEVICE_CODE_URL = "https://auth.x.ai/oauth2/device/code";
const XAI_TOKEN_URL = "https://auth.x.ai/oauth2/token";
/** Refresh slightly before reported expiry to avoid mid-request death. */
const REFRESH_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
const CANCEL_MESSAGE = "Login cancelled";
const MINIMUM_INTERVAL_MS = 1000;
const DEFAULT_POLL_INTERVAL_SECONDS = 5;
const SLOW_DOWN_INTERVAL_INCREMENT_MS = 5000;

type JsonObject = Record<string, unknown>;

type OAuthHttpResponse = {
	ok: boolean;
	status: number;
	body: JsonObject;
};

type XaiDeviceCode = {
	deviceCode: string;
	userCode: string;
	verificationUri: string;
	verificationUriComplete?: string;
	intervalSeconds?: number;
	expiresInSeconds: number;
};

export type ThinOAuthHandlers = {
	name: string;
	login: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials>;
	refreshToken: (credentials: OAuthCredentials, signal: AbortSignal) => Promise<OAuthCredentials>;
	getApiKey: (credentials: OAuthCredentials) => string;
};

function requiredString(body: JsonObject, field: string): string {
	const value = body[field];
	if (typeof value !== "string" || value.length === 0) {
		throw new Error(`Invalid xAI OAuth response field: ${field}`);
	}
	return value;
}

function positiveNumber(body: JsonObject, field: string): number {
	const value = body[field];
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		throw new Error(`Invalid xAI OAuth response field: ${field}`);
	}
	return value;
}

function validateVerificationUri(raw: string): string {
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error("Untrusted verification URI in xAI OAuth response");
	}
	if (url.protocol !== "https:") {
		throw new Error("Untrusted verification URI in xAI OAuth response");
	}
	return url.href;
}

async function postForm(
	url: string,
	fields: Record<string, string>,
	signal: AbortSignal,
): Promise<OAuthHttpResponse> {
	let response: Response;
	try {
		response = await fetch(url, {
			method: "POST",
			headers: {
				Accept: "application/json",
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams(fields),
			signal,
		});
	} catch (error) {
		if (signal.aborted) throw new Error(CANCEL_MESSAGE);
		throw error;
	}

	let body: JsonObject;
	try {
		const parsed = (await response.json()) as unknown;
		body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as JsonObject) : {};
	} catch {
		if (signal.aborted) throw new Error(CANCEL_MESSAGE);
		throw new Error(`xAI OAuth returned invalid JSON (HTTP ${response.status})`);
	}
	return { ok: response.ok, status: response.status, body };
}

function requestFailure(action: string, response: OAuthHttpResponse): Error {
	const error = typeof response.body.error === "string" ? response.body.error : undefined;
	const description =
		typeof response.body.error_description === "string" ? response.body.error_description : undefined;
	const detail = [error, description].filter(Boolean).join(": ");
	return new Error(`xAI OAuth ${action} failed (HTTP ${response.status})${detail ? `: ${detail}` : ""}`);
}

function parseDeviceCode(body: JsonObject): XaiDeviceCode {
	const interval = body.interval;
	const intervalSeconds =
		typeof interval === "number" && Number.isFinite(interval) && interval > 0 ? interval : undefined;
	const verificationUriComplete =
		typeof body.verification_uri_complete === "string" && body.verification_uri_complete.length > 0
			? validateVerificationUri(body.verification_uri_complete)
			: undefined;
	return {
		deviceCode: requiredString(body, "device_code"),
		userCode: requiredString(body, "user_code"),
		verificationUri: validateVerificationUri(requiredString(body, "verification_uri")),
		verificationUriComplete,
		intervalSeconds,
		expiresInSeconds: positiveNumber(body, "expires_in"),
	};
}

function credentialsFromTokenResponse(
	body: JsonObject,
	previousRefreshToken?: string,
): OAuthCredentials {
	const access = requiredString(body, "access_token");
	// xAI may omit refresh_token on refresh when the token is not rotated.
	const refresh =
		body.refresh_token === undefined && previousRefreshToken
			? previousRefreshToken
			: requiredString(body, "refresh_token");
	const expiresInSeconds =
		body.expires_in === undefined ? DEFAULT_TOKEN_LIFETIME_SECONDS : positiveNumber(body, "expires_in");
	return {
		access,
		refresh,
		expires: Date.now() + expiresInSeconds * 1000 - REFRESH_SKEW_MS,
	};
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error(CANCEL_MESSAGE));
			return;
		}
		const onAbort = () => {
			clearTimeout(timeout);
			reject(new Error(CANCEL_MESSAGE));
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, ms);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

async function requestDeviceCode(signal: AbortSignal): Promise<XaiDeviceCode> {
	const response = await postForm(
		XAI_DEVICE_CODE_URL,
		{
			client_id: XAI_CLIENT_ID,
			scope: XAI_SCOPE,
			referrer: "pi",
		},
		signal,
	);
	if (!response.ok) throw requestFailure("device authorization", response);
	return parseDeviceCode(response.body);
}

async function pollForTokens(device: XaiDeviceCode, signal: AbortSignal): Promise<OAuthCredentials> {
	const deadline = Date.now() + device.expiresInSeconds * 1000;
	let intervalMs = Math.max(
		MINIMUM_INTERVAL_MS,
		Math.floor((device.intervalSeconds ?? DEFAULT_POLL_INTERVAL_SECONDS) * 1000),
	);

	// RFC 8628: wait before first poll
	const remainingMs = deadline - Date.now();
	if (remainingMs > 0) {
		await abortableSleep(Math.min(intervalMs, remainingMs), signal);
	}

	while (Date.now() < deadline) {
		if (signal.aborted) throw new Error(CANCEL_MESSAGE);

		const response = await postForm(
			XAI_TOKEN_URL,
			{
				grant_type: "urn:ietf:params:oauth:grant-type:device_code",
				client_id: XAI_CLIENT_ID,
				device_code: device.deviceCode,
			},
			signal,
		);

		if (response.ok) {
			return credentialsFromTokenResponse(response.body);
		}

		const error = response.body.error;
		if (error === "authorization_pending") {
			/* continue */
		} else if (error === "slow_down") {
			const interval = response.body.interval;
			if (typeof interval === "number" && Number.isFinite(interval) && interval > 0) {
				intervalMs = Math.max(MINIMUM_INTERVAL_MS, Math.floor(interval * 1000));
			} else {
				intervalMs += SLOW_DOWN_INTERVAL_INCREMENT_MS;
			}
		} else if (error === "access_denied" || error === "authorization_denied") {
			throw new Error("xAI device authorization was denied");
		} else if (error === "expired_token") {
			throw new Error("xAI device code expired");
		} else {
			throw requestFailure("device token polling", response);
		}

		const sleepMs = Math.min(intervalMs, Math.max(0, deadline - Date.now()));
		if (sleepMs <= 0) break;
		await abortableSleep(sleepMs, signal);
	}

	throw new Error("Device flow timed out");
}

async function loginXaiNative(callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> {
	const signal = callbacks.signal ?? new AbortController().signal;
	const device = await requestDeviceCode(signal);
	const verificationUri = device.verificationUriComplete ?? device.verificationUri;

	callbacks.onDeviceCode?.({
		userCode: device.userCode,
		verificationUri,
		intervalSeconds: device.intervalSeconds,
		expiresInSeconds: device.expiresInSeconds,
	});
	// Also surface via onAuth for Pi UX that opens a browser from url.
	callbacks.onAuth?.({
		url: verificationUri,
		instructions: `Enter code ${device.userCode} at ${device.verificationUri}`,
	});
	callbacks.onProgress?.("Waiting for SuperGrok / X authorization…");

	return pollForTokens(device, signal);
}

async function refreshXaiNativeToken(
	refreshToken: string,
	signal: AbortSignal,
): Promise<OAuthCredentials> {
	const response = await postForm(
		XAI_TOKEN_URL,
		{
			grant_type: "refresh_token",
			client_id: XAI_CLIENT_ID,
			refresh_token: refreshToken,
		},
		signal,
	);
	if (!response.ok) throw requestFailure("token refresh", response);
	return credentialsFromTokenResponse(response.body, refreshToken);
}

/**
 * OAuth handlers matching `makeOmpOAuth` shape for `registerThinOmpProvider`.
 */
export function makeXaiNativeOAuth(displayName = "xAI Grok (SuperGrok OAuth)"): ThinOAuthHandlers {
	return {
		name: displayName,
		login: loginXaiNative,
		refreshToken: async (credentials, signal) => {
			if (!credentials.refresh) {
				throw new Error("xAI OAuth refresh failed: missing refresh token");
			}
			return refreshXaiNativeToken(credentials.refresh, signal);
		},
		getApiKey: (c) => c.access,
	};
}
