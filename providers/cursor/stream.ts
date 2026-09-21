/**
 * Cursor streamSimple — native HTTP/2 Connect AgentService/Run (no omp stream).
 */
import type { Api, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai/compat";
import {
	CURSOR_API_ID,
	CURSOR_API_URL,
	CURSOR_NATIVE_ENGINE,
	isCursorNativeReady,
	streamCursorNative,
} from "./cursor-native.ts";
import { createCursorExecHandlers } from "./exec-handlers.ts";

export { CURSOR_API_URL, CURSOR_API_ID, CURSOR_NATIVE_ENGINE };

type StreamContext = {
	messages: Array<{ role: string; content?: unknown; tools?: Tool[] }>;
	systemPrompt?: string | string[];
	tools?: Tool[];
};

export function streamSimpleCursor(
	model: Model<Api>,
	context: StreamContext,
	options?: SimpleStreamOptions,
) {
	return streamCursorNative(model, context, {
		...options,
		execHandlers: createCursorExecHandlers(),
	});
}

export async function probeStreamCursorImport(): Promise<{
	ok: boolean;
	error?: string;
	engine?: string;
	runtime?: string;
}> {
	try {
		if (!isCursorNativeReady()) {
			return { ok: false, error: "cursor native not ready", engine: CURSOR_NATIVE_ENGINE };
		}
		// Smoke: catalog proto modules resolve under Node/jiti
		await import("@oh-my-pi/pi-catalog/discovery/protobuf");
		await import("@oh-my-pi/pi-catalog/discovery/cursor-proto");
		return {
			ok: true,
			engine: CURSOR_NATIVE_ENGINE,
			runtime: typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun-or-shim" : "node",
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			engine: CURSOR_NATIVE_ENGINE,
			runtime: typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun-or-shim" : "node",
		};
	}
}
