/**
 * Native ChatGPT Codex Responses stream (HTTP SSE).
 *
 * Endpoints / headers from oh-my-pi pi-catalog wire/codex + openai-codex-responses SSE path:
 *   POST https://chatgpt.com/backend-api/codex/responses
 *   Authorization: Bearer <access>
 *   chatgpt-account-id: <from JWT>
 *   OpenAI-Beta: responses=experimental
 *   originator: omp
 *   version: <CODEX_CLIENT_VERSION>
 *
 * Full WebSocket / compaction / attestation paths are deferred — this is the
 * viable native SSE subset used for chat turns.
 * Do NOT import @oh-my-pi/pi-ai/providers/* for streaming.
 */
import type { Api, AssistantMessage, Model, SimpleStreamOptions } from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import {
	createNativeOpenAIResponsesStreamSimple,
	streamNativeOpenAIResponses,
	type NativeStreamContext,
} from "../../shared/native-openai-responses.ts";

export const CODEX_NATIVE_ENGINE = "codex-native-responses-fetch-sse" as const;
export const CODEX_BASE_URL = "https://chatgpt.com/backend-api";
export const CODEX_CLIENT_VERSION = "0.153.0";
export const CODEX_RESPONSES_PATH = "/codex/responses";

const OPENAI_HEADERS = {
	BETA: "OpenAI-Beta",
	ACCOUNT_ID: "chatgpt-account-id",
	ORIGINATOR: "originator",
	VERSION: "version",
	SESSION_ID: "session_id",
	CONVERSATION_ID: "conversation_id",
	ROUTING_HINT: "x-codex-routing-hint",
	RESIDENCY: "x-openai-internal-codex-residency",
} as const;

const JWT_CLAIM_PATH = "https://api.openai.com/auth";

export function isCodexNativeReady(): boolean {
	return true;
}

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

/** Extract chatgpt_account_id from a Codex / ChatGPT OAuth JWT (omp wire/codex). */
export function getCodexAccountId(accessToken: string): string | undefined {
	try {
		const parts = accessToken.split(".");
		if (parts.length !== 3) return undefined;
		const b64 = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
		const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
		const decoded = Buffer.from(padded, "base64").toString("utf8");
		const payload = JSON.parse(decoded) as Record<string, unknown>;
		const auth = payload[JWT_CLAIM_PATH] as { chatgpt_account_id?: string } | undefined;
		return auth?.chatgpt_account_id ?? undefined;
	} catch {
		return undefined;
	}
}

/** Extract data residency claim when present (region-pinned enterprise). */
export function getCodexResidency(accessToken: string): string | undefined {
	try {
		const parts = accessToken.split(".");
		if (parts.length !== 3) return undefined;
		const b64 = (parts[1] ?? "").replace(/-/g, "+").replace(/_/g, "/");
		const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
		const decoded = Buffer.from(padded, "base64").toString("utf8");
		const payload = JSON.parse(decoded) as Record<string, unknown>;
		const auth = payload[JWT_CLAIM_PATH] as {
			chatgpt_data_residency?: unknown;
			chatgpt_compute_residency?: unknown;
		} | undefined;
		for (const claim of [auth?.chatgpt_data_residency, auth?.chatgpt_compute_residency]) {
			if (typeof claim === "string" && claim.trim()) return claim.trim();
		}
		return undefined;
	} catch {
		return undefined;
	}
}

export function buildCodexHeaders(
	accessToken: string,
	modelId: string,
	sessionId?: string,
): Record<string, string> {
	const headers: Record<string, string> = {
		Authorization: `Bearer ${accessToken}`,
		"Content-Type": "application/json",
		Accept: "text/event-stream",
		[OPENAI_HEADERS.BETA]: "responses=experimental",
		[OPENAI_HEADERS.ORIGINATOR]: "omp",
		[OPENAI_HEADERS.VERSION]: process.env.PI_CODEX_CLIENT_VERSION || CODEX_CLIENT_VERSION,
		"User-Agent": `omp-codex-native/${CODEX_CLIENT_VERSION}`,
		[OPENAI_HEADERS.ROUTING_HINT]: `model=${modelId}`,
	};
	const accountId = getCodexAccountId(accessToken);
	if (accountId) headers[OPENAI_HEADERS.ACCOUNT_ID] = accountId;
	const residency = getCodexResidency(accessToken);
	if (residency) headers[OPENAI_HEADERS.RESIDENCY] = residency;
	if (sessionId) {
		headers[OPENAI_HEADERS.CONVERSATION_ID] = sessionId;
		headers[OPENAI_HEADERS.SESSION_ID] = sessionId;
		headers["x-client-request-id"] = sessionId;
	}
	return headers;
}

export function resolveCodexResponsesUrl(baseUrl: string | undefined): string {
	const raw = baseUrl && baseUrl.trim().length > 0 ? baseUrl : CODEX_BASE_URL;
	const normalized = raw.replace(/\/+$/, "");
	if (normalized.endsWith("/codex/responses")) return normalized;
	if (normalized.endsWith("/codex")) return `${normalized}/responses`;
	return `${normalized}/codex/responses`;
}

/**
 * Stream Codex Responses over HTTP SSE (native).
 */
export function streamCodexNative(
	model: Model<Api>,
	context: NativeStreamContext,
	options?: SimpleStreamOptions,
) {
	const apiKey = options?.apiKey;
	if (!apiKey) {
		const out = createAssistantMessageEventStream();
		const error: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: emptyUsage(),
			stopReason: "error",
			errorMessage: "No Codex credentials. Run /login openai-codex-device.",
			timestamp: Date.now(),
		};
		queueMicrotask(() => {
			out.push({ type: "error", reason: "error", error });
			out.end();
		});
		return out;
	}

	const baseUrl = (model.baseUrl || CODEX_BASE_URL).replace(/\/+$/, "");
	const sessionId =
		(options as { sessionId?: string } | undefined)?.sessionId ?? crypto.randomUUID();
	const headers = {
		...buildCodexHeaders(apiKey, model.id, sessionId),
		...(options?.headers ?? {}),
	};

	// Base URL is chatgpt.com/backend-api; path /codex/responses (not /v1/responses).
	return streamNativeOpenAIResponses(
		{ ...model, baseUrl } as Model<Api>,
		context,
		{
			...options,
			headers,
			responsesPath: CODEX_RESPONSES_PATH,
			// Codex rejects store:true on some accounts; shared native defaults store:false.
		},
	);
}

export function createNativeCodexStreamSimple(opts?: { loginHint?: string; defaultBaseUrl?: string }) {
	const loginHint = opts?.loginHint ?? "/login openai-codex-device";
	const defaultBaseUrl = opts?.defaultBaseUrl ?? CODEX_BASE_URL;

	return function streamSimple(
		model: Model<Api>,
		context: NativeStreamContext,
		options?: SimpleStreamOptions,
	) {
		if (!options?.apiKey) {
			const out = createAssistantMessageEventStream();
			const error: AssistantMessage = {
				role: "assistant",
				content: [],
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: emptyUsage(),
				stopReason: "error",
				errorMessage: `No API key. Run ${loginHint}.`,
				timestamp: Date.now(),
			};
			queueMicrotask(() => {
				out.push({ type: "error", reason: "error", error });
				out.end();
			});
			return out;
		}
		const modelWithBase =
			model.baseUrl || !defaultBaseUrl
				? model
				: ({ ...model, baseUrl: defaultBaseUrl } as Model<Api>);
		return streamCodexNative(modelWithBase, context, options);
	};
}

/** Kept for callers that want the generic Responses factory with Codex path defaults. */
export function createCodexResponsesFactory() {
	return createNativeOpenAIResponsesStreamSimple({
		loginHint: "/login openai-codex-device",
		defaultBaseUrl: CODEX_BASE_URL,
		responsesPath: CODEX_RESPONSES_PATH,
	});
}
