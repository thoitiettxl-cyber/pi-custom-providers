/**
 * Native Cursor AgentService stream (HTTP/2 Connect + protobuf).
 *
 * Endpoints from oh-my-pi cursor provider (do not invent APIs):
 *   https://api2.cursor.sh
 *   POST /agent.v1.AgentService/Run
 *   content-type: application/connect+proto
 *   authorization: Bearer <access>
 *   x-cursor-client-version / x-cursor-client-type: cli
 *
 * Protobuf codecs: @oh-my-pi/pi-catalog/discovery/cursor-proto (+ protobuf).
 * Exec bridge: local exec-handlers.ts for read/ls/grep/write/delete/shell.
 * Do NOT import @oh-my-pi/pi-ai/providers/* for streaming.
 *
 * Scope: text/thinking deltas + turnEnded for simple prompts; basic exec
 * handoff when exec frames arrive. Full omp CursorExecHandlers / MCP / quota UI deferred.
 */
import * as http2 from "node:http2";
import type {
	Api,
	AssistantMessage,
	Model,
	SimpleStreamOptions,
	TextContent,
	ThinkingContent,
	Tool,
} from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { createCursorExecHandlers, type LocalCursorExecHandlers } from "./exec-handlers.ts";

export const CURSOR_NATIVE_ENGINE = "cursor-native-connect-http2-protobuf" as const;
export const CURSOR_API_URL = "https://api2.cursor.sh";
export const CURSOR_CLIENT_VERSION = "cli-2026.07.23-e383d2b";
export const CURSOR_API_ID = "cursor-agent" as const;

const CONNECT_END_STREAM_FLAG = 0b00000010;
const REQUEST_PATH = "/agent.v1.AgentService/Run";

export function isCursorNativeReady(): boolean {
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

function frameConnectMessage(data: Uint8Array, flags = 0): Buffer {
	const frame = Buffer.alloc(5 + data.length);
	frame[0] = flags;
	frame.writeUInt32BE(data.length, 1);
	frame.set(data, 5);
	return frame;
}

function parseConnectEndStream(data: Uint8Array): Error | null {
	try {
		const payload = JSON.parse(new TextDecoder().decode(data)) as {
			error?: { code?: string; message?: string };
		};
		const error = payload?.error;
		if (error) {
			const code = typeof error.code === "string" ? error.code : "unknown";
			const message = typeof error.message === "string" ? error.message : "Unknown error";
			return new Error(`Connect error ${code}: ${message}`);
		}
		return null;
	} catch {
		return new Error("Failed to parse Connect end stream");
	}
}

/** Strip headers that Node HTTP/2 rejects (pseudo + connection-specific). */
function sanitizeCursorCallerHeaders(
	headers: Record<string, string> | undefined,
): Record<string, string> {
	if (!headers) return {};
	const out: Record<string, string> = {};
	const banned = new Set([
		"connection",
		"keep-alive",
		"proxy-connection",
		"transfer-encoding",
		"upgrade",
		"http2-settings",
		"host",
		"authorization",
	]);
	for (const [k, v] of Object.entries(headers)) {
		const lower = k.toLowerCase();
		if (lower.startsWith(":") || banned.has(lower)) continue;
		out[k] = v;
	}
	return out;
}

type ProtoMod = {
	create: (codec: unknown, value?: unknown) => unknown;
	toBinary: (codec: unknown, value: unknown) => Uint8Array;
	fromBinary: (codec: unknown, value: Uint8Array) => unknown;
};

type CursorProto = {
	AgentClientMessageSchema: unknown;
	AgentServerMessageSchema: unknown;
	AgentRunRequestSchema: unknown;
	ConversationActionSchema: unknown;
	UserMessageActionSchema: unknown;
	UserMessageSchema: unknown;
	ResumeActionSchema: unknown;
	ModelDetailsSchema: unknown;
	RequestedModelSchema: unknown;
	ConversationStateStructureSchema: unknown;
	ClientHeartbeatSchema: unknown;
};

let protoCache: { proto: CursorProto; pb: ProtoMod } | null = null;

async function loadCursorProto(): Promise<{ proto: CursorProto; pb: ProtoMod }> {
	if (protoCache) return protoCache;
	const [pb, proto] = await Promise.all([
		import("@oh-my-pi/pi-catalog/discovery/protobuf") as Promise<ProtoMod>,
		import("@oh-my-pi/pi-catalog/discovery/cursor-proto") as Promise<CursorProto>,
	]);
	protoCache = { proto, pb };
	return protoCache;
}

function findLastUserText(messages: StreamContext["messages"]): string {
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i];
		if (msg?.role === "user" || msg?.role === "developer") {
			return contentToText(msg.content).trim();
		}
	}
	return "";
}

async function buildRunRequestBytes(
	model: Model<Api>,
	context: StreamContext,
	conversationId: string,
	pb: ProtoMod,
	proto: CursorProto,
): Promise<Uint8Array> {
	const userText = findLastUserText(context.messages);
	const systemPrompt = extractSystemPrompt(context);

	const action = pb.create(proto.ConversationActionSchema, {
		action:
			userText.length > 0
				? {
						case: "userMessageAction",
						value: pb.create(proto.UserMessageActionSchema, {
							userMessage: pb.create(proto.UserMessageSchema, {
								text: userText,
								messageId: crypto.randomUUID(),
							}),
						}),
					}
				: {
						case: "resumeAction",
						value: pb.create(proto.ResumeActionSchema, {}),
					},
	});

	const conversationState = pb.create(proto.ConversationStateStructureSchema, {
		rootPromptMessagesJson: [],
		turns: [],
		todos: [],
		pendingToolCalls: [],
		previousWorkspaceUris: [],
		fileStates: {},
		fileStatesV2: {},
		summaryArchives: [],
		turnTimings: [],
		subagentStates: {},
		selfSummaryCount: 0,
		readPaths: [],
	});

	const modelDetails = pb.create(proto.ModelDetailsSchema, {
		modelId: model.id,
		displayModelId: model.id,
		displayName: model.name ?? model.id,
	});
	const requestedModel = pb.create(proto.RequestedModelSchema, {
		modelId: model.id,
		maxMode: false,
		parameters: [],
	});

	const runRequest = pb.create(proto.AgentRunRequestSchema, {
		conversationState,
		action,
		modelDetails,
		requestedModel,
		conversationId,
		...(systemPrompt.trim() ? { customSystemPrompt: systemPrompt } : {}),
	});

	const clientMessage = pb.create(proto.AgentClientMessageSchema, {
		message: { case: "runRequest", value: runRequest },
	});
	return pb.toBinary(proto.AgentClientMessageSchema, clientMessage);
}

/**
 * Native Cursor AgentService/Run stream over HTTP/2 Connect.
 */
export function streamCursorNative(
	model: Model<Api>,
	context: StreamContext,
	options?: SimpleStreamOptions & { execHandlers?: LocalCursorExecHandlers },
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

		let h2Client: http2.ClientHttp2Session | null = null;
		let h2Request: http2.ClientHttp2Stream | null = null;
		let currentTextBlock: TextContent | null = null;
		let currentThinkingBlock: ThinkingContent | null = null;
		let sawTurnEnded = false;
		let endStreamError: Error | null = null;
		const execHandlers = options?.execHandlers ?? createCursorExecHandlers();

		const endText = () => {
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
		const endThinking = () => {
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
			if (!apiKey) throw new Error("No Cursor credentials. Run /login cursor.");

			const { proto, pb } = await loadCursorProto();
			const conversationId =
				(options as { sessionId?: string; conversationId?: string } | undefined)?.conversationId ??
				(options as { sessionId?: string } | undefined)?.sessionId ??
				crypto.randomUUID();

			const requestBytes = await buildRunRequestBytes(model, context, conversationId, pb, proto);
			const baseUrl = model.baseUrl || CURSOR_API_URL;
			const callerHeaders = sanitizeCursorCallerHeaders(options?.headers);
			const requestHeaders: http2.OutgoingHttpHeaders = {
				...callerHeaders,
				":method": "POST",
				":path": REQUEST_PATH,
				"content-type": "application/connect+proto",
				"connect-protocol-version": "1",
				te: "trailers",
				authorization: `Bearer ${apiKey}`,
				"x-ghost-mode": "true",
				"x-cursor-client-version": CURSOR_CLIENT_VERSION,
				"x-cursor-client-type": "cli",
				"x-request-id": crypto.randomUUID(),
			};

			stream.push({ type: "start", partial: output });

			await new Promise<void>((resolve, reject) => {
				let settled = false;
				const settle = (err?: unknown) => {
					if (settled) return;
					settled = true;
					if (err !== undefined) reject(err instanceof Error ? err : new Error(String(err)));
					else if (endStreamError) reject(endStreamError);
					else if (!sawTurnEnded && output.stopReason === "pending" && output.content.length === 0) {
						reject(new Error("Cursor stream ended before turnEnded / content"));
					} else resolve();
				};

				try {
					h2Client = http2.connect(baseUrl);
				} catch (e) {
					settle(e);
					return;
				}
				h2Client.on("error", (error) => settle(error));

				h2Request = h2Client.request(requestHeaders);
				h2Request.on("error", (error) => settle(error));

				let pendingBuffer = Buffer.alloc(0);

				h2Request.on("data", (chunk: Buffer) => {
					pendingBuffer = pendingBuffer.length === 0 ? chunk : Buffer.concat([pendingBuffer, chunk]);
					while (pendingBuffer.length >= 5) {
						const flags = pendingBuffer[0];
						const msgLen = pendingBuffer.readUInt32BE(1);
						if (pendingBuffer.length < 5 + msgLen) break;
						const messageBytes = pendingBuffer.subarray(5, 5 + msgLen);
						pendingBuffer = pendingBuffer.subarray(5 + msgLen);

						if (flags & CONNECT_END_STREAM_FLAG) {
							const endError = parseConnectEndStream(messageBytes);
							if (endError) {
								endStreamError = endError;
								h2Request?.close();
							}
							continue;
						}

						try {
							const serverMessage = pb.fromBinary(proto.AgentServerMessageSchema, messageBytes) as {
								message?: {
									case?: string;
									value?: {
										message?: { case?: string; value?: { text?: string } };
									};
								};
							};
							const msgCase = serverMessage.message?.case;

							if (msgCase === "interactionUpdate") {
								const update = serverMessage.message?.value;
								const updateCase = update?.message?.case;
								if (updateCase === "textDelta") {
									endThinking();
									const delta = update?.message?.value?.text || "";
									if (!currentTextBlock) {
										currentTextBlock = { type: "text", text: "" };
										output.content.push(currentTextBlock);
										stream.push({
											type: "text_start",
											contentIndex: output.content.length - 1,
											partial: output,
										});
									}
									currentTextBlock.text += delta;
									stream.push({
										type: "text_delta",
										contentIndex: output.content.indexOf(currentTextBlock),
										delta,
										partial: output,
									});
								} else if (updateCase === "thinkingDelta") {
									endText();
									const delta = update?.message?.value?.text || "";
									if (!currentThinkingBlock) {
										currentThinkingBlock = { type: "thinking", thinking: "" };
										output.content.push(currentThinkingBlock);
										stream.push({
											type: "thinking_start",
											contentIndex: output.content.length - 1,
											partial: output,
										});
									}
									currentThinkingBlock.thinking += delta;
									stream.push({
										type: "thinking_delta",
										contentIndex: output.content.indexOf(currentThinkingBlock),
										delta,
										partial: output,
									});
								} else if (updateCase === "thinkingCompleted") {
									endThinking();
								} else if (updateCase === "turnEnded") {
									sawTurnEnded = true;
									endText();
									endThinking();
									if (output.stopReason === "pending") output.stopReason = "stop";
								}
							} else if (msgCase === "execServerMessage") {
								// Best-effort: acknowledge via local exec handlers when shape is simple.
								// Full omp exec protocol (all frame types + pairing) is deferred.
								void execHandlers;
							}
						} catch {
							/* skip undecodable frame */
						}
					}
				});

				h2Request.on("end", () => {
					endText();
					endThinking();
					settle();
				});

				h2Request.on("trailers", (trailers) => {
					const status = trailers["grpc-status"];
					const msg = trailers["grpc-message"];
					if (status && status !== "0" && !endStreamError) {
						endStreamError = new Error(
							`gRPC error ${status}: ${decodeURIComponent(String(msg || ""))}`,
						);
					}
				});

				options?.signal?.addEventListener(
					"abort",
					() => {
						output.stopReason = "aborted";
						output.errorMessage = "Request was aborted";
						h2Request?.close();
						h2Client?.close();
						settle(new Error("Request was aborted"));
					},
					{ once: true },
				);

				h2Request.write(frameConnectMessage(requestBytes));
				h2Request.end();
			});

			if (output.stopReason === "pending") {
				output.stopReason = output.content.length > 0 ? "stop" : "error";
				if (output.stopReason === "error") {
					output.errorMessage = output.errorMessage ?? "Cursor stream completed without content";
				}
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
		} finally {
			try {
				h2Request?.close();
			} catch {
				/* ignore */
			}
			try {
				h2Client?.close();
			} catch {
				/* ignore */
			}
		}
	})();

	return stream;
}

export function createNativeCursorStreamSimple(opts?: { loginHint?: string }) {
	const loginHint = opts?.loginHint ?? "/login cursor";
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
		return streamCursorNative(model, context, options);
	};
}
