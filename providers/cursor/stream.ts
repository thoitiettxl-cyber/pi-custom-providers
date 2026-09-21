/**
 * Cursor streamSimple — native Connect/protobuf not ready; omp fallback disabled.
 */
import type { Api, AssistantMessage, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { CURSOR_NATIVE_ENGINE, isCursorNativeReady } from "./cursor-native.ts";

export const CURSOR_API_URL = "https://api2.cursor.sh";
export const CURSOR_API_ID = "cursor-agent" as const;

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
	`cursor: native Connect/HTTP2+protobuf stream not ready (${CURSOR_NATIVE_ENGINE}). ` +
	`omp streamCursor fallback is disabled. Use xai-omp / google-antigravity / muse-code for native fetch/SSE.`;

export function streamSimpleCursor(
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
		errorMessage: isCursorNativeReady()
			? `${CURSOR_NATIVE_ENGINE} reported ready but is not wired`
			: UNAVAILABLE,
		timestamp: Date.now(),
	};
	queueMicrotask(() => {
		out.push({ type: "error", reason: "error", error });
		out.end();
	});
	return out;
}

export async function probeStreamCursorImport(): Promise<{
	ok: boolean;
	error?: string;
	engine?: string;
	runtime?: string;
}> {
	return {
		ok: false,
		error: UNAVAILABLE,
		engine: CURSOR_NATIVE_ENGINE,
		runtime: typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun-or-shim" : "node",
	};
}
