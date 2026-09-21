/**
 * Devin streamSimple — native Connect HTTP/1.1 GetChatMessage (no omp stream).
 */
import type { Api, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai/compat";
import {
	DEVIN_API_ID,
	DEVIN_API_URL,
	DEVIN_NATIVE_ENGINE,
	isDevinNativeReady,
	normalizeDevinSessionToken,
	streamDevinNative,
} from "./devin-native.ts";

export { DEVIN_API_URL, DEVIN_API_ID, DEVIN_NATIVE_ENGINE, normalizeDevinSessionToken };

type StreamContext = {
	messages: Array<{ role: string; content?: unknown; tools?: Tool[] }>;
	systemPrompt?: string | string[];
	tools?: Tool[];
};

export function streamSimpleDevin(
	model: Model<Api>,
	context: StreamContext,
	options?: SimpleStreamOptions,
) {
	return streamDevinNative(model, context, options);
}

export async function probeStreamDevinImport(): Promise<{
	ok: boolean;
	error?: string;
	engine?: string;
	runtime?: string;
}> {
	try {
		if (!isDevinNativeReady()) {
			return { ok: false, error: "devin native not ready", engine: DEVIN_NATIVE_ENGINE };
		}
		await import("@oh-my-pi/pi-catalog/discovery/protobuf");
		await import("@oh-my-pi/pi-catalog/discovery/devin-proto");
		return {
			ok: true,
			engine: DEVIN_NATIVE_ENGINE,
			runtime: typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun-or-shim" : "node",
		};
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			engine: DEVIN_NATIVE_ENGINE,
			runtime: typeof (globalThis as { Bun?: unknown }).Bun !== "undefined" ? "bun-or-shim" : "node",
		};
	}
}
