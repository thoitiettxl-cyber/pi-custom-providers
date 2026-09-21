/**
 * Native OpenAI Responses API stream (fetch + SSE).
 * Earendil-compatible events via createAssistantMessageEventStream.
 * Do NOT use @oh-my-pi/pi-ai/providers/* for streaming.
 */
import type {
	Api,
	AssistantMessage,
	Model,
	SimpleStreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
	ToolCall,
} from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";

export type NativeStreamContext = {
	messages: Array<{
		role: string;
		content?: unknown;
		toolCallId?: string;
		toolName?: string;
		isError?: boolean;
		tools?: Tool[];
	}>;
	systemPrompt?: string | string[];
	tools?: Tool[];
};

export type NativeOpenAIResponsesOptions = SimpleStreamOptions & {
	extraBody?: Record<string, unknown>;
	responsesPath?: string;
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

function contentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (!block || typeof block !== "object") continue;
		const b = block as Record<string, unknown>;
		if (b.type === "text" && typeof b.text === "string") parts.push(b.text);
	}
	return parts.join("\n");
}

function extractSystemPrompt(context: NativeStreamContext): string | undefined {
	if (typeof context.systemPrompt === "string" && context.systemPrompt.trim()) {
		return context.systemPrompt;
	}
	if (Array.isArray(context.systemPrompt) && context.systemPrompt.length) {
		return context.systemPrompt.filter((s) => typeof s === "string" && s.trim()).join("\n\n");
	}
	const parts: string[] = [];
	for (const msg of context.messages) {
		if (msg.role !== "system") continue;
		const text = contentToText(msg.content);
		if (text.trim()) parts.push(text);
	}
	return parts.length ? parts.join("\n\n") : undefined;
}

function extractTools(context: NativeStreamContext): Tool[] | undefined {
	if (Array.isArray(context.tools) && context.tools.length) return context.tools;
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (msg?.role === "system" && Array.isArray(msg.tools) && msg.tools.length > 0) {
			return msg.tools;
		}
	}
	return undefined;
}

function imageUrlFromBlock(block: Record<string, unknown>): string | undefined {
	if (typeof block.url === "string") return block.url;
	if (typeof block.data === "string") {
		const mime = typeof block.mimeType === "string" ? block.mimeType : "image/png";
		return `data:${mime};base64,${block.data}`;
	}
	return undefined;
}

function convertUserContent(content: unknown): string | Array<Record<string, unknown>> {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return contentToText(content) || "";
	const parts: Array<Record<string, unknown>> = [];
	for (const raw of content) {
		if (!raw || typeof raw !== "object") continue;
		const block = raw as Record<string, unknown>;
		if (block.type === "text" && typeof block.text === "string") {
			parts.push({ type: "input_text", text: block.text });
		} else if (block.type === "image") {
			const url = imageUrlFromBlock(block);
			if (url) parts.push({ type: "input_image", detail: "auto", image_url: url });
		}
	}
	if (!parts.length) return contentToText(content) || "";
	if (parts.every((p) => p.type === "input_text")) {
		return parts.map((p) => String(p.text ?? "")).join("\n");
	}
	return parts;
}

function convertMessages(context: NativeStreamContext): Array<Record<string, unknown>> {
	const input: Array<Record<string, unknown>> = [];
	for (const msg of context.messages) {
		if (msg.role === "system") continue;
		if (msg.role === "user") {
			input.push({ role: "user", content: convertUserContent(msg.content) });
			continue;
		}
		if (msg.role === "assistant") {
			const content = msg.content;
			if (typeof content === "string") {
				if (content.trim()) {
					input.push({
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: content }],
					});
				}
				continue;
			}
			if (!Array.isArray(content)) continue;
			const textParts: Array<Record<string, unknown>> = [];
			for (const raw of content) {
				if (!raw || typeof raw !== "object") continue;
				const block = raw as Record<string, unknown>;
				if (block.type === "text" && typeof block.text === "string") {
					textParts.push({ type: "output_text", text: block.text });
				} else if (block.type === "toolCall") {
					if (textParts.length) {
						input.push({ type: "message", role: "assistant", content: [...textParts] });
						textParts.length = 0;
					}
					const args =
						typeof block.arguments === "string"
							? block.arguments
							: JSON.stringify(block.arguments ?? {});
					const callId = typeof block.id === "string" ? block.id : `call_${input.length}`;
					const [responseId, itemId] = callId.includes("|")
						? (callId.split("|", 2) as [string, string])
						: [callId, callId];
					input.push({
						type: "function_call",
						call_id: responseId,
						id: itemId || responseId,
						name: typeof block.name === "string" ? block.name : "tool",
						arguments: args,
					});
				}
			}
			if (textParts.length) {
				input.push({ type: "message", role: "assistant", content: textParts });
			}
			continue;
		}
		if (msg.role === "toolResult" || msg.role === "tool") {
			const callId = typeof msg.toolCallId === "string" ? msg.toolCallId : "";
			const responseId = callId.includes("|") ? callId.split("|", 2)[0]! : callId;
			input.push({
				type: "function_call_output",
				call_id: responseId || callId || "unknown",
				output: contentToText(msg.content) || (msg.isError ? "Error" : ""),
			});
		}
	}
	return input;
}

function convertTools(tools: Tool[] | undefined): Array<Record<string, unknown>> | undefined {
	if (!tools?.length) return undefined;
	return tools.map((tool) => ({
		type: "function",
		name: tool.name,
		description: tool.description ?? "",
		parameters: (tool as { parameters?: unknown }).parameters ?? {
			type: "object",
			properties: {},
		},
		strict: false,
	}));
}

function joinUrl(baseUrl: string, path: string): string {
	const base = baseUrl.replace(/\/+$/, "");
	const p = path.startsWith("/") ? path : `/${path}`;
	if (base.endsWith("/v1") && p.startsWith("/v1/")) return `${base}${p.slice(3)}`;
	return `${base}${p}`;
}

function parseJsonObject(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
			return parsed as Record<string, unknown>;
		}
	} catch {
		/* ignore */
	}
	return {};
}

async function* readSseJson(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<Record<string, unknown>> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			if (signal?.aborted) break;
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			for (;;) {
				const sep = buffer.indexOf("\n\n");
				if (sep < 0) break;
				const chunk = buffer.slice(0, sep);
				buffer = buffer.slice(sep + 2);
				const dataLines: string[] = [];
				for (const line of chunk.split("\n")) {
					const trimmed = line.replace(/\r$/, "");
					if (trimmed.startsWith("data:")) dataLines.push(trimmed.slice(5).trimStart());
				}
				if (!dataLines.length) continue;
				const data = dataLines.join("\n");
				if (data === "[DONE]") return;
				try {
					yield JSON.parse(data) as Record<string, unknown>;
				} catch {
					/* skip */
				}
			}
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {
			/* ignore */
		}
	}
}

/**
 * Stream against OpenAI-compatible `/responses` (xAI, Muse, OpenAI, …).
 */
export function streamNativeOpenAIResponses(
	model: Model<Api>,
	context: NativeStreamContext,
	options?: NativeOpenAIResponsesOptions,
) {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: emptyUsage(),
			stopReason: "pending",
			timestamp: Date.now(),
		};

		type Slot =
			| { kind: "text"; index: number; block: TextContent }
			| { kind: "thinking"; index: number; block: ThinkingContent }
			| { kind: "tool"; index: number; block: ToolCall; args: string; ended: boolean };

		const slots = new Map<number, Slot>();

		const endOpenTextThinking = () => {
			for (const [idx, slot] of [...slots.entries()]) {
				if (slot.kind === "text") {
					stream.push({
						type: "text_end",
						contentIndex: slot.index,
						content: slot.block.text,
						partial: output,
					});
					slots.delete(idx);
				} else if (slot.kind === "thinking") {
					stream.push({
						type: "thinking_end",
						contentIndex: slot.index,
						content: slot.block.thinking,
						partial: output,
					});
					slots.delete(idx);
				}
			}
		};

		try {
			const apiKey = options?.apiKey;
			if (!apiKey) throw new Error("No API key for OpenAI Responses stream");

			const baseUrl = (model.baseUrl || "").replace(/\/+$/, "") || "https://api.openai.com/v1";
			const path = options?.responsesPath ?? "/responses";
			const url = joinUrl(baseUrl, path);

			const instructions = extractSystemPrompt(context);
			const tools = convertTools(extractTools(context));
			const maxTokens = options?.maxTokens ?? model.maxTokens;
			const body: Record<string, unknown> = {
				model: model.id,
				input: convertMessages(context),
				stream: true,
				store: false,
				...(instructions ? { instructions } : {}),
				...(tools ? { tools } : {}),
				...(maxTokens ? { max_output_tokens: Math.max(16, maxTokens) } : {}),
				...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
				...(options?.extraBody ?? {}),
			};

			const headers: Record<string, string> = {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				...(options?.headers ?? {}),
			};

			stream.push({ type: "start", partial: output });

			const response = await fetch(url, {
				method: "POST",
				headers,
				body: JSON.stringify(body),
				signal: options?.signal,
			});

			if (!response.ok) {
				const errText = await response.text();
				throw new Error(`OpenAI Responses error (${response.status}): ${errText.slice(0, 800)}`);
			}
			if (!response.body) throw new Error("OpenAI Responses returned empty body");

			const ensureText = (outputIndex: number) => {
				const existing = slots.get(outputIndex);
				if (existing?.kind === "text") return existing;
				endOpenTextThinking();
				const block: TextContent = { type: "text", text: "" };
				output.content.push(block);
				const slot: Slot = { kind: "text", index: output.content.length - 1, block };
				slots.set(outputIndex, slot);
				stream.push({ type: "text_start", contentIndex: slot.index, partial: output });
				return slot;
			};

			const ensureThinking = (outputIndex: number) => {
				const existing = slots.get(outputIndex);
				if (existing?.kind === "thinking") return existing;
				endOpenTextThinking();
				const block: ThinkingContent = { type: "thinking", thinking: "" };
				output.content.push(block);
				const slot: Slot = { kind: "thinking", index: output.content.length - 1, block };
				slots.set(outputIndex, slot);
				stream.push({ type: "thinking_start", contentIndex: slot.index, partial: output });
				return slot;
			};

			const ensureTool = (outputIndex: number, item: Record<string, unknown>) => {
				const existing = slots.get(outputIndex);
				if (existing?.kind === "tool") return existing;
				endOpenTextThinking();
				const callId = typeof item.call_id === "string" ? item.call_id : `call_${outputIndex}`;
				const itemId = typeof item.id === "string" ? item.id : callId;
				const name = typeof item.name === "string" ? item.name : "tool";
				const args = typeof item.arguments === "string" ? item.arguments : "";
				const block: ToolCall = {
					type: "toolCall",
					id: `${callId}|${itemId}`,
					name,
					arguments: parseJsonObject(args),
				};
				output.content.push(block);
				const slot: Slot = {
					kind: "tool",
					index: output.content.length - 1,
					block,
					args,
					ended: false,
				};
				slots.set(outputIndex, slot);
				stream.push({ type: "toolcall_start", contentIndex: slot.index, partial: output });
				if (args) {
					stream.push({
						type: "toolcall_delta",
						contentIndex: slot.index,
						delta: args,
						partial: output,
					});
				}
				return slot;
			};

			const finishTool = (slot: Extract<Slot, { kind: "tool" }>, args?: string) => {
				if (slot.ended) return;
				if (args !== undefined) slot.args = args;
				slot.block.arguments = parseJsonObject(slot.args);
				slot.ended = true;
				stream.push({
					type: "toolcall_end",
					contentIndex: slot.index,
					toolCall: slot.block,
					partial: output,
				});
				output.stopReason = "toolUse";
			};

			const applyUsage = (usage: Record<string, unknown> | undefined) => {
				if (!usage) return;
				const inputTokens = Number(usage.input_tokens ?? usage.prompt_tokens ?? 0) || 0;
				const outputTokens = Number(usage.output_tokens ?? usage.completion_tokens ?? 0) || 0;
				const details = usage.input_tokens_details as Record<string, unknown> | undefined;
				const cached =
					Number(details?.cached_tokens ?? usage.cache_read_input_tokens ?? 0) || 0;
				const total = Number(usage.total_tokens ?? inputTokens + outputTokens) || 0;
				output.usage = {
					input: Math.max(0, inputTokens - cached),
					output: outputTokens,
					cacheRead: cached,
					cacheWrite: 0,
					totalTokens: total,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				};
			};

			let sawCompleted = false;

			for await (const event of readSseJson(response.body, options?.signal)) {
				if (options?.signal?.aborted) {
					output.stopReason = "aborted";
					output.errorMessage = "Request was aborted";
					break;
				}

				const type = typeof event.type === "string" ? event.type : "";

				if (type === "response.output_item.added" || type === "response.output_item.done") {
					const item = (event.item ?? {}) as Record<string, unknown>;
					const itemType = typeof item.type === "string" ? item.type : "";
					const idx = typeof event.output_index === "number" ? event.output_index : slots.size;
					if (itemType === "message") {
						ensureText(idx);
					} else if (itemType === "reasoning") {
						ensureThinking(idx);
					} else if (itemType === "function_call") {
						const slot = ensureTool(idx, item);
						if (type === "response.output_item.done") {
							finishTool(
								slot,
								typeof item.arguments === "string" ? item.arguments : undefined,
							);
						}
					}
					continue;
				}

				if (type === "response.output_text.delta" || type === "response.refusal.delta") {
					const delta = typeof event.delta === "string" ? event.delta : "";
					if (!delta) continue;
					const idx = typeof event.output_index === "number" ? event.output_index : 0;
					const slot = ensureText(idx);
					if (slot.kind !== "text") continue;
					slot.block.text += delta;
					stream.push({
						type: "text_delta",
						contentIndex: slot.index,
						delta,
						partial: output,
					});
					continue;
				}

				if (
					type === "response.reasoning_summary_text.delta" ||
					type === "response.reasoning_text.delta"
				) {
					const delta = typeof event.delta === "string" ? event.delta : "";
					if (!delta) continue;
					const idx = typeof event.output_index === "number" ? event.output_index : 0;
					const slot = ensureThinking(idx);
					if (slot.kind !== "thinking") continue;
					slot.block.thinking += delta;
					stream.push({
						type: "thinking_delta",
						contentIndex: slot.index,
						delta,
						partial: output,
					});
					continue;
				}

				if (type === "response.function_call_arguments.delta") {
					const delta = typeof event.delta === "string" ? event.delta : "";
					if (!delta) continue;
					const idx = typeof event.output_index === "number" ? event.output_index : 0;
					let slot = slots.get(idx);
					if (!slot || slot.kind !== "tool") {
						slot = ensureTool(idx, {
							call_id: typeof event.call_id === "string" ? event.call_id : `call_${idx}`,
							id: typeof event.item_id === "string" ? event.item_id : `fc_${idx}`,
							name: typeof event.name === "string" ? event.name : "tool",
							arguments: "",
						});
					}
					if (slot.kind !== "tool") continue;
					slot.args += delta;
					slot.block.arguments = parseJsonObject(slot.args);
					stream.push({
						type: "toolcall_delta",
						contentIndex: slot.index,
						delta,
						partial: output,
					});
					continue;
				}

				if (type === "response.function_call_arguments.done") {
					const idx = typeof event.output_index === "number" ? event.output_index : 0;
					const slot = slots.get(idx);
					if (slot?.kind === "tool") {
						finishTool(
							slot,
							typeof event.arguments === "string" ? event.arguments : undefined,
						);
					}
					continue;
				}

				if (type === "response.completed" || type === "response.incomplete") {
					sawCompleted = true;
					const responseObj = (event.response ?? {}) as Record<string, unknown>;
					applyUsage(responseObj.usage as Record<string, unknown> | undefined);
					const status = typeof responseObj.status === "string" ? responseObj.status : type;
					if (output.stopReason === "pending") {
						if (output.content.some((b) => b.type === "toolCall")) {
							output.stopReason = "toolUse";
						} else if (status === "incomplete" || type === "response.incomplete") {
							output.stopReason = "length";
						} else {
							output.stopReason = "stop";
						}
					}
					continue;
				}

				if (type === "response.failed" || type === "error") {
					const responseObj = (event.response ?? event) as Record<string, unknown>;
					const err = (responseObj.error ?? event.error ?? {}) as Record<string, unknown>;
					const message =
						(typeof err.message === "string" && err.message) ||
						(typeof event.message === "string" && event.message) ||
						"OpenAI Responses stream failed";
					throw new Error(message);
				}

				if (event.usage && typeof event.usage === "object") {
					applyUsage(event.usage as Record<string, unknown>);
				}
			}

			endOpenTextThinking();

			if (options?.signal?.aborted) {
				output.stopReason = "aborted";
				output.errorMessage = output.errorMessage ?? "Request was aborted";
			}

			if (output.stopReason === "pending") {
				if (sawCompleted || output.content.length > 0) {
					output.stopReason = output.content.some((b) => b.type === "toolCall")
						? "toolUse"
						: "stop";
				} else {
					throw new Error("OpenAI Responses stream ended without content or completion");
				}
			}

			if (output.stopReason === "error" || output.stopReason === "aborted") {
				stream.push({ type: "error", reason: output.stopReason, error: output });
			} else {
				stream.push({
					type: "done",
					reason: output.stopReason as "stop" | "length" | "toolUse" | "deferred",
					message: output,
				});
			}
			stream.end();
		} catch (error) {
			output.stopReason = options?.signal?.aborted ? "aborted" : "error";
			output.errorMessage = error instanceof Error ? error.message : String(error);
			stream.push({ type: "error", reason: output.stopReason, error: output });
			stream.end();
		}
	})();

	return stream;
}

/** Factory matching registerProvider streamSimple signature. */
export function createNativeOpenAIResponsesStreamSimple(opts?: {
	loginHint?: string;
	defaultBaseUrl?: string;
	extraBody?: Record<string, unknown>;
	responsesPath?: string;
}) {
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
				errorMessage: `No API key. Run ${opts?.loginHint ?? "/login"}.`,
				timestamp: Date.now(),
			};
			queueMicrotask(() => {
				out.push({ type: "error", reason: "error", error });
				out.end();
			});
			return out;
		}
		const modelWithBase =
			model.baseUrl || !opts?.defaultBaseUrl
				? model
				: ({ ...model, baseUrl: opts.defaultBaseUrl } as Model<Api>);
		return streamNativeOpenAIResponses(modelWithBase, context, {
			...options,
			extraBody: opts?.extraBody,
			responsesPath: opts?.responsesPath,
		});
	};
}
