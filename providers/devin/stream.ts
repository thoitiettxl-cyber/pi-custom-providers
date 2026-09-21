/**
 * Devin streamSimple — native Connect/protobuf not ready; omp fallback disabled.
 */
import type { Api, AssistantMessage, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { DEVIN_NATIVE_ENGINE, isDevinNativeReady } from "./devin-native.ts";

export const DEVIN_API_URL = "https://server.codeium.com";
export const DEVIN_API_ID = "devin-cascade" as const;

type StreamContext = {
	messages: Array<{ role: string; content?: unknown; tools?: Tool[] }>;
	systemPrompt?: string | string[];
	tools?: Tool[];
};

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

const UNAVAILABLE =
	`devin: native Connect/HTTP1+protobuf stream not ready (${DEVIN_NATIVE_ENGINE}). ` +
	`omp streamDevin fallback is disabled. Use xai-omp / google-antigravity / muse-code for native fetch/SSE.`;

export function normalizeDevinSessionToken(raw: string): string {
	const trimmed = raw.trim();
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as { token?: string; access?: string };
			return parsed.token || parsed.access || trimmed;
		} catch {
			return trimmed;
		}
	}
	return trimmed;
}

export function streamSimpleDevin(
	model: Model<Api>,
	_context: StreamContext,
	_options?: SimpleStreamOptions,
) {
	const out = createAssistantMessageEventStream();
	const error: AssistantMessage = {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason: "error",
		errorMessage: isDevinNativeReady()
			? `${DEVIN_NATIVE_ENGINE} reported ready but is not wired`
			: UNAVAILABLE,
		timestamp: Date.now(),
	};
	queueMicrotask(() => {
		out.push({ type: "error", reason: "error", error });
		out.end();
	});
	return out;
}

export async function probeStreamDevinImport(): Promise<{
	ok: boolean;
	error?: string;
	engine?: string;
	runtime?: string;
}> {
	return {
		ok: false,
		error: UNAVAILABLE,
		engine: DEVIN_NATIVE_ENGINE,
		runtime: typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun-or-shim" : "node",
	};
}
