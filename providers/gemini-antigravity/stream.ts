/**
 * Native Cloud Code Assist stream for google-antigravity (Node + Bun).
 *
 * Published Pi 0.86.1 loads extensions with Node+jiti. @oh-my-pi/pi-ai assumes
 * Bun (Bun.env, import.meta.dir, package "bun"), so importing
 * streamGoogleGeminiCli throws "Bun is not defined" and Continuity memory
 * caches "previous import failed". This path uses fetch/SSE only.
 */

import "./bun-shim.ts";
import { installBunShim } from "./bun-shim.ts";
installBunShim();

import type { Api, AssistantMessage, AssistantMessageEvent, Model, SimpleStreamOptions, Tool } from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { resolveAntigravityModelMeta } from "./models.ts";
import { sanitizeToolsForCca } from "./schema-sanitize.ts";
import { streamAntigravity as streamNativeAntigravity } from "./cca-native.ts";

export const ANTIGRAVITY_API_URL = "https://daily-cloudcode-pa.googleapis.com";
export const ANTIGRAVITY_API_ID = "google-gemini-cli" as const;
export const ANTIGRAVITY_PROVIDER_ID = "google-antigravity" as const;

/** Duck-typed context: published Context or transcript-shaped. */
type StreamContext = {
	messages: Array<{ role: string; content?: unknown; tools?: Tool[] }>;
	systemPrompt?: string | string[];
	tools?: Tool[];
};

function extractSystemPrompt(context: StreamContext): string | undefined {
	if (typeof context.systemPrompt === "string" && context.systemPrompt.trim()) return context.systemPrompt;
	if (Array.isArray(context.systemPrompt) && context.systemPrompt.length) {
		return context.systemPrompt.filter((s) => typeof s === "string" && s.trim()).join("\n\n");
	}
	return undefined;
}

function extractTools(context: StreamContext): Tool[] | undefined {
	if (Array.isArray(context.tools) && context.tools.length) return context.tools;
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (msg?.role === "system" && Array.isArray(msg.tools) && msg.tools.length > 0) return msg.tools;
	}
	return undefined;
}

function nonSystemMessages(messages: StreamContext["messages"]) {
	return messages.filter((m) => m.role !== "system");
}

const WIRE_ID_FALLBACKS: Record<string, string> = {
	"gemini-3.1-pro": "gemini-3.1-pro-low",
	"gemini-3.1-pro-preview": "gemini-3.1-pro-low",
	"gemini-3-pro": "gemini-3-pro-low",
	"gemini-3-pro-preview": "gemini-3-pro-low",
	"gemini-3-flash": "gemini-3.5-flash-extra-low",
};

function withWireId(model: Model<Api>): Model<Api> {
	const meta = resolveAntigravityModelMeta(model.id);
	const wire = meta?.requestModelId ?? WIRE_ID_FALLBACKS[model.id] ?? model.id;
	if (wire === model.id) return model;
	return { ...model, id: wire } as Model<Api>;
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

function errorAssistant(model: Model<Api>, errorMessage: string, stopReason: "error" | "aborted"): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: emptyUsage(),
		stopReason,
		errorMessage,
		timestamp: Date.now(),
	} as AssistantMessage;
}

/**
 * streamSimple for registerProvider("google-antigravity").
 * Requires options.apiKey = structured JSON from getAntigravityApiKey.
 */
export function streamSimpleAntigravity(model: Model<Api>, context: StreamContext, options?: SimpleStreamOptions) {
	// Delegate to native CCA implementation (returns AssistantMessageEventStream).
	const systemPrompt = extractSystemPrompt(context);
	const tools = sanitizeToolsForCca(extractTools(context));
	const nativeContext = {
		systemPrompt,
		messages: nonSystemMessages(context.messages),
		tools,
	};
	try {
		if (!options?.apiKey) {
			const out = createAssistantMessageEventStream();
			const error = errorAssistant(model, "No Antigravity credentials. Run /login google-antigravity.", "error");
			queueMicrotask(() => {
				out.push({ type: "error", reason: "error", error });
				out.end();
			});
			return out;
		}
		return streamNativeAntigravity(withWireId(model), nativeContext as any, {
			apiKey: options.apiKey,
			signal: options.signal,
			headers: options.headers,
		});
	} catch (err) {
		const out = createAssistantMessageEventStream();
		const aborted = Boolean(options?.signal?.aborted);
		const message = err instanceof Error ? err.message : String(err);
		const error = errorAssistant(model, message, aborted ? "aborted" : "error");
		queueMicrotask(() => {
			out.push({ type: "error", reason: error.stopReason as "aborted" | "error", error });
			out.end();
		});
		return out;
	}
}

export { stripCcaUnsupportedSchemaFields, sanitizeToolsForCca } from "./schema-sanitize.ts";

/** Probe native CCA module (no @oh-my-pi). Name kept for /antigravity-provider-info. */
export async function probeStreamGoogleGeminiCliImport(): Promise<{ ok: boolean; error?: string; engine?: string }> {
	try {
		installBunShim();
		if (typeof streamNativeAntigravity !== "function") {
			return { ok: false, error: "streamAntigravity export missing from cca-native" };
		}
		return { ok: true, engine: "cca-native-fetch-sse" };
	} catch (err) {
		return { ok: false, error: err instanceof Error ? err.message : String(err) };
	}
}
