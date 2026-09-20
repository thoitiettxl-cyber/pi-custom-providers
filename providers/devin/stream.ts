/**
 * earendil streamSimple adapter for Devin/Cascade chat.
 *
 * Pi 0.86.1 loads extensions with Node+jiti. @oh-my-pi/pi-ai streamDevin assumes
 * Bun. TypeSafe hybrid: bun-shim + omp import now; devin-native.ts Connect later.
 *
 * Endpoints from oh-my-pi providers/devin — do not invent Devin API paths.
 * Tools: protobuf ChatToolCall → standard toolcall events (no Cursor execHandlers).
 */

import "./bun-shim.ts";
import { installBunShim } from "./bun-shim.ts";
installBunShim();

import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Model,
	SimpleStreamOptions,
	Tool,
} from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { normalizeDevinSessionToken } from "./oauth.ts";
import { DEVIN_NATIVE_ENGINE, isDevinNativeReady } from "./devin-native.ts";

export const DEVIN_API_URL = "https://server.codeium.com";
export const DEVIN_API_ID = "devin-agent" as const;

type StreamContext = {
	messages: Array<{ role: string; content?: unknown; tools?: Tool[] }>;
	systemPrompt?: string | string[];
	tools?: Tool[];
};

type OmpStreamDevin = (
	model: unknown,
	context: unknown,
	options?: unknown,
) => AsyncIterable<AssistantMessageEvent> & {
	result?: () => Promise<AssistantMessage>;
};

let cachedStreamDevin: OmpStreamDevin | null | undefined;
let cachedEngine: string | undefined;
let cachedImportError: string | undefined;

async function loadStreamDevin(): Promise<OmpStreamDevin> {
	if (cachedStreamDevin) return cachedStreamDevin;
	if (cachedStreamDevin === null) {
		throw new Error(
			cachedImportError ?? "@oh-my-pi/pi-ai streamDevin unavailable (previous import failed)",
		);
	}
	installBunShim();
	if (isDevinNativeReady()) {
		throw new Error(`${DEVIN_NATIVE_ENGINE} selected but not wired yet`);
	}
	try {
		const mod = await import("@oh-my-pi/pi-ai/providers/devin");
		const fn = (mod as { streamDevin?: OmpStreamDevin }).streamDevin;
		if (typeof fn !== "function") {
			cachedStreamDevin = null;
			cachedImportError = "streamDevin export missing from @oh-my-pi/pi-ai/providers/devin";
			throw new Error(cachedImportError);
		}
		cachedStreamDevin = fn;
		cachedEngine = "omp-streamDevin+bun-shim";
		return fn;
	} catch (err) {
		cachedStreamDevin = null;
		cachedImportError = err instanceof Error ? err.message : String(err);
		cachedEngine = undefined;
		throw err;
	}
}

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (block && typeof block === "object" && "type" in block && (block as { type: string }).type === "text") {
			const text = (block as { text?: string }).text;
			if (text) parts.push(text);
		}
	}
	return parts.join("\n");
}

function extractSystemPrompt(context: StreamContext): string[] | undefined {
	if (typeof context.systemPrompt === "string" && context.systemPrompt.trim()) {
		return [context.systemPrompt];
	}
	if (Array.isArray(context.systemPrompt) && context.systemPrompt.length) {
		return context.systemPrompt.filter((s) => typeof s === "string" && s.trim());
	}
	const parts: string[] = [];
	for (const msg of context.messages) {
		if (msg.role !== "system") continue;
		const text = contentToText(msg.content);
		if (text.trim()) parts.push(text);
	}
	return parts.length ? parts : undefined;
}

function extractTools(context: StreamContext): Tool[] | undefined {
	if (Array.isArray(context.tools) && context.tools.length) return context.tools;
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (msg?.role === "system" && Array.isArray(msg.tools) && msg.tools.length > 0) {
			return msg.tools;
		}
	}
	return undefined;
}

function nonSystemMessages(messages: StreamContext["messages"]) {
	return messages.filter((m) => m.role !== "system");
}

function toOmpModel(model: Model<Api>): Record<string, unknown> {
	return {
		id: model.id,
		name: model.name ?? model.id,
		api: DEVIN_API_ID,
		provider: "devin",
		baseUrl: model.baseUrl || DEVIN_API_URL,
		reasoning: model.reasoning,
		input: model.input,
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
	};
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

function retargetPartial(model: Model<Api>, partial: AssistantMessage | undefined): AssistantMessage | undefined {
	if (!partial) return partial;
	return {
		...partial,
		api: model.api,
		provider: model.provider,
		model: model.id,
	};
}

function mapEvent(model: Model<Api>, event: AssistantMessageEvent): AssistantMessageEvent | null {
	if ((event as { type: string }).type === "image_end") return null;
	switch (event.type) {
		case "start":
			return { type: "start", partial: retargetPartial(model, event.partial)! };
		case "text_start":
		case "thinking_start":
		case "toolcall_start":
		case "text_delta":
		case "thinking_delta":
		case "toolcall_delta":
		case "text_end":
		case "thinking_end":
		case "toolcall_end":
			return { ...event, partial: retargetPartial(model, event.partial)! };
		case "done": {
			const rawReason = (event as { reason: string }).reason;
			const reason = rawReason === "deferred" ? "stop" : event.reason;
			return {
				type: "done",
				reason: reason as "stop" | "length" | "toolUse",
				message: retargetPartial(model, event.message)!,
			};
		}
		case "error":
			return {
				type: "error",
				reason: event.reason,
				error: retargetPartial(model, event.error)!,
			};
		default:
			return event;
	}
}

export function streamSimpleDevin(model: Model<Api>, context: StreamContext, options?: SimpleStreamOptions) {
	const out = createAssistantMessageEventStream();

	(async () => {
		try {
			const rawKey = options?.apiKey;
			if (!rawKey) {
				throw new Error("No Devin session token. Run /login devin or set DEVIN_API_KEY.");
			}
			const apiKey = normalizeDevinSessionToken(rawKey);

			const streamDevin = await loadStreamDevin();
			const ompContext = {
				systemPrompt: extractSystemPrompt(context),
				messages: nonSystemMessages(context.messages),
				tools: extractTools(context),
			};

			const inner = streamDevin(toOmpModel(model), ompContext, {
				apiKey,
				signal: options?.signal,
				headers: options?.headers,
			});

			for await (const event of inner) {
				const mapped = mapEvent(model, event as AssistantMessageEvent);
				if (mapped) out.push(mapped);
			}
			out.end();
		} catch (err) {
			const aborted = Boolean(options?.signal?.aborted);
			const message = err instanceof Error ? err.message : String(err);
			const error = errorAssistant(model, message, aborted ? "aborted" : "error");
			out.push({ type: "error", reason: error.stopReason as "aborted" | "error", error });
			out.end();
		}
	})();

	return out;
}

export async function probeStreamDevinImport(): Promise<{
	ok: boolean;
	error?: string;
	engine?: string;
	runtime?: string;
}> {
	const runtime = typeof (globalThis as { Bun?: { version?: string } }).Bun?.version === "string"
		&& String((globalThis as { Bun?: { version?: string } }).Bun?.version).includes("node-shim")
		? "node+bun-shim"
		: typeof (globalThis as { Bun?: unknown }).Bun !== "undefined"
			? "bun-or-shim"
			: "node";
	try {
		installBunShim();
		await loadStreamDevin();
		return { ok: true, engine: cachedEngine ?? "omp-streamDevin+bun-shim", runtime };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			engine: DEVIN_NATIVE_ENGINE,
			runtime,
		};
	}
}
