/**
 * Native Anthropic Messages API stream (fetch + SSE).
 * Used by zai-coding-plan and compatible Anthropic hosts.
 * Do NOT import omp pi-ai provider stream modules for streaming.
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
import type { NativeStreamContext } from "./native-openai-responses.ts";

export type NativeAnthropicMessagesOptions = SimpleStreamOptions & {
	extraBody?: Record<string, unknown>;
	messagesPath?: string;
	anthropicVersion?: string;
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
	if (typeof context.systemPrompt === "string" && context.systemPrompt.trim()) return context.systemPrompt;
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
		if (msg?.role === "system" && Array.isArray(msg.tools) && msg.tools.length > 0) return msg.tools;
	}
	return undefined;
}

function convertMessages(context: NativeStreamContext): Array<Record<string, unknown>> {
	const out: Array<Record<string, unknown>> = [];
	for (const msg of context.messages) {
		if (msg.role === "system") continue;
		if (msg.role === "user") {
			out.push({ role: "user", content: contentToText(msg.content) || "" });
			continue;
		}
		if (msg.role === "assistant") {
			const content = msg.content;
			const blocks: Array<Record<string, unknown>> = [];
			if (typeof content === "string") {
				if (content.trim()) blocks.push({ type: "text", text: content });
			} else if (Array.isArray(content)) {
				for (const raw of content) {
					if (!raw || typeof raw !== "object") continue;
					const block = raw as Record<string, unknown>;
					if (block.type === "text" && typeof block.text === "string") {
						blocks.push({ type: "text", text: block.text });
					} else if (block.type === "thinking" && typeof block.thinking === "string") {
						blocks.push({
							type: "thinking",
							thinking: block.thinking,
							...(typeof block.thinkingSignature === "string"
								? { signature: block.thinkingSignature }
								: {}),
						});
					} else if (block.type === "toolCall") {
						blocks.push({
							type: "tool_use",
							id: block.id,
							name: block.name,
							input: block.arguments ?? {},
						});
					}
				}
			}
			if (blocks.length) out.push({ role: "assistant", content: blocks });
			continue;
		}
		if (msg.role === "toolResult" || msg.role === "tool") {
			out.push({
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: msg.toolCallId ?? "unknown",
						content: contentToText(msg.content) || "",
						is_error: Boolean(msg.isError),
					},
				],
			});
		}
	}
	return out;
}

function convertTools(tools: Tool[] | undefined): Array<Record<string, unknown>> | undefined {
	if (!tools?.length) return undefined;
	return tools.map((tool) => ({
		name: tool.name,
		description: tool.description ?? "",
		input_schema: (tool as { parameters?: unknown }).parameters ?? {
			type: "object",
			properties: {},
		},
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

export function streamNativeAnthropicMessages(
	model: Model<Api>,
	context: NativeStreamContext,
	options?: NativeAnthropicMessagesOptions,
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

		try {
			const apiKey = options?.apiKey;
			if (!apiKey) throw new Error("No API key for Anthropic Messages stream");

			const baseUrl = (model.baseUrl || "").replace(/\/+$/, "") || "https://api.anthropic.com";
			const path = options?.messagesPath ?? "/v1/messages";
			const url = joinUrl(baseUrl, path);

			const system = extractSystemPrompt(context);
			const tools = convertTools(extractTools(context));
			const maxTokens = options?.maxTokens ?? model.maxTokens ?? 4096;
			const body: Record<string, unknown> = {
				model: model.id,
				messages: convertMessages(context),
				max_tokens: Math.max(1, maxTokens),
				stream: true,
				...(system ? { system } : {}),
				...(tools ? { tools } : {}),
				...(options?.temperature !== undefined ? { temperature: options.temperature } : {}),
				...(options?.extraBody ?? {}),
			};

			const headers: Record<string, string> = {
				"x-api-key": apiKey,
				Authorization: `Bearer ${apiKey}`,
				"anthropic-version": options?.anthropicVersion ?? "2023-06-01",
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
				throw new Error(`Anthropic Messages error (${response.status}): ${errText.slice(0, 800)}`);
			}
			if (!response.body) throw new Error("Anthropic Messages returned empty body");

			type Slot =
				| { kind: "text"; index: number; block: TextContent }
				| { kind: "thinking"; index: number; block: ThinkingContent }
				| { kind: "tool"; index: number; block: ToolCall; args: string };

			let current: Slot | null = null;

			const endCurrent = () => {
				if (!current) return;
				if (current.kind === "text") {
					stream.push({
						type: "text_end",
						contentIndex: current.index,
						content: current.block.text,
						partial: output,
					});
				} else if (current.kind === "thinking") {
					stream.push({
						type: "thinking_end",
						contentIndex: current.index,
						content: current.block.thinking,
						partial: output,
					});
				} else if (current.kind === "tool") {
					current.block.arguments = parseJsonObject(current.args);
					stream.push({
						type: "toolcall_end",
						contentIndex: current.index,
						toolCall: current.block,
						partial: output,
					});
					output.stopReason = "toolUse";
				}
				current = null;
			};

			for await (const event of readSseJson(response.body, options?.signal)) {
				if (options?.signal?.aborted) {
					output.stopReason = "aborted";
					output.errorMessage = "Request was aborted";
					break;
				}
				const type = typeof event.type === "string" ? event.type : "";

				if (type === "content_block_start") {
					endCurrent();
					const block = (event.content_block ?? {}) as Record<string, unknown>;
					const blockType = typeof block.type === "string" ? block.type : "";
					if (blockType === "text") {
						const textBlock: TextContent = { type: "text", text: "" };
						output.content.push(textBlock);
						current = { kind: "text", index: output.content.length - 1, block: textBlock };
						stream.push({ type: "text_start", contentIndex: current.index, partial: output });
					} else if (blockType === "thinking") {
						const thinkingBlock: ThinkingContent = { type: "thinking", thinking: "" };
						output.content.push(thinkingBlock);
						current = {
							kind: "thinking",
							index: output.content.length - 1,
							block: thinkingBlock,
						};
						stream.push({ type: "thinking_start", contentIndex: current.index, partial: output });
					} else if (blockType === "tool_use") {
						const toolBlock: ToolCall = {
							type: "toolCall",
							id: typeof block.id === "string" ? block.id : `tool_${output.content.length}`,
							name: typeof block.name === "string" ? block.name : "tool",
							arguments: {},
						};
						output.content.push(toolBlock);
						current = {
							kind: "tool",
							index: output.content.length - 1,
							block: toolBlock,
							args: "",
						};
						stream.push({ type: "toolcall_start", contentIndex: current.index, partial: output });
					}
					continue;
				}

				if (type === "content_block_delta") {
					const delta = (event.delta ?? {}) as Record<string, unknown>;
					const deltaType = typeof delta.type === "string" ? delta.type : "";
					if (deltaType === "text_delta" && typeof delta.text === "string" && current?.kind === "text") {
						current.block.text += delta.text;
						stream.push({
							type: "text_delta",
							contentIndex: current.index,
							delta: delta.text,
							partial: output,
						});
					} else if (
						(deltaType === "thinking_delta" || deltaType === "text_delta") &&
						typeof (delta.thinking ?? delta.text) === "string" &&
						current?.kind === "thinking"
					) {
						const piece = String(delta.thinking ?? delta.text);
						current.block.thinking += piece;
						stream.push({
							type: "thinking_delta",
							contentIndex: current.index,
							delta: piece,
							partial: output,
						});
					} else if (
						deltaType === "input_json_delta" &&
						typeof delta.partial_json === "string" &&
						current?.kind === "tool"
					) {
						current.args += delta.partial_json;
						current.block.arguments = parseJsonObject(current.args);
						stream.push({
							type: "toolcall_delta",
							contentIndex: current.index,
							delta: delta.partial_json,
							partial: output,
						});
					}
					continue;
				}

				if (type === "content_block_stop") {
					endCurrent();
					continue;
				}

				if (type === "message_delta") {
					const usage = (event.usage ?? {}) as Record<string, unknown>;
					const delta = (event.delta ?? {}) as Record<string, unknown>;
					if (usage && Object.keys(usage).length) {
						const outTokens = Number(usage.output_tokens ?? 0) || 0;
						output.usage = {
							...output.usage,
							output: outTokens,
							totalTokens: (output.usage.input || 0) + outTokens + (output.usage.cacheRead || 0),
						};
					}
					const stop = typeof delta.stop_reason === "string" ? delta.stop_reason : undefined;
					if (stop === "tool_use") output.stopReason = "toolUse";
					else if (stop === "max_tokens") output.stopReason = "length";
					else if (stop === "end_turn" || stop === "stop_sequence") output.stopReason = "stop";
					continue;
				}

				if (type === "message_start") {
					const message = (event.message ?? {}) as Record<string, unknown>;
					const usage = (message.usage ?? {}) as Record<string, unknown>;
					const inputTokens = Number(usage.input_tokens ?? 0) || 0;
					const cacheRead = Number(usage.cache_read_input_tokens ?? 0) || 0;
					const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0) || 0;
					output.usage = {
						input: Math.max(0, inputTokens - cacheRead),
						output: 0,
						cacheRead,
						cacheWrite,
						totalTokens: inputTokens,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					};
					continue;
				}

				if (type === "message_stop") {
					if (output.stopReason === "pending") {
						output.stopReason = output.content.some((b) => b.type === "toolCall")
							? "toolUse"
							: "stop";
					}
					continue;
				}

				if (type === "error") {
					const err = (event.error ?? {}) as Record<string, unknown>;
					throw new Error(
						(typeof err.message === "string" && err.message) || "Anthropic Messages stream error",
					);
				}
			}

			endCurrent();

			if (options?.signal?.aborted) {
				output.stopReason = "aborted";
				output.errorMessage = output.errorMessage ?? "Request was aborted";
			}
			if (output.stopReason === "pending") {
				if (output.content.length > 0) {
					output.stopReason = output.content.some((b) => b.type === "toolCall")
						? "toolUse"
						: "stop";
				} else {
					throw new Error("Anthropic Messages stream ended without content");
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

export function createNativeAnthropicMessagesStreamSimple(opts?: {
	loginHint?: string;
	defaultBaseUrl?: string;
	extraBody?: Record<string, unknown>;
	messagesPath?: string;
	anthropicVersion?: string;
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
		return streamNativeAnthropicMessages(modelWithBase, context, {
			...options,
			extraBody: opts?.extraBody,
			messagesPath: opts?.messagesPath,
			anthropicVersion: opts?.anthropicVersion,
		});
	};
}
