/**
 * Native Devin/Cascade Connect stream (HTTP/1.1 + protobuf GetChatMessage).
 *
 * Endpoints from oh-my-pi wire/devin + providers/devin.ts:
 *   POST https://server.codeium.com/exa.api_server_pb.ApiServerService/GetChatMessage
 *   content-type: application/connect+proto
 *   Optional: GetUserJwt + AssignModel for router models
 *
 * Protobuf codecs come from @oh-my-pi/pi-catalog/discovery (catalog, not pi-ai
 * provider streams). Do NOT import @oh-my-pi/pi-ai/providers/* for streaming.
 */
import { gunzipSync, gzipSync } from "node:zlib";
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

export const DEVIN_NATIVE_ENGINE = "devin-native-connect-http1-protobuf" as const;
export const DEVIN_API_URL = "https://server.codeium.com";
export const DEVIN_API_ID = "devin-agent" as const;

const CHAT_MESSAGE_PATH = "/exa.api_server_pb.ApiServerService/GetChatMessage";
const DEVIN_AUTH_PATH = "/exa.auth_pb.AuthService/GetUserJwt";
const DEVIN_ASSIGN_MODEL_PATH = "/exa.api_server_pb.ApiServerService/AssignModel";
const CONNECT_COMPRESSED_FLAG = 0b00000001;
const CONNECT_END_STREAM_FLAG = 0b00000010;
const MAX_CONNECT_FRAME_PAYLOAD = 32 * 1024 * 1024;
const DEVIN_SESSION_TOKEN_PREFIX = "devin-session-token$";
const DEVIN_DEFAULT_STOP_PATTERNS = ["<|user|>", "<|bot|>", "<|context_request|>", "<|endoftext|>", "<|end_of_turn|>"];

export function isDevinNativeReady(): boolean {
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

export function normalizeDevinSessionToken(raw: string | undefined): string {
	if (!raw) return "";
	const trimmed = raw.trim();
	let token = trimmed;
	if (trimmed.startsWith("{")) {
		try {
			const parsed = JSON.parse(trimmed) as { token?: string; access?: string };
			token = parsed.token || parsed.access || trimmed;
		} catch {
			/* keep */
		}
	}
	return token.startsWith(DEVIN_SESSION_TOKEN_PREFIX) ? token : `${DEVIN_SESSION_TOKEN_PREFIX}${token}`;
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

function extractSystemPrompt(context: StreamContext): string {
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
	return parts.join("\n\n");
}

function extractTools(context: StreamContext): Tool[] {
	if (Array.isArray(context.tools) && context.tools.length) return context.tools;
	for (let i = context.messages.length - 1; i >= 0; i--) {
		const msg = context.messages[i];
		if (msg?.role === "system" && Array.isArray(msg.tools) && msg.tools.length > 0) return msg.tools;
	}
	return [];
}

function frameConnectMessage(data: Uint8Array, flags = 0): Buffer {
	const frame = Buffer.alloc(5 + data.length);
	frame[0] = flags;
	frame.writeUInt32BE(data.length, 1);
	frame.set(data, 5);
	return frame;
}

function readConnectTrailerError(raw: string): string | null {
	try {
		const payload = JSON.parse(raw) as { error?: { code?: string; message?: string } };
		if (!payload?.error) return null;
		const code = payload.error.code ?? "unknown";
		const message = payload.error.message ?? "Unknown error";
		return `Connect error ${code}: ${message}`;
	} catch {
		return raw ? `Connect trailer: ${raw.slice(0, 400)}` : null;
	}
}

function parseJsonObject(raw: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(raw);
		if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
	} catch {
		/* ignore */
	}
	return {};
}

type ProtoMod = {
	create: (codec: unknown, value?: unknown) => unknown;
	toBinary: (codec: unknown, value: unknown) => Uint8Array;
	fromBinary: (codec: unknown, value: Uint8Array) => unknown;
};

type DevinProto = {
	GetChatMessageRequestSchema: unknown;
	GetChatMessageResponseSchema: unknown;
	MetadataSchema: unknown;
	ChatMessagePromptSchema: unknown;
	ChatToolDefinitionSchema: unknown;
	ChatToolChoiceSchema: unknown;
	CompletionConfigurationSchema: unknown;
	PromptCacheOptionsSchema: unknown;
	GetUserJwtRequestSchema: unknown;
	GetUserJwtResponseSchema: unknown;
	AssignModelRequestSchema: unknown;
	AssignModelResponseSchema: unknown;
	ImageDataSchema: unknown;
	ChatMessageRequestType: { CASCADE: number };
	ConversationalPlannerMode: { DEFAULT: number };
	ChatMessageSource: { USER: number; SYSTEM: number; TOOL: number };
	CacheControlType: { EPHEMERAL: number };
};

let protoCache: { proto: DevinProto; pb: ProtoMod } | null = null;

async function loadDevinProto(): Promise<{ proto: DevinProto; pb: ProtoMod }> {
	if (protoCache) return protoCache;
	const [pb, proto] = await Promise.all([
		import("@oh-my-pi/pi-catalog/discovery/protobuf") as Promise<ProtoMod>,
		import("@oh-my-pi/pi-catalog/discovery/devin-proto") as Promise<DevinProto>,
	]);
	protoCache = { proto, pb };
	return protoCache;
}

function cliMetadata(apiKey: string | undefined, userJwt = "") {
	const os = process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "windows" : "linux";
	return {
		apiKey: normalizeDevinSessionToken(apiKey),
		userJwt,
		ideName: "devin-cli",
		ideType: "chisel",
		ideVersion: "3000.6.2",
		extensionName: "chisel",
		extensionVersion: "3000.6.2",
		locale: "en",
		os,
	};
}

async function fetchUserJwt(
	apiKey: string | undefined,
	baseUrl: string,
	pb: ProtoMod,
	proto: DevinProto,
	signal?: AbortSignal,
): Promise<{ userJwt: string; baseUrl?: string }> {
	try {
		const request = pb.create(proto.GetUserJwtRequestSchema, {
			metadata: pb.create(proto.MetadataSchema, cliMetadata(apiKey)),
		});
		const body = pb.toBinary(proto.GetUserJwtRequestSchema, request);
		const gz = gzipSync(body);
		const response = await fetch(`${baseUrl}${DEVIN_AUTH_PATH}`, {
			method: "POST",
			headers: {
				"content-type": "application/connect+proto",
				"connect-protocol-version": "1",
				"connect-content-encoding": "gzip",
				"accept-encoding": "identity",
				"user-agent": "connect-go/1.18.1 (go1.26.3)",
				"connect-accept-encoding": "gzip",
			},
			body: frameConnectMessage(gz, CONNECT_COMPRESSED_FLAG),
			signal,
		});
		if (!response.ok) return { userJwt: "" };
		const buf = Buffer.from(await response.arrayBuffer());
		if (buf.length < 5) return { userJwt: "" };
		const flag = buf[0];
		const len = buf.readUInt32BE(1);
		const payload = buf.subarray(5, 5 + len);
		const raw = flag & CONNECT_COMPRESSED_FLAG ? gunzipSync(payload) : payload;
		const msg = pb.fromBinary(proto.GetUserJwtResponseSchema, raw) as {
			jwt?: string;
			apiServerUrl?: string;
		};
		return {
			userJwt: typeof msg.jwt === "string" ? msg.jwt : "",
			baseUrl: typeof msg.apiServerUrl === "string" ? msg.apiServerUrl.replace(/\/+$/, "") : undefined,
		};
	} catch {
		return { userJwt: "" };
	}
}

function buildChatMessagePrompts(
	messages: StreamContext["messages"],
	cascadeId: string,
	pb: ProtoMod,
	proto: DevinProto,
): unknown[] {
	const prompts: unknown[] = [];
	let index = 0;
	for (const msg of messages) {
		if (msg.role === "system") continue;
		const messageId = `${cascadeId}-${index++}-${msg.role}`;
		if (msg.role === "user" || msg.role === "developer") {
			prompts.push(
				pb.create(proto.ChatMessagePromptSchema, {
					messageId,
					source: proto.ChatMessageSource.USER,
					prompt: contentToText(msg.content),
					images: [],
				}),
			);
		} else if (msg.role === "assistant") {
			const text = contentToText(msg.content);
			const toolCalls: unknown[] = [];
			if (Array.isArray(msg.content)) {
				for (const block of msg.content) {
					if (!block || typeof block !== "object") continue;
					const b = block as Record<string, unknown>;
					if (b.type === "toolCall") {
						toolCalls.push({
							id: String(b.id ?? ""),
							name: String(b.name ?? "tool"),
							argumentsJson: JSON.stringify(b.arguments ?? {}),
						});
					}
				}
			}
			prompts.push(
				pb.create(proto.ChatMessagePromptSchema, {
					messageId,
					source: proto.ChatMessageSource.SYSTEM,
					prompt: text,
					toolCalls,
					images: [],
				}),
			);
		} else if (msg.role === "toolResult") {
			prompts.push(
				pb.create(proto.ChatMessagePromptSchema, {
					messageId,
					source: proto.ChatMessageSource.TOOL,
					prompt: contentToText(msg.content),
					toolCallId: msg.toolCallId ?? "",
					images: [],
				}),
			);
		}
	}
	return prompts;
}

/**
 * Native Devin GetChatMessage stream.
 */
export function streamDevinNative(
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

		let currentTextBlock: TextContent | null = null;
		let currentThinkingBlock: ThinkingContent | null = null;
		const toolBlocks = new Map<string, ToolCall>();
		const toolPartialJson = new Map<string, string>();

		const endTextBlock = () => {
			if (!currentTextBlock) return;
			const block = currentTextBlock;
			currentTextBlock = null;
			stream.push({
				type: "text_end",
				contentIndex: output.content.indexOf(block),
				content: block.text,
				partial: output,
			});
		};
		const endThinkingBlock = () => {
			if (!currentThinkingBlock) return;
			const block = currentThinkingBlock;
			currentThinkingBlock = null;
			stream.push({
				type: "thinking_end",
				contentIndex: output.content.indexOf(block),
				content: block.thinking,
				partial: output,
			});
		};

		try {
			const apiKey = options?.apiKey;
			if (!apiKey) throw new Error("No Devin credentials. Run /login devin.");

			const { proto, pb } = await loadDevinProto();
			let baseUrl = (model.baseUrl || DEVIN_API_URL).replace(/\/+$/, "");
			const auth = await fetchUserJwt(apiKey, baseUrl, pb, proto, options?.signal);
			if (auth.baseUrl) baseUrl = auth.baseUrl;

			const cascadeId =
				(options as { sessionId?: string; conversationId?: string } | undefined)?.conversationId ??
				(options as { sessionId?: string } | undefined)?.sessionId ??
				crypto.randomUUID();

			const tools = extractTools(context).map((tool) =>
				pb.create(proto.ChatToolDefinitionSchema, {
					name: tool.name,
					description: tool.description,
					jsonSchemaString: JSON.stringify(tool.parameters ?? { type: "object", properties: {} }),
					strict: tool.strict ?? false,
				}),
			);

			const request = pb.create(proto.GetChatMessageRequestSchema, {
				metadata: pb.create(proto.MetadataSchema, cliMetadata(apiKey, auth.userJwt)),
				prompt: extractSystemPrompt(context),
				chatMessagePrompts: buildChatMessagePrompts(
					context.messages.filter((m) => m.role !== "system"),
					cascadeId,
					pb,
					proto,
				),
				chatModelUid: model.id,
				requestType: proto.ChatMessageRequestType.CASCADE,
				plannerMode: proto.ConversationalPlannerMode.DEFAULT,
				toolChoice: pb.create(proto.ChatToolChoiceSchema, {
					choice: { case: "optionName", value: "auto" },
				}),
				systemPromptCacheOptions: pb.create(proto.PromptCacheOptionsSchema, {
					type: proto.CacheControlType.EPHEMERAL,
				}),
				disableParallelToolCalls: true,
				cascadeId,
				executionId: crypto.randomUUID(),
				configuration: pb.create(proto.CompletionConfigurationSchema, {
					numCompletions: 1n,
					maxTokens: BigInt(options?.maxTokens ?? model.maxTokens ?? 64000),
					maxNewlines: 200n,
					temperature: options?.temperature ?? 0.4,
					firstTemperature: options?.temperature ?? 0.4,
					topK: 50n,
					topP: 1,
					stopPatterns: DEVIN_DEFAULT_STOP_PATTERNS,
					fimEotProbThreshold: 1,
				}),
				tools,
			});

			const reqBytes = pb.toBinary(proto.GetChatMessageRequestSchema, request);
			const gz = gzipSync(reqBytes);

			const response = await fetch(`${baseUrl}${CHAT_MESSAGE_PATH}`, {
				method: "POST",
				headers: {
					"content-type": "application/connect+proto",
					"connect-protocol-version": "1",
					"connect-content-encoding": "gzip",
					"accept-encoding": "identity",
					"user-agent": "connect-go/1.18.1 (go1.26.3)",
					"connect-accept-encoding": "gzip",
					...(options?.headers ?? {}),
				},
				body: frameConnectMessage(gz, CONNECT_COMPRESSED_FLAG),
				signal: options?.signal,
			});

			if (!response.ok) {
				const detail = Buffer.from(await response.arrayBuffer()).toString("utf8").slice(0, 400);
				throw new Error(`Devin API error (${response.status}): ${detail}`);
			}
			if (!response.body) throw new Error("Devin API error: response body is empty");

			stream.push({ type: "start", partial: output });

			const reader = response.body.getReader();
			let pending = Buffer.alloc(0);

			for (;;) {
				const { done, value } = await reader.read();
				if (value && value.length > 0) {
					pending =
						pending.length === 0
							? Buffer.from(value.buffer, value.byteOffset, value.byteLength)
							: Buffer.concat([pending, value]);
				}
				while (pending.length >= 5) {
					const flag = pending[0];
					const len = pending.readUInt32BE(1);
					if (len > MAX_CONNECT_FRAME_PAYLOAD) {
						throw new Error(`Devin Connect frame length ${len} exceeds cap`);
					}
					if (pending.length < 5 + len) break;
					const payload = pending.subarray(5, 5 + len);
					pending = pending.subarray(5 + len);

					if (flag & CONNECT_END_STREAM_FLAG) {
						const trailerBytes = flag & CONNECT_COMPRESSED_FLAG ? gunzipSync(payload) : payload;
						const trailerError = readConnectTrailerError(trailerBytes.toString("utf8").trim());
						if (trailerError) throw new Error(trailerError);
						continue;
					}

					const raw = flag & CONNECT_COMPRESSED_FLAG ? gunzipSync(payload) : payload;
					const msg = pb.fromBinary(proto.GetChatMessageResponseSchema, raw) as {
						deltaThinking?: string;
						deltaSignature?: string;
						deltaText?: string;
						deltaToolCalls?: Array<{ id?: string; name?: string; argumentsJson?: string }>;
						promptTokens?: number | bigint;
						completionTokens?: number | bigint;
					};

					if (msg.deltaThinking) {
						endTextBlock();
						const block: ThinkingContent = currentThinkingBlock ?? { type: "thinking", thinking: "" };
						if (currentThinkingBlock !== block) {
							output.content.push(block);
							currentThinkingBlock = block;
							stream.push({
								type: "thinking_start",
								contentIndex: output.content.length - 1,
								partial: output,
							});
						}
						block.thinking += msg.deltaThinking;
						if (msg.deltaSignature) block.thinkingSignature = msg.deltaSignature;
						stream.push({
							type: "thinking_delta",
							contentIndex: output.content.indexOf(block),
							delta: msg.deltaThinking,
							partial: output,
						});
					}

					if (msg.deltaText) {
						endThinkingBlock();
						const block: TextContent = currentTextBlock ?? { type: "text", text: "" };
						if (currentTextBlock !== block) {
							output.content.push(block);
							currentTextBlock = block;
							stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
						}
						block.text += msg.deltaText;
						stream.push({
							type: "text_delta",
							contentIndex: output.content.indexOf(block),
							delta: msg.deltaText,
							partial: output,
						});
					}

					if (msg.deltaToolCalls && msg.deltaToolCalls.length > 0) {
						endTextBlock();
						endThinkingBlock();
						for (const tc of msg.deltaToolCalls) {
							const toolCallId = tc.id || crypto.randomUUID();
							let block = toolBlocks.get(toolCallId);
							if (!block) {
								block = { type: "toolCall", id: toolCallId, name: tc.name || "tool", arguments: {} };
								output.content.push(block);
								toolBlocks.set(toolCallId, block);
								toolPartialJson.set(toolCallId, "");
								stream.push({
									type: "toolcall_start",
									contentIndex: output.content.length - 1,
									partial: output,
								});
							}
							if (tc.name) block.name = tc.name;
							if (tc.argumentsJson) {
								const previous = toolPartialJson.get(toolCallId) ?? "";
								const accumulated = tc.argumentsJson.startsWith(previous)
									? tc.argumentsJson
									: previous + tc.argumentsJson;
								const delta = accumulated.slice(previous.length);
								toolPartialJson.set(toolCallId, accumulated);
								block.arguments = parseJsonObject(accumulated);
								if (delta) {
									stream.push({
										type: "toolcall_delta",
										contentIndex: output.content.indexOf(block),
										delta,
										partial: output,
									});
								}
							}
						}
						output.stopReason = "toolUse";
					}

					if (msg.promptTokens !== undefined || msg.completionTokens !== undefined) {
						const input = Number(msg.promptTokens ?? 0) || 0;
						const outTok = Number(msg.completionTokens ?? 0) || 0;
						output.usage = {
							input,
							output: outTok,
							cacheRead: 0,
							cacheWrite: 0,
							totalTokens: input + outTok,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						};
					}
				}
				if (done) break;
				if (options?.signal?.aborted) {
					output.stopReason = "aborted";
					output.errorMessage = "Request was aborted";
					break;
				}
			}

			endTextBlock();
			endThinkingBlock();
			for (const [id, block] of toolBlocks) {
				const args = toolPartialJson.get(id) ?? "";
				block.arguments = parseJsonObject(args);
				stream.push({
					type: "toolcall_end",
					contentIndex: output.content.indexOf(block),
					toolCall: block,
					partial: output,
				});
			}

			if (output.stopReason === "pending") {
				output.stopReason = toolBlocks.size > 0 ? "toolUse" : "stop";
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

export function createNativeDevinStreamSimple(opts?: { loginHint?: string }) {
	const loginHint = opts?.loginHint ?? "/login devin";
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
				errorMessage: `No API key. Run ${loginHint}.`,
				timestamp: Date.now(),
			};
			queueMicrotask(() => {
				out.push({ type: "error", reason: "error", error });
				out.end();
			});
			return out;
		}
		return streamDevinNative(model, context, options);
	};
}
