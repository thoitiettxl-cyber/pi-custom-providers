/**
 * earendil streamSimple adapter for Cursor AgentService.
 *
 * Pi 0.86.1 loads extensions with Node+jiti. @oh-my-pi/pi-ai streamCursor assumes
 * Bun (Bun.env, bun:ffi, bun:sqlite, import.meta.dir). Strategy (TypeSafe hybrid):
 * 1. Install bun-shim before any omp import
 * 2. Prefer omp streamCursor when import succeeds (Bun host / patched Node)
 * 3. Structure for cursor-native.ts (Connect HTTP/2) to replace later
 *
 * Endpoints from oh-my-pi providers/cursor — do not invent Cursor API paths.
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
import { getDefaultCursorExecHandlers } from "./exec-handlers.ts";
import { CURSOR_NATIVE_ENGINE, isCursorNativeReady } from "./cursor-native.ts";
import { importOmp } from "../../shared/omp-import.ts";

export const CURSOR_API_URL = "https://api2.cursor.sh";
export const CURSOR_API_ID = "cursor-agent" as const;

type StreamContext = {
	messages: Array<{ role: string; content?: unknown; tools?: Tool[] }>;
	systemPrompt?: string | string[];
	tools?: Tool[];
};

type OmpStreamCursor = (
	model: unknown,
	context: unknown,
	options?: unknown,
) => AsyncIterable<AssistantMessageEvent> & {
	result?: () => Promise<AssistantMessage>;
};

let cachedStreamCursor: OmpStreamCursor | null | undefined;
let cachedEngine: string | undefined;
let cachedImportError: string | undefined;

async function loadStreamCursor(): Promise<OmpStreamCursor> {
	if (cachedStreamCursor) return cachedStreamCursor;
	if (cachedStreamCursor === null) {
		throw new Error(
			cachedImportError ??
				"@oh-my-pi/pi-ai streamCursor unavailable (previous import failed)",
		);
	}
	installBunShim();
	if (isCursorNativeReady()) {
		throw new Error(`${CURSOR_NATIVE_ENGINE} selected but not wired yet`);
	}
	try {
		const mod = await importOmp<{ streamCursor?: OmpStreamCursor }>("@oh-my-pi/pi-ai/providers/cursor");
		const fn = mod.streamCursor;
		if (typeof fn !== "function") {
			cachedStreamCursor = null;
			cachedImportError = "streamCursor export missing from @oh-my-pi/pi-ai/providers/cursor";
			throw new Error(cachedImportError);
		}
		cachedStreamCursor = fn;
		cachedEngine = "omp-streamCursor+bun-shim";
		return fn;
	} catch (err) {
		cachedStreamCursor = null;
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
	const extra = model as Model<Api> & {
		compat?: Record<string, unknown>;
		identity?: { class: string; family?: string; revision?: string };
	};
	return {
		id: model.id,
		name: model.name ?? model.id,
		api: CURSOR_API_ID,
		provider: "cursor",
		baseUrl: model.baseUrl || CURSOR_API_URL,
		reasoning: model.reasoning,
		input: model.input,
		cost: model.cost,
		contextWindow: model.contextWindow,
		maxTokens: model.maxTokens,
		// omp streamCursor / shared helpers require model.compat (even {}).
		compat: extra.compat ?? {},
		identity: extra.identity ?? { class: "unknown", family: model.id },
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

function errorAssistant(
	model: Model<Api>,
	errorMessage: string,
	stopReason: "error" | "aborted",
): AssistantMessage {
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

function retargetPartial(
	model: Model<Api>,
	partial: AssistantMessage | undefined,
): AssistantMessage | undefined {
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

/**
 * streamSimple for registerProvider("cursor").
 * Requires options.apiKey = Cursor access token (oauth getApiKey or CURSOR_ACCESS_TOKEN).
 */
export function streamSimpleCursor(
	model: Model<Api>,
	context: StreamContext,
	options?: SimpleStreamOptions,
) {
	const out = createAssistantMessageEventStream();

	(async () => {
		try {
			const apiKey = options?.apiKey;
			if (!apiKey) {
				throw new Error(
					"No Cursor access token. Run /login cursor or set CURSOR_ACCESS_TOKEN / CURSOR_API_KEY.",
				);
			}

			const streamCursor = await loadStreamCursor();
			const ompContext = {
				systemPrompt: extractSystemPrompt(context),
				messages: nonSystemMessages(context.messages),
				tools: extractTools(context),
			};

			const inner = streamCursor(toOmpModel(model), ompContext, {
				apiKey,
				signal: options?.signal,
				headers: options?.headers,
				externalToolExecutor: true,
				execHandlers: getDefaultCursorExecHandlers(),
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

export async function probeStreamCursorImport(): Promise<{
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
		await loadStreamCursor();
		return { ok: true, engine: cachedEngine ?? "omp-streamCursor+bun-shim", runtime };
	} catch (err) {
		return {
			ok: false,
			error: err instanceof Error ? err.message : String(err),
			engine: CURSOR_NATIVE_ENGINE,
			runtime,
		};
	}
}
