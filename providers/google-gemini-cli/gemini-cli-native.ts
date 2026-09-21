/**
 * Native Cloud Code Assist stream for google-gemini-cli (Node fetch/SSE).
 *
 * Wire format mirrors oh-my-pi google-gemini-cli (non-antigravity path):
 *   POST {endpoint}/v1internal:streamGenerateContent?alt=sse
 *   body: { project, model, request: { contents, systemInstruction?, … } }
 *   headers: GeminiCLI User-Agent + Client-Metadata (not Antigravity UA)
 *
 * Endpoints from omp: https://cloudcode-pa.googleapis.com
 * Do NOT import @oh-my-pi/pi-ai/providers/* for streaming.
 */
import { randomUUID } from "node:crypto";
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

export const GEMINI_CLI_NATIVE_ENGINE = "gemini-cli-native-cca-fetch-sse" as const;
export const GEMINI_CLI_DEFAULT_ENDPOINT = "https://cloudcode-pa.googleapis.com";
export const GEMINI_CLI_API_ID = "google-gemini-cli" as const;

export function isGeminiCliNativeReady(): boolean {
	return true;
}

type StreamContext = {
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

type GeminiPart = {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	inlineData?: { mimeType: string; data: string };
	functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
	functionResponse?: {
		name: string;
		response: Record<string, unknown>;
		id?: string;
		parts?: GeminiPart[];
	};
};

type GeminiContent = { role: string; parts: GeminiPart[] };

type CcaChunk = {
	response?: {
		candidates?: Array<{
			content?: { parts?: GeminiPart[] };
			finishReason?: string;
		}>;
		promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
		usageMetadata?: Record<string, number>;
	};
	error?: { code?: number; message?: string; status?: string };
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
		if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
			const text = (block as { text?: string }).text;
			if (text) parts.push(text);
		}
	}
	return parts.join("\n");
}

function extractSystemPrompt(context: StreamContext): string | undefined {
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

function extractTools(context: StreamContext): Tool[] | undefined {
	if (Array.isArray(context.tools) && context.tools.length) return context.tools;
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (msg?.role === "system" && Array.isArray(msg.tools) && msg.tools.length > 0) return msg.tools;
	}
	return undefined;
}

function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/g, "\uFFFD").replace(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, "\uFFFD");
}

function stripJsonSchemaMeta(schema: unknown): unknown {
	if (!schema || typeof schema !== "object") return schema;
	if (Array.isArray(schema)) return schema.map(stripJsonSchemaMeta);
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
		if (k === "$schema" || k === "$id" || k === "additionalProperties") continue;
		out[k] = stripJsonSchemaMeta(v);
	}
	return out;
}

function getGeminiCliUserAgent(modelId: string): string {
	const version = process.env.PI_AI_GEMINI_CLI_VERSION || "0.46.0";
	const platform = process.platform === "win32" ? "win32" : process.platform;
	const arch = process.arch === "x64" ? "x64" : process.arch;
	return `GeminiCLI/${version}/${modelId} (${platform}; ${arch}; terminal)`;
}

function getGeminiCliHeaders(modelId: string): Record<string, string> {
	return {
		"User-Agent": getGeminiCliUserAgent(modelId),
		"Client-Metadata": "ideType=IDE_UNSPECIFIED,platform=PLATFORM_UNSPECIFIED,pluginType=GEMINI",
	};
}

export function parseGeminiCliApiKey(apiKeyRaw: string): { token: string; projectId: string; email?: string } {
	let raw: unknown;
	try {
		raw = JSON.parse(apiKeyRaw);
	} catch {
		throw new Error("Invalid Google Gemini CLI credentials JSON. Run /login google-gemini-cli.");
	}
	if (!raw || typeof raw !== "object") {
		throw new Error("Invalid Google Gemini CLI credentials. Run /login google-gemini-cli.");
	}
	const obj = raw as Record<string, unknown>;
	const token =
		(typeof obj.token === "string" && obj.token) ||
		(typeof obj.access === "string" && obj.access) ||
		(typeof obj.access_token === "string" && obj.access_token) ||
		"";
	const projectId =
		(typeof obj.projectId === "string" && obj.projectId) ||
		(typeof obj.project_id === "string" && obj.project_id) ||
		"";
	if (!token || !projectId) {
		throw new Error("Missing token or projectId in Gemini CLI credentials. Run /login google-gemini-cli.");
	}
	const email = typeof obj.email === "string" && obj.email ? obj.email : undefined;
	return { token, projectId, email };
}

function convertTools(tools: Tool[]): { functionDeclarations: Record<string, unknown>[] }[] {
	return [
		{
			functionDeclarations: tools.map((tool) => ({
				name: tool.name,
				description: tool.description,
				parameters: stripJsonSchemaMeta(tool.parameters ?? { type: "object", properties: {} }),
			})),
		},
	];
}

function convertMessages(model: Model<Api>, messages: StreamContext["messages"]): GeminiContent[] {
	const contents: GeminiContent[] = [];
	const allowImage = Array.isArray(model.input) && model.input.includes("image");

	for (const msg of messages) {
		if (msg.role === "system") continue;

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				contents.push({ role: "user", parts: [{ text: sanitizeSurrogates(msg.content) }] });
			} else if (Array.isArray(msg.content)) {
				const parts: GeminiPart[] = [];
				for (const item of msg.content) {
					if (!item || typeof item !== "object") continue;
					const block = item as Record<string, unknown>;
					if (block.type === "text" && typeof block.text === "string") {
						parts.push({ text: sanitizeSurrogates(block.text) });
					} else if (block.type === "image" && allowImage && typeof block.data === "string") {
						parts.push({
							inlineData: {
								mimeType: typeof block.mimeType === "string" ? block.mimeType : "image/png",
								data: block.data,
							},
						});
					}
				}
				if (parts.length) contents.push({ role: "user", parts });
			}
			continue;
		}

		if (msg.role === "assistant") {
			const parts: GeminiPart[] = [];
			const content = msg.content;
			if (typeof content === "string") {
				if (content.trim()) parts.push({ text: sanitizeSurrogates(content) });
			} else if (Array.isArray(content)) {
				for (const block of content) {
					if (!block || typeof block !== "object") continue;
					const b = block as Record<string, unknown>;
					if (b.type === "text" && typeof b.text === "string") {
						parts.push({
							text: sanitizeSurrogates(b.text),
							...(typeof b.textSignature === "string" ? { thoughtSignature: b.textSignature } : {}),
						});
					} else if (b.type === "thinking" && typeof b.thinking === "string") {
						parts.push({
							thought: true,
							text: sanitizeSurrogates(b.thinking),
							...(typeof b.thinkingSignature === "string" ? { thoughtSignature: b.thinkingSignature } : {}),
						});
					} else if (b.type === "toolCall") {
						parts.push({
							functionCall: {
								name: String(b.name ?? "tool"),
								args: (b.arguments as Record<string, unknown>) ?? {},
								...(typeof b.id === "string" ? { id: b.id } : {}),
							},
						});
					}
				}
			}
			if (parts.length) contents.push({ role: "model", parts });
			continue;
		}

		if (msg.role === "toolResult") {
			const text = contentToText(msg.content);
			const responseValue = text || "(empty tool result)";
			const functionResponsePart: GeminiPart = {
				functionResponse: {
					name: msg.toolName || "tool",
					response: msg.isError ? { error: sanitizeSurrogates(responseValue) } : { output: sanitizeSurrogates(responseValue) },
					...(msg.toolCallId ? { id: msg.toolCallId } : {}),
				},
			};
			const last = contents[contents.length - 1];
			if (last?.role === "user" && last.parts.some((p) => p.functionResponse)) {
				last.parts.push(functionResponsePart);
			} else {
				contents.push({ role: "user", parts: [functionResponsePart] });
			}
		}
	}
	return contents;
}

function buildGeminiCliRequest(
	model: Model<Api>,
	context: StreamContext,
	projectId: string,
	options?: SimpleStreamOptions,
): Record<string, unknown> {
	const systemPrompt = extractSystemPrompt(context);
	const tools = extractTools(context);
	const contents = convertMessages(
		model,
		context.messages.filter((m) => m.role !== "system"),
	);

	const generationConfig: Record<string, unknown> = {};
	if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
	const maxTokens = options?.maxTokens ?? model.maxTokens;
	if (maxTokens) generationConfig.maxOutputTokens = maxTokens;
	if (model.reasoning) {
		generationConfig.thinkingConfig = { includeThoughts: true };
	}

	const request: Record<string, unknown> = { contents };
	if (systemPrompt?.trim()) {
		request.systemInstruction = { parts: [{ text: systemPrompt }] };
	}
	if (tools?.length) {
		request.tools = convertTools(tools);
	}
	if (Object.keys(generationConfig).length) {
		request.generationConfig = generationConfig;
	}

	// Non-antigravity CCA envelope (omp google-gemini-cli buildRequest else branch)
	return {
		project: projectId,
		model: model.id,
		request,
	};
}

async function* readSseJson(
	body: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncGenerator<CcaChunk> {
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
					yield JSON.parse(data) as CcaChunk;
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
 * Native streamSimple for google-gemini-cli.
 */
export function streamGeminiCliNative(
	model: Model<Api>,
	context: StreamContext,
	options?: SimpleStreamOptions,
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
			const apiKeyRaw = options?.apiKey;
			if (!apiKeyRaw) throw new Error("No Gemini CLI credentials. Run /login google-gemini-cli.");
			const creds = parseGeminiCliApiKey(apiKeyRaw);
			const endpoint = (model.baseUrl || GEMINI_CLI_DEFAULT_ENDPOINT).replace(/\/+$/, "");
			const requestBody = buildGeminiCliRequest(model, context, creds.projectId, options);
			const requestHeaders: Record<string, string> = {
				Authorization: `Bearer ${creds.token}`,
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				...getGeminiCliHeaders(model.id),
				...(options?.headers ?? {}),
			};

			stream.push({ type: "start", partial: output });

			const response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
				method: "POST",
				headers: requestHeaders,
				body: JSON.stringify(requestBody),
				signal: options?.signal,
			});
			if (!response.ok) {
				const errText = await response.text();
				throw new Error(
					`Cloud Code Assist API error (${response.status}): ${errText.slice(0, 800)} [model=${model.id} project=${creds.projectId}]`,
				);
			}
			if (!response.body) throw new Error("Cloud Code Assist returned empty body");

			let currentKind: "text" | "thinking" | null = null;
			const blockIndex = () => output.content.length - 1;

			const endCurrent = () => {
				if (currentKind === null) return;
				const idx = blockIndex();
				const block = output.content[idx];
				if (currentKind === "text" && block?.type === "text") {
					stream.push({ type: "text_end", contentIndex: idx, content: block.text, partial: output });
				} else if (currentKind === "thinking" && block?.type === "thinking") {
					stream.push({ type: "thinking_end", contentIndex: idx, content: block.thinking, partial: output });
				}
				currentKind = null;
			};

			const ensureText = (): TextContent => {
				if (currentKind !== "text") {
					endCurrent();
					const block: TextContent = { type: "text", text: "" };
					output.content.push(block);
					currentKind = "text";
					stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
					return block;
				}
				return output.content[blockIndex()] as TextContent;
			};

			const ensureThinking = (): ThinkingContent => {
				if (currentKind !== "thinking") {
					endCurrent();
					const block: ThinkingContent = { type: "thinking", thinking: "" };
					output.content.push(block);
					currentKind = "thinking";
					stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
					return block;
				}
				return output.content[blockIndex()] as ThinkingContent;
			};

			for await (const chunk of readSseJson(response.body, options?.signal)) {
				if (options?.signal?.aborted) {
					output.stopReason = "aborted";
					output.errorMessage = "Request was aborted";
					break;
				}
				if (chunk.error) {
					throw new Error(
						`Cloud Code Assist stream error: ${chunk.error.message || chunk.error.status || "unknown"}`,
					);
				}
				const responseData = chunk.response;
				if (!responseData) continue;

				if (!responseData.candidates?.length && responseData.promptFeedback?.blockReason) {
					const detail = responseData.promptFeedback.blockReasonMessage;
					throw new Error(
						`Request blocked by Google (${responseData.promptFeedback.blockReason})${detail ? `: ${detail}` : ""}`,
					);
				}

				const candidate = responseData.candidates?.[0];
				if (candidate?.content?.parts) {
					for (const part of candidate.content.parts) {
						if (part.text !== undefined && part.text !== "") {
							if (part.thought === true) {
								const block = ensureThinking();
								block.thinking += part.text;
								if (part.thoughtSignature) block.thinkingSignature = part.thoughtSignature;
								stream.push({
									type: "thinking_delta",
									contentIndex: blockIndex(),
									delta: part.text,
									partial: output,
								});
							} else {
								const block = ensureText();
								block.text += part.text;
								if (part.thoughtSignature) block.textSignature = part.thoughtSignature;
								stream.push({
									type: "text_delta",
									contentIndex: blockIndex(),
									delta: part.text,
									partial: output,
								});
							}
						}

						if (part.functionCall) {
							endCurrent();
							const providedId = part.functionCall.id;
							const needsNew =
								!providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);
							const toolCallId = needsNew
								? `call_${(part.functionCall.name || "tool").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}_${randomUUID().slice(0, 8)}`
								: providedId!;
							const argsJson = JSON.stringify(part.functionCall.args ?? {});
							const toolCall: ToolCall = {
								type: "toolCall",
								id: toolCallId,
								name: part.functionCall.name || "tool",
								arguments: part.functionCall.args ?? {},
							};
							output.content.push(toolCall);
							const idx = blockIndex();
							stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
							stream.push({ type: "toolcall_delta", contentIndex: idx, delta: argsJson, partial: output });
							stream.push({ type: "toolcall_end", contentIndex: idx, toolCall, partial: output });
							output.stopReason = "toolUse";
						}
					}
				}

				if (candidate?.finishReason && output.stopReason === "pending") {
					output.stopReason = candidate.finishReason === "MAX_TOKENS" ? "length" : "stop";
				}

				const usage = responseData.usageMetadata;
				if (usage) {
					const input = Number(usage.promptTokenCount ?? 0) || 0;
					const outputTok = Number(usage.candidatesTokenCount ?? 0) || 0;
					const total = Number(usage.totalTokenCount ?? input + outputTok) || 0;
					output.usage = {
						input,
						output: outputTok,
						cacheRead: 0,
						cacheWrite: 0,
						totalTokens: total,
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					};
				}
			}

			endCurrent();

			if (options?.signal?.aborted) {
				output.stopReason = "aborted";
				output.errorMessage = output.errorMessage ?? "Request was aborted";
			}
			if (output.stopReason === "pending") {
				output.stopReason = output.content.some((b) => b.type === "toolCall") ? "toolUse" : "stop";
			}

			if (output.stopReason === "error" || output.stopReason === "aborted") {
				stream.push({ type: "error", reason: output.stopReason, error: output });
			} else {
				stream.push({
					type: "done",
					reason: output.stopReason as "stop" | "length" | "toolUse",
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

export function createNativeGeminiCliStreamSimple(opts?: { loginHint?: string; defaultBaseUrl?: string }) {
	return function streamSimple(model: Model<Api>, context: StreamContext, options?: SimpleStreamOptions) {
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
				errorMessage: `No API key. Run ${opts?.loginHint ?? "/login google-gemini-cli"}.`,
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
		return streamGeminiCliNative(modelWithBase, context, options);
	};
}
