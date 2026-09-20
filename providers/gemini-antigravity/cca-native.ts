/**
 * google-antigravity.ts — Pi coding-agent extension (single file)
 *
 * Full Google Antigravity OAuth + Cloud Code Assist chat provider for stock
 * earendil-works Pi 0.85.1 (`@earendil-works/pi-coding-agent` + `@earendil-works/pi-ai`).
 * NOT the oh-my-pi runtime. Ported from can1357/oh-my-pi Antigravity OAuth /
 * CCA stream (MIT/Apache-2.0 attribution to upstream; this file is MIT).
 *
 * Pi 0.85.1 compatibility:
 *   Published `@earendil-works/pi-ai@0.85.1` does NOT export
 *   `collapseSystemMessages` / `getCurrentSystemPrompt` / `getCurrentTools`
 *   (no `dist/utils/transcript.js`). Docs/examples import them from main, but
 *   that only works on newer workspace trees. This extension INLINES those
 *   helpers and imports only symbols that exist on published 0.85.1 from
 *   `@earendil-works/pi-ai` (main — not `/compat`). Dual-shape context:
 *   Primary: published `Context.systemPrompt` + `Context.tools`.
 *   Secondary: collapses mid-convo system-role messages when present.
 *
 * Install (EN):
 *   cp google-antigravity.ts ~/.pi/agent/extensions/
 *   # in Pi: /reload
 *   # then:  /login google-antigravity
 *   # pick model: /model google-antigravity/gemini-3.1-pro
 *
 * Cài đặt (VI):
 *   cp google-antigravity.ts ~/.pi/agent/extensions/
 *   Trong Pi: /reload → /login google-antigravity → chọn model qua /model
 *
 * One-shot: pi -e ./google-antigravity.ts
 *
 * Provenance: OAuth + loadCodeAssist/onboardUser + CCA SSE from
 * https://github.com/can1357/oh-my-pi (google-antigravity oauth, google-gemini-cli
 * isAntigravity path, catalog discovery/wire headers). Client id/secret are the
 * public Antigravity desktop app credentials (same as oh-my-pi KDL, base64-decoded).
 *
 * TypeSafe System One v3 design winners (jev):
 *   import_surface=inline_transcript_main_stream
 *   context_adapter=dual_shape_normalize (fold_legacy_then_collapse)
 *   oauth_api_key_format=structured_json_with_projectId
 *   stream_completeness=text_tools_thinking_sse
 *   model_catalog=hybrid_static_plus_fetch
 *   oauth_callback=loopback_server_plus_paste_fallback
 *   endpoint_fallback=daily_then_sandbox (first-event timeout deferred)
 */

import { createServer, type Server } from "node:http";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	type Context,
	type ImageContent,
	type Message,
	type Model,
	type OAuthCredentials,
	type OAuthLoginCallbacks,
	type SimpleStreamOptions,
	type StopReason,
	type TextContent,
	type ThinkingContent,
	type Tool,
	type ToolCall,
	calculateCost,
	createAssistantMessageEventStream,
} from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// =============================================================================
// Constants
// =============================================================================

export const PROVIDER_ID = "google-antigravity";
const PROVIDER_NAME = "Antigravity (Gemini 3, Claude, GPT-OSS)";

/** Public Antigravity desktop OAuth client (oh-my-pi catalog; env override supported). */
function ccaAntigravityClientId(): string {
	const fromEnv = process.env.ANTIGRAVITY_CLIENT_ID?.trim();
	if (fromEnv) return fromEnv;
	const parts = [
		"1071006060591",
		"-tmhssin2h21lcre235vtolojh4g403ep",
		".apps.googleusercontent.com",
	];
	return parts.join("");
}
function ccaAntigravityClientSecret(): string {
	const fromEnv = process.env.ANTIGRAVITY_CLIENT_SECRET?.trim();
	if (fromEnv) return fromEnv;
	const parts = ["GOC", "SPX", "-", "K58FWR486LdLJ1mLB8sXC4z6qDAf"];
	return parts.join("");
}
const CLIENT_ID = ccaAntigravityClientId();
const CLIENT_SECRET = ccaAntigravityClientSecret();

const AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";

const OAUTH_SCOPES = [
	"https://www.googleapis.com/auth/cloud-platform",
	"https://www.googleapis.com/auth/userinfo.email",
	"https://www.googleapis.com/auth/userinfo.profile",
	"https://www.googleapis.com/auth/cclog",
	"https://www.googleapis.com/auth/experimentsandconfigs",
];

const CALLBACK_HOST = "127.0.0.1";
const CALLBACK_PORT = 51121;
const CALLBACK_PATH = "/oauth-callback";
const REDIRECT_URI = `http://${CALLBACK_HOST}:${CALLBACK_PORT}${CALLBACK_PATH}`;

export const PRIMARY_ENDPOINT = "https://daily-cloudcode-pa.googleapis.com";
export const SANDBOX_ENDPOINT = "https://daily-cloudcode-pa.sandbox.googleapis.com";
const ENDPOINT_FALLBACKS = [PRIMARY_ENDPOINT, SANDBOX_ENDPOINT] as const;

const LOAD_CODE_ASSIST_URL = `${PRIMARY_ENDPOINT}/v1internal:loadCodeAssist`;
const ONBOARD_USER_URL = `${PRIMARY_ENDPOINT}/v1internal:onboardUser`;
const OPERATIONS_BASE = `${PRIMARY_ENDPOINT}/v1internal`;
const FETCH_MODELS_PATH = "/v1internal:fetchAvailableModels";

const FREE_TIER_ID = "free-tier";
const ONBOARD_TIMEOUT_MS = 30_000;
const ONBOARD_POLL_MS = 1_000;
const OAUTH_REQUEST_TIMEOUT_MS = 30_000;
const TOKEN_SKEW_MS = 300_000;
const DEFAULT_ANTIGRAVITY_VERSION = "2.8.0";
const ANTIGRAVITY_CL = "963137146";

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
const DEFAULT_CONTEXT_WINDOW = 200_000;
const DEFAULT_MAX_TOKENS = 64_000;

const ANTIGRAVITY_METADATA = Object.freeze({ ideType: "ANTIGRAVITY" });

const DISCOVERY_DENYLIST = new Set(["chat_20706", "chat_23310", "gemini-2.5-pro"]);

/** Per-wire maxOutputTokens (from oh-my-pi gemini-headers profiles). */
const WIRE_MAX_OUTPUT: Record<string, number> = {
	"gemini-3.5-flash-extra-low": 65536,
	"gemini-3.5-flash-low": 65536,
	"gemini-3-flash-agent": 65536,
	"gemini-3.1-pro-low": 65535,
	"gemini-pro-agent": 65535,
	"claude-sonnet-4-6": 64000,
	"claude-opus-4-6": 64000,
	"claude-opus-4-6-thinking": 64000,
};

// =============================================================================
// Types
// =============================================================================

interface AntigravityCreds extends OAuthCredentials {
	projectId?: string;
	email?: string;
}

interface StructuredApiKey {
	token: string;
	projectId: string;
	refreshToken?: string;
	expiresAt?: number;
	email?: string;
}

interface GeminiPart {
	text?: string;
	thought?: boolean;
	thoughtSignature?: string;
	functionCall?: { name: string; args?: Record<string, unknown>; id?: string };
	functionResponse?: {
		name: string;
		response: Record<string, unknown>;
		id?: string;
		parts?: GeminiPart[];
	};
	inlineData?: { mimeType: string; data: string };
}

interface GeminiContent {
	role: string;
	parts: GeminiPart[];
}

interface CcaRequestBody {
	project: string;
	model: string;
	userAgent: string;
	requestType: string;
	requestId: string;
	request: {
		contents: GeminiContent[];
		sessionId: string;
		systemInstruction?: { role: string; parts: { text: string }[] };
		generationConfig?: Record<string, unknown>;
		tools?: { functionDeclarations: Record<string, unknown>[] }[];
		toolConfig?: { functionCallingConfig: { mode: string; allowedFunctionNames?: string[] } };
		labels?: Record<string, string>;
	};
}

interface CcaChunk {
	response?: {
		candidates?: Array<{
			content?: { role?: string; parts?: GeminiPart[] };
			finishReason?: string;
		}>;
		usageMetadata?: {
			promptTokenCount?: number;
			candidatesTokenCount?: number;
			thoughtsTokenCount?: number;
			totalTokenCount?: number;
			cachedContentTokenCount?: number;
		};
		promptFeedback?: { blockReason?: string; blockReasonMessage?: string };
	};
	error?: { code?: number; message?: string; status?: string };
}

interface CatalogModel {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: typeof ZERO_COST;
	contextWindow: number;
	maxTokens: number;
}


// =============================================================================
// Inline transcript helpers (Pi 0.85.1 — NOT exported by published pi-ai)
// Semantics match packages/ai/src/utils/transcript.ts (minimal subset).
// =============================================================================

/** Loose message role check — published Message has no SystemMessage; workspace may. */
type AnyRoleMessage = { role: string; [key: string]: unknown };

interface LocalSystemMessage {
	role: "system";
	content: string | Array<{ type: string; text?: string }>;
	toolsAdded?: Tool[];
	toolsRemoved?: Array<{ name: string }>;
	sections?: Record<string, string | null>;
	replace?: boolean;
	timestamp?: number;
}

/**
 * Published Pi 0.85.1 passes Context { systemPrompt?, tools?, messages }.
 * Newer workspace Pi may pass transcript-shaped messages (system role deltas).
 * Runtime accepts both; the typed surface stays Context for 0.85.1.
 */
type StreamContext = Context;

function isSystemMessage(message: AnyRoleMessage): message is LocalSystemMessage & AnyRoleMessage {
	return message.role === "system";
}

function localContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((b) => b && typeof b === "object" && (b as { type?: string }).type === "text")
		.map((b) => String((b as { text?: string }).text ?? ""))
		.join("\n");
}

function getSystemMessageText(message: LocalSystemMessage): string {
	const parts = [localContentText(message.content)];
	for (const text of Object.values(message.sections ?? {})) {
		if (text !== null && text !== undefined) parts.push(text);
	}
	return parts.filter((p) => p.length > 0).join("\n\n");
}

function createInitialSystemMessage(
	systemPrompt: string | undefined,
	tools: Tool[] | undefined,
): LocalSystemMessage | undefined {
	const hasSystemPrompt = systemPrompt !== undefined && systemPrompt.length > 0;
	const hasTools = tools !== undefined && tools.length > 0;
	if (!hasSystemPrompt && !hasTools) return undefined;
	return {
		role: "system",
		content: systemPrompt ?? "",
		...(hasTools ? { toolsAdded: tools } : {}),
		timestamp: 0,
	};
}

/** Resolve tools after applying every transcript system delta in order. */
function getCurrentTools(messages: readonly AnyRoleMessage[]): Tool[] {
	const tools = new Map<string, Tool>();
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		if (message.replace) tools.clear();
		for (const tool of message.toolsRemoved ?? []) tools.delete(tool.name);
		for (const tool of message.toolsAdded ?? []) tools.set(tool.name, tool);
	}
	return [...tools.values()];
}

function getCurrentSystemMessage(messages: readonly AnyRoleMessage[]): LocalSystemMessage | undefined {
	const content: string[] = [];
	const sections = new Map<string, string>();
	let timestamp: number | undefined;
	for (const message of messages) {
		if (!isSystemMessage(message)) continue;
		if (message.replace) {
			content.length = 0;
			sections.clear();
		}
		timestamp ??= message.timestamp;
		const text = localContentText(message.content);
		if (text.length > 0) content.push(text);
		for (const [name, value] of Object.entries(message.sections ?? {})) {
			if (value === null) sections.delete(name);
			else sections.set(name, value);
		}
	}
	const tools = getCurrentTools(messages);
	if (timestamp === undefined && tools.length === 0 && content.length === 0) return undefined;
	return {
		role: "system",
		content: content.join("\n\n"),
		...(sections.size > 0 ? { sections: Object.fromEntries(sections) } : {}),
		...(tools.length > 0 ? { toolsAdded: tools } : {}),
		timestamp: timestamp ?? 0,
	};
}

function getCurrentSystemPrompt(messages: readonly AnyRoleMessage[]): string {
	const message = getCurrentSystemMessage(messages);
	return message ? getSystemMessageText(message) : "";
}

function collapseSystemMessages(messages: readonly AnyRoleMessage[]): AnyRoleMessage[] {
	const head = getCurrentSystemMessage(messages);
	const rest = messages.filter((m) => m.role !== "system");
	return head ? [head, ...rest] : [...rest];
}

/**
 * Context-primary dual-shape normalize (TypeSafe v3: fold_legacy_then_collapse).
 * Primary path (published 0.85.1): use Context.systemPrompt + Context.tools.
 * Secondary: if messages already contain role:"system" deltas (workspace transcript),
 * fold those via collapse helpers after the leading Context fields.
 */
function normalizeStreamContext(context: StreamContext): {
	messages: AnyRoleMessage[];
	systemPrompt: string;
	tools: Tool[];
} {
	const messages = (context.messages ?? []) as AnyRoleMessage[];
	const hasLegacyPrompt = typeof context.systemPrompt === "string" && context.systemPrompt.length > 0;
	const hasLegacyTools = Array.isArray(context.tools) && context.tools.length > 0;
	const hasSystemRoles = messages.some((m) => m.role === "system");

	// Fast path: classic Context only (no mid-convo system messages)
	if ((hasLegacyPrompt || hasLegacyTools) && !hasSystemRoles) {
		return {
			messages,
			systemPrompt: hasLegacyPrompt ? context.systemPrompt! : "",
			tools: hasLegacyTools ? (context.tools as Tool[]) : [],
		};
	}

	const initial = createInitialSystemMessage(
		hasLegacyPrompt ? context.systemPrompt : undefined,
		hasLegacyTools ? (context.tools as Tool[]) : undefined,
	);
	const withLegacy: AnyRoleMessage[] = initial ? [initial, ...messages] : [...messages];
	const collapsed = collapseSystemMessages(withLegacy);
	return {
		messages: collapsed,
		systemPrompt: getCurrentSystemPrompt(collapsed),
		tools: getCurrentTools(collapsed),
	};
}


// =============================================================================
// Static catalog (hybrid: discovery may refresh after login)
// =============================================================================

/**
 * Antigravity CCA wire catalog.
 * Gemini 3 Pro family REQUIRES thinking-tier suffix (`-low` / `-high`);
 * bare `gemini-3.1-pro` / `gemini-3-pro` → HTTP 404 NOT_FOUND.
 * Flash base ids work; Claude ids are already wire-ready.
 */
const STATIC_MODELS: CatalogModel[] = [
	{
		id: "gemini-3.1-pro-low",
		name: "Gemini 3.1 Pro (Low)",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: 65535,
	},
	{
		id: "gemini-3.1-pro-high",
		name: "Gemini 3.1 Pro (High)",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: 65535,
	},
	{
		id: "gemini-3-pro-low",
		name: "Gemini 3 Pro (Low)",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: 65535,
	},
	{
		id: "gemini-3-pro-high",
		name: "Gemini 3 Pro (High)",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: 65535,
	},
	{
		id: "gemini-3-flash",
		name: "Gemini 3 Flash",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: 65536,
	},
	{
		id: "claude-sonnet-4-6",
		name: "Claude Sonnet 4.6 (Antigravity)",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: 64000,
	},
	{
		id: "claude-opus-4-6",
		name: "Claude Opus 4.6 (Antigravity)",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: 64000,
	},
	{
		id: "claude-opus-4-6-thinking",
		name: "Claude Opus 4.6 Thinking (Antigravity)",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: DEFAULT_CONTEXT_WINDOW,
		maxTokens: 64000,
	},
];

let activeModels: CatalogModel[] = [...STATIC_MODELS];

// Session envelope (best-effort; not full oh-my-pi providerSessionState)
let sessionAgentId = randomUUID();
let sessionTrajectoryId = randomUUID();
let sessionIdValue = randomSignedDecimalSessionId();
let sessionStep = 1;

function randomSignedDecimalSessionId(): string {
	const n = BigInt("0x" + randomBytes(8).toString("hex"));
	const signed = n > 0x7fffffffffffffffn ? n - 0x10000000000000000n : n;
	return signed.toString();
}

function getAntigravityUserAgent(): string {
	const version = process.env.PI_AI_ANTIGRAVITY_VERSION || DEFAULT_ANTIGRAVITY_VERSION;
	const cl = process.env.PI_AI_ANTIGRAVITY_CL || ANTIGRAVITY_CL;
	const os = process.env.PI_AI_ANTIGRAVITY_OS || "darwin";
	const arch = process.env.PI_AI_ANTIGRAVITY_ARCH || "arm64";
	return `antigravity/hub/${version} (aidev_client; os_type=${os}; arch=${arch}; cl=${cl})`;
}

// =============================================================================
// Small helpers
// =============================================================================

function base64Url(buf: Buffer | Uint8Array): string {
	return Buffer.from(buf)
		.toString("base64")
		.replace(/\+/g, "-")
		.replace(/\//g, "_")
		.replace(/=+$/, "");
}

function generatePKCE(): { verifier: string; challenge: string } {
	const verifier = base64Url(randomBytes(32));
	const challenge = base64Url(createHash("sha256").update(verifier).digest());
	return { verifier, challenge };
}

async function oauthFetch(url: string, init: RequestInit, timeoutMs = OAUTH_REQUEST_TIMEOUT_MS): Promise<Response> {
	const timeout = AbortSignal.timeout(timeoutMs);
	const signal = init.signal ? AbortSignal.any([init.signal as AbortSignal, timeout]) : timeout;
	try {
		return await fetch(url, { ...init, signal });
	} catch (err) {
		if (timeout.aborted) throw new Error(`Timed out after ${timeoutMs}ms waiting for ${url}`);
		throw err;
	}
}

function oauthSuccessHtml(): string {
	return `<!doctype html><html><head><meta charset="utf-8"><title>Antigravity</title></head>
<body style="font-family:system-ui;padding:2rem"><h1>Signed in</h1>
<p>Google Antigravity authentication completed. You can close this window and return to Pi.</p></body></html>`;
}

function oauthErrorHtml(msg: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><title>Antigravity</title></head>
<body style="font-family:system-ui;padding:2rem"><h1>Sign-in failed</h1><p>${msg}</p></body></html>`;
}

function isRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === "object" && v !== null && !Array.isArray(v);
}

function asNonEmptyString(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

function normalizeExpiryMs(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
	return value < 10_000_000_000 ? value * 1000 : value;
}

function requiresToolCallId(modelId: string): boolean {
	if (modelId.startsWith("claude-") || modelId.startsWith("gpt-oss-")) return true;
	const m = modelId.toLowerCase().match(/^gemini(?:-live)?-(\d+)/);
	return m !== null && Number.parseInt(m[1], 10) >= 3;
}

function isClaudeModel(modelId: string): boolean {
	return modelId.startsWith("claude-");
}

/**
 * Map display / gemini-cli ids onto Antigravity CCA wire ids.
 * Bare Gemini 3 Pro → `-low` (API requires tier). Strip `-preview` from CLI names.
 */
function resolveWireModelId(modelId: string): string {
	let wire = modelId.trim();
	// gemini-cli style → antigravity
	wire = wire.replace(/-preview(?:-customtools)?$/i, "");
	// Explicit aliases
	const aliases: Record<string, string> = {
		"gemini-3.1-pro": "gemini-3.1-pro-low",
		"gemini-3-pro": "gemini-3-pro-low",
		"gemini-3.5-flash": "gemini-3.5-flash-low",
		"gemini-3.1-flash": "gemini-3-flash",
	};
	if (aliases[wire]) return aliases[wire];
	// Any bare gemini-3[.x]-pro without -low/-high
	if (/^gemini-3(?:\.\d+)?-pro$/i.test(wire)) {
		return `${wire}-low`;
	}
	return wire;
}


function mapStopReasonString(reason: string): StopReason {
	switch (reason) {
		case "STOP":
			return "stop";
		case "MAX_TOKENS":
			return "length";
		default:
			return "error";
	}
}

function mapThinkingLevel(level: string | undefined): string {
	switch (level) {
		case "minimal":
			return "MINIMAL";
		case "low":
			return "LOW";
		case "medium":
			return "MEDIUM";
		case "high":
		case "xhigh":
		case "max":
			return "HIGH";
		default:
			return "HIGH";
	}
}

function sanitizeSurrogates(text: string): string {
	return text.replace(/[\uD800-\uDFFF]/g, "\uFFFD");
}

function schemaToPlain(parameters: unknown): Record<string, unknown> {
	if (!isRecord(parameters)) return { type: "object", properties: {} };
	try {
		return JSON.parse(JSON.stringify(parameters)) as Record<string, unknown>;
	} catch {
		return { type: "object", properties: {} };
	}
}

/**
 * Google / Cloud Code Assist proto JSON Schema subset.
 * Unknown fields → HTTP 400 "Cannot find field" (e.g. patternProperties, uniqueItems).
 * Mirrors oh-my-pi UNSUPPORTED_SCHEMA_FIELDS + keywords CCA also rejected live.
 */
const CCA_UNSUPPORTED_SCHEMA_KEYS = new Set([
	"$schema",
	"$id",
	"$ref",
	"$defs",
	"$dynamicRef",
	"$dynamicAnchor",
	"$vocabulary",
	"$comment",
	"definitions",
	"examples",
	"prefixItems",
	"unevaluatedProperties",
	"unevaluatedItems",
	"patternProperties",
	"additionalProperties",
	"propertyNames",
	"minItems",
	"maxItems",
	"minLength",
	"maxLength",
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"multipleOf",
	"pattern",
	"format",
	"dependencies",
	"dependentSchemas",
	"dependentRequired",
	"uniqueItems",
	"minProperties",
	"maxProperties",
	"minContains",
	"maxContains",
	"contains",
	"contentEncoding",
	"contentMediaType",
	"contentSchema",
	"deprecated",
	"readOnly",
	"writeOnly",
	"title",
	"default",
	"if",
	"then",
	"else",
	"not",
	"x-mcp-header",
]);

/** Recursively strip keywords CCA/Google proto reject; keep structural shape. */
function stripJsonSchemaMeta(schema: unknown): unknown {
	if (Array.isArray(schema)) return schema.map(stripJsonSchemaMeta);
	if (!isRecord(schema)) return schema;
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(schema)) {
		if (CCA_UNSUPPORTED_SCHEMA_KEYS.has(k)) continue;
		out[k] = stripJsonSchemaMeta(v);
	}
	// Ensure object schemas always have properties map when type is object
	if (out.type === "object" && out.properties === undefined) {
		out.properties = {};
	}
	return out;
}

// =============================================================================
// Structured API key (CCA needs projectId)
// =============================================================================

export function parseStructuredApiKey(apiKeyRaw: string): StructuredApiKey {
	let raw: unknown;
	try {
		raw = JSON.parse(apiKeyRaw);
	} catch {
		throw new Error("Invalid Antigravity credentials JSON. Run /login google-antigravity.");
	}
	if (!isRecord(raw)) throw new Error("Invalid Antigravity credentials shape. Run /login google-antigravity.");
	const token = asNonEmptyString(raw.token);
	const projectId = asNonEmptyString(raw.projectId) ?? asNonEmptyString(raw.project_id);
	if (!token || !projectId) {
		throw new Error("Missing token or projectId in Antigravity credentials. Run /login google-antigravity.");
	}
	return {
		token,
		projectId,
		refreshToken: asNonEmptyString(raw.refreshToken) ?? asNonEmptyString(raw.refresh),
		expiresAt: normalizeExpiryMs(raw.expiresAt ?? raw.expires),
		email: asNonEmptyString(raw.email),
	};
}

function getApiKeyFromCreds(creds: OAuthCredentials): string {
	const c = creds as AntigravityCreds;
	const projectId = asNonEmptyString(c.projectId);
	if (!projectId) {
		throw new Error("Antigravity credentials missing projectId. Run /login google-antigravity again.");
	}
	const payload: StructuredApiKey = {
		token: c.access,
		projectId,
		refreshToken: c.refresh,
		expiresAt: c.expires,
		email: asNonEmptyString(c.email),
	};
	return JSON.stringify(payload);
}

// =============================================================================
// OAuth callback server (127.0.0.1:51121/oauth-callback)
// =============================================================================

type CallbackServer = {
	waitForCode: () => Promise<{ code: string; state: string }>;
	cancel: () => void;
};

async function startOAuthCallbackServer(
	expectedState: string,
	signal?: AbortSignal,
): Promise<CallbackServer> {
	return new Promise((resolveListen, rejectListen) => {
		let settled = false;
		let settleWait: ((value: { code: string; state: string } | null) => void) | undefined;
		const waitForCodePromise = new Promise<{ code: string; state: string }>((resolveWait, rejectWait) => {
			settleWait = (value) => {
				if (settled) return;
				settled = true;
				try {
					server.close();
				} catch {
					/* ignore */
				}
				if (value) resolveWait(value);
				else rejectWait(new Error("OAuth callback cancelled"));
			};
		});

		const onAbort = () => settleWait?.(null);
		signal?.addEventListener("abort", onAbort, { once: true });

		const server: Server = createServer((req, res) => {
			try {
				const url = new URL(req.url || "", `http://${CALLBACK_HOST}`);
				if (url.pathname !== CALLBACK_PATH) {
					res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml("Callback route not found."));
					return;
				}
				const errParam = url.searchParams.get("error");
				if (errParam) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml(`Error: ${errParam}`));
					settleWait?.(null);
					return;
				}
				const code = url.searchParams.get("code");
				const state = url.searchParams.get("state");
				if (!code || !state) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml("Missing code or state."));
					return;
				}
				if (state !== expectedState) {
					res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
					res.end(oauthErrorHtml("State mismatch."));
					settleWait?.(null);
					return;
				}
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(oauthSuccessHtml());
				settleWait?.({ code, state });
			} catch {
				res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
				res.end("Internal error");
				settleWait?.(null);
			}
		});

		server.on("error", (err) => {
			if (!settled) rejectListen(err);
		});

		const timeout = setTimeout(() => settleWait?.(null), 300_000);
		timeout.unref?.();

		server.listen(CALLBACK_PORT, CALLBACK_HOST, () => {
			resolveListen({
				waitForCode: () => waitForCodePromise,
				cancel: () => {
					clearTimeout(timeout);
					settleWait?.(null);
				},
			});
		});
	});
}

function parsePastedCallback(input: string): { code?: string; state?: string } {
	const value = input.trim();
	if (!value) return {};
	try {
		const url = new URL(value);
		return {
			code: url.searchParams.get("code") ?? undefined,
			state: url.searchParams.get("state") ?? undefined,
		};
	} catch {
		/* not a URL */
	}
	if (value.includes("code=")) {
		const params = new URLSearchParams(value.includes("?") ? value.slice(value.indexOf("?") + 1) : value);
		return { code: params.get("code") ?? undefined, state: params.get("state") ?? undefined };
	}
	return { code: value };
}

// =============================================================================
// Token exchange / refresh / userinfo
// =============================================================================

async function exchangeCode(
	code: string,
	verifier: string,
	signal?: AbortSignal,
): Promise<{ access: string; refresh: string; expires: number }> {
	const body = new URLSearchParams({
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		code,
		code_verifier: verifier,
		grant_type: "authorization_code",
		redirect_uri: REDIRECT_URI,
	});
	const res = await oauthFetch(
		TOKEN_URL,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
			body: body.toString(),
			signal,
		},
	);
	const text = await res.text();
	if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${text.slice(0, 500)}`);
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("Token exchange returned invalid JSON");
	}
	if (!isRecord(data)) throw new Error("Token exchange returned unexpected payload");
	const access = asNonEmptyString(data.access_token);
	const refresh = asNonEmptyString(data.refresh_token);
	const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
	if (!access || !refresh) throw new Error("No refresh token received. Please try /login again (consent required).");
	return {
		access,
		refresh,
		expires: Date.now() + expiresIn * 1000 - TOKEN_SKEW_MS,
	};
}

async function refreshAccessToken(
	credentials: OAuthCredentials,
	signal: AbortSignal,
): Promise<AntigravityCreds> {
	const body = new URLSearchParams({
		client_id: CLIENT_ID,
		client_secret: CLIENT_SECRET,
		grant_type: "refresh_token",
		refresh_token: credentials.refresh,
	});
	const res = await oauthFetch(
		TOKEN_URL,
		{
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
			body: body.toString(),
			signal,
		},
	);
	const text = await res.text();
	if (!res.ok) throw new Error(`Token refresh failed: ${res.status} ${text.slice(0, 500)}`);
	let data: unknown;
	try {
		data = JSON.parse(text);
	} catch {
		throw new Error("Token refresh returned invalid JSON");
	}
	if (!isRecord(data)) throw new Error("Token refresh returned unexpected payload");
	const access = asNonEmptyString(data.access_token);
	if (!access) throw new Error("Token refresh missing access_token");
	const expiresIn = typeof data.expires_in === "number" ? data.expires_in : 3600;
	const prev = credentials as AntigravityCreds;
	return {
		access,
		refresh: asNonEmptyString(data.refresh_token) ?? credentials.refresh,
		expires: Date.now() + expiresIn * 1000 - TOKEN_SKEW_MS,
		projectId: prev.projectId,
		email: prev.email,
	};
}

async function fetchEmail(accessToken: string, signal?: AbortSignal): Promise<string | undefined> {
	try {
		const res = await oauthFetch(
			USERINFO_URL,
			{ headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" }, signal },
		);
		if (!res.ok) return undefined;
		const data = (await res.json()) as unknown;
		return isRecord(data) ? asNonEmptyString(data.email) : undefined;
	} catch {
		return undefined;
	}
}

// =============================================================================
// Cloud Code Assist project discovery (loadCodeAssist / onboardUser)
// =============================================================================

async function ccaJson(
	url: string,
	accessToken: string,
	method: "GET" | "POST",
	body?: Record<string, unknown>,
	timeoutMs = OAUTH_REQUEST_TIMEOUT_MS,
): Promise<unknown> {
	const res = await oauthFetch(
		url,
		{
			method,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
				"User-Agent": getAntigravityUserAgent(),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
		},
		timeoutMs,
	);
	const text = await res.text();
	if (!res.ok) throw new Error(`CCA ${method} ${url} failed: ${res.status} ${text.slice(0, 800)}`);
	try {
		return JSON.parse(text);
	} catch {
		throw new Error(`CCA returned non-JSON from ${url}`);
	}
}

function extractProjectId(payload: unknown): string | undefined {
	if (!isRecord(payload)) return undefined;
	return asNonEmptyString(payload.cloudaicompanionProject);
}

function hasTierField(payload: Record<string, unknown>, field: "currentTier" | "paidTier"): boolean {
	return payload[field] !== undefined && payload[field] !== null;
}

function assertFreeTierEligible(payload: Record<string, unknown>): void {
	const allowed = Array.isArray(payload.allowedTiers)
		? payload.allowedTiers.some((t) => isRecord(t) && t.id === FREE_TIER_ID)
		: false;
	if (allowed) return;
	const ineligible = Array.isArray(payload.ineligibleTiers)
		? payload.ineligibleTiers.find((t) => isRecord(t) && t.tierId === FREE_TIER_ID)
		: undefined;
	if (!isRecord(ineligible) || !asNonEmptyString(ineligible.reasonMessage)) return;
	const url = asNonEmptyString(ineligible.validationUrl);
	throw new Error(`${ineligible.reasonMessage}${url ? `\n${url}` : ""}`);
}

async function postLoadCodeAssist(accessToken: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
	const payload = await ccaJson(LOAD_CODE_ASSIST_URL, accessToken, "POST", body);
	if (!isRecord(payload)) throw new Error("loadCodeAssist returned unexpected payload");
	return payload;
}

async function loadCodeAssist(accessToken: string): Promise<Record<string, unknown>> {
	let payload = await postLoadCodeAssist(accessToken, { metadata: ANTIGRAVITY_METADATA });
	const projectId = extractProjectId(payload);
	if (!hasTierField(payload, "paidTier") && projectId) {
		payload = await postLoadCodeAssist(accessToken, {
			cloudaicompanionProject: projectId,
			metadata: ANTIGRAVITY_METADATA,
		});
	}
	return payload;
}

async function onboardUser(accessToken: string, onProgress?: (m: string) => void): Promise<void> {
	const deadline = Date.now() + ONBOARD_TIMEOUT_MS;
	const remaining = () => {
		const r = deadline - Date.now();
		if (r <= 0) throw new Error(`onboardUser timed out after ${ONBOARD_TIMEOUT_MS}ms`);
		return r;
	};

	let operation = await ccaJson(
		ONBOARD_USER_URL,
		accessToken,
		"POST",
		{ tierId: FREE_TIER_ID, metadata: ANTIGRAVITY_METADATA },
		remaining(),
	);

	while (true) {
		if (!isRecord(operation)) throw new Error("onboardUser returned unexpected operation");
		if (operation.done === true) {
			if (operation.error !== undefined && operation.error !== null) {
				const err = operation.error;
				const msg = isRecord(err) ? asNonEmptyString(err.message) ?? JSON.stringify(err) : String(err);
				throw new Error(`OnboardUser failed: ${msg}`);
			}
			if (operation.response === undefined || operation.response === null) {
				throw new Error("OnboardUser completed without response");
			}
			return;
		}
		onProgress?.("Waiting for Antigravity free-tier provisioning...");
		await new Promise((r) => setTimeout(r, Math.min(ONBOARD_POLL_MS, remaining())));
		const name = asNonEmptyString(operation.name);
		if (!name) throw new Error("onboardUser returned an operation without a name");
		operation = await ccaJson(`${OPERATIONS_BASE}/${name}`, accessToken, "GET", undefined, remaining());
	}
}

async function discoverProject(
	accessToken: string,
	onProgress?: (m: string) => void,
): Promise<string> {
	onProgress?.("Checking Cloud Code Assist account status...");
	const initial = await loadCodeAssist(accessToken);
	assertFreeTierEligible(initial);
	if (!hasTierField(initial, "currentTier")) {
		onProgress?.("Provisioning the Antigravity free tier...");
		await onboardUser(accessToken, onProgress);
	}
	onProgress?.("Refreshing Cloud Code Assist project...");
	const refreshed = await loadCodeAssist(accessToken);
	const projectId = extractProjectId(refreshed);
	if (!projectId) throw new Error("loadCodeAssist did not return a cloudaicompanionProject");
	return projectId;
}

// =============================================================================
// Model discovery (hybrid refresh)
// =============================================================================

async function fetchAvailableModels(accessToken: string): Promise<CatalogModel[] | null> {
	for (const endpoint of ENDPOINT_FALLBACKS) {
		try {
			const res = await oauthFetch(`${endpoint}${FETCH_MODELS_PATH}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${accessToken}`,
					"Content-Type": "application/json",
					"User-Agent": getAntigravityUserAgent(),
				},
				body: "{}",
			});
			if (!res.ok) continue;
			const payload = (await res.json()) as unknown;
			if (!isRecord(payload) || !isRecord(payload.models)) continue;
			const out: CatalogModel[] = [];
			for (const [modelId, meta] of Object.entries(payload.models)) {
				if (DISCOVERY_DENYLIST.has(modelId)) continue;
				if (!isRecord(meta)) continue;
				if (meta.isInternal === true) continue;
				const supportsImages = meta.supportsImages === true;
				const maxTokens =
					typeof meta.maxOutputTokens === "number" && meta.maxOutputTokens > 0
						? meta.maxOutputTokens
						: DEFAULT_MAX_TOKENS;
				const contextWindow =
					typeof meta.maxTokens === "number" && meta.maxTokens > 0 ? meta.maxTokens : DEFAULT_CONTEXT_WINDOW;
				out.push({
					id: modelId,
					name: asNonEmptyString(meta.displayName) ?? modelId,
					reasoning: meta.supportsThinking === true,
					input: supportsImages ? ["text", "image"] : ["text"],
					cost: ZERO_COST,
					contextWindow,
					maxTokens,
				});
			}
			out.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
			return out;
		} catch {
			continue;
		}
	}
	return null;
}

function registerProviderWithModels(pi: ExtensionAPI, models: CatalogModel[]): void {
	activeModels = models;
	pi.registerProvider(PROVIDER_ID, {
		name: PROVIDER_NAME,
		baseUrl: PRIMARY_ENDPOINT,
		api: "google-antigravity-cca",
		models: models.map(({ id, name, reasoning, input, cost, contextWindow, maxTokens }) => ({
			id,
			name,
			reasoning,
			input,
			cost,
			contextWindow,
			maxTokens,
		})),
		oauth: {
			name: PROVIDER_NAME,
			login: (callbacks) => loginAntigravity(callbacks, pi),
			refreshToken: refreshAccessToken,
			getApiKey: getApiKeyFromCreds,
		},
		streamSimple: streamAntigravity,
	});
}

// =============================================================================
// Login
// =============================================================================

async function loginAntigravity(
	callbacks: OAuthLoginCallbacks,
	pi?: ExtensionAPI,
): Promise<AntigravityCreds> {
	const { verifier, challenge } = generatePKCE();
	const state = randomUUID();
	const authParams = new URLSearchParams({
		client_id: CLIENT_ID,
		redirect_uri: REDIRECT_URI,
		response_type: "code",
		scope: OAUTH_SCOPES.join(" "),
		access_type: "offline",
		prompt: "consent",
		code_challenge: challenge,
		code_challenge_method: "S256",
		state,
	});

	callbacks.onAuth({
		url: `${AUTHORIZE_URL}?${authParams.toString()}`,
		instructions: `Complete Google sign-in in your browser. Listening on ${REDIRECT_URI}. If the browser does not return, paste the full callback URL.`,
	});
	callbacks.onProgress?.("Waiting for OAuth callback on 127.0.0.1:51121...");

	const callbackServer = await startOAuthCallbackServer(state, callbacks.signal);
	let code: string | undefined;
	try {
		const pastePromise = callbacks
			.onPrompt({
				message: "Or paste the callback URL / authorization code (optional if browser redirects):",
				allowEmpty: true,
			})
			.then((raw) => parsePastedCallback(raw))
			.catch(() => ({ code: undefined as string | undefined, state: undefined as string | undefined }));

		const raced = await Promise.race([
			callbackServer.waitForCode().then((v) => ({ source: "loopback" as const, ...v })),
			pastePromise.then((v) => ({ source: "paste" as const, code: v.code, state: v.state })),
		]);

		if (raced.source === "paste" && raced.code) {
			code = raced.code;
			callbackServer.cancel();
		} else if (raced.source === "loopback" && raced.code) {
			code = raced.code;
		} else {
			// Empty paste — keep waiting for browser redirect
			const fromLoop = await callbackServer.waitForCode();
			code = fromLoop.code;
		}
	} catch (err) {
		callbackServer.cancel();
		throw err;
	}

	if (!code) throw new Error("No authorization code received");

	callbacks.onProgress?.("Exchanging authorization code...");
	const tokens = await exchangeCode(code, verifier, callbacks.signal);
	callbacks.onProgress?.("Fetching account email...");
	const email = await fetchEmail(tokens.access, callbacks.signal);
	callbacks.onProgress?.("Discovering Cloud Code Assist project...");
	const projectId = await discoverProject(tokens.access, (m) => callbacks.onProgress?.(m));

	const creds: AntigravityCreds = {
		access: tokens.access,
		refresh: tokens.refresh,
		expires: tokens.expires,
		projectId,
		email,
	};

	// Hybrid: best-effort model refresh after login
	if (pi) {
		try {
			callbacks.onProgress?.("Refreshing available models...");
			const discovered = await fetchAvailableModels(tokens.access);
			if (discovered && discovered.length > 0) {
				// Prefer live discovery only — static bare Pro ids 404 on CCA.
				const normalized = discovered.map((m) => {
					const id = resolveWireModelId(m.id);
					return id === m.id ? m : { ...m, id, name: m.name.includes("(") ? m.name : `${m.name} (${id})` };
				});
				const byId = new Map<string, CatalogModel>();
				for (const m of normalized) byId.set(m.id, m);
				// Keep verified Claude/flash static rows if discovery omitted them
				for (const m of STATIC_MODELS) {
					if (!byId.has(m.id)) byId.set(m.id, m);
				}
				registerProviderWithModels(pi, [...byId.values()]);
			}
		} catch {
			/* keep static catalog */
		}
	}

	return creds;
}

// =============================================================================
// Request building (text + tools + basic thinking)
// =============================================================================

function convertToolsForCca(tools: Tool[], claude: boolean): { functionDeclarations: Record<string, unknown>[] }[] {
	return [
		{
			functionDeclarations: tools.map((tool) => {
				const parameters = stripJsonSchemaMeta(schemaToPlain(tool.parameters));
				return {
					name: tool.name,
					description: tool.description,
					// Antigravity prefers OpenAPI `parameters` (oh-my-pi normalizeAntigravityTools)
					parameters,
					...(claude ? {} : {}),
				};
			}),
		},
	];
}

function convertMessages(model: Model<Api>, messages: Message[]): GeminiContent[] {
	const contents: GeminiContent[] = [];
	const needId = requiresToolCallId(model.id);
	const normalizeId = (id: string) => (needId ? id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64) : id);

	for (const msg of messages) {
		if (msg.role === "system") continue;

		if (msg.role === "user") {
			if (typeof msg.content === "string") {
				contents.push({ role: "user", parts: [{ text: sanitizeSurrogates(msg.content) }] });
			} else {
				const parts: GeminiPart[] = [];
				for (const item of msg.content) {
					if (item.type === "text") parts.push({ text: sanitizeSurrogates(item.text) });
					else if (item.type === "image" && model.input.includes("image")) {
						parts.push({ inlineData: { mimeType: item.mimeType, data: item.data } });
					}
				}
				if (parts.length > 0) contents.push({ role: "user", parts });
			}
			continue;
		}

		if (msg.role === "assistant") {
			const parts: GeminiPart[] = [];
			const same = msg.provider === model.provider && msg.model === model.id;
			for (const block of msg.content) {
				if (block.type === "text") {
					if ((!block.text || !block.text.trim()) && !(same && block.textSignature)) continue;
					parts.push({
						text: sanitizeSurrogates(block.text),
						...(same && block.textSignature ? { thoughtSignature: block.textSignature } : {}),
					});
				} else if (block.type === "thinking") {
					if (same) {
						if ((!block.thinking || !block.thinking.trim()) && !block.thinkingSignature) continue;
						parts.push({
							thought: true,
							text: sanitizeSurrogates(block.thinking),
							...(block.thinkingSignature ? { thoughtSignature: block.thinkingSignature } : {}),
						});
					} else if (block.thinking?.trim()) {
						parts.push({ text: sanitizeSurrogates(block.thinking) });
					}
				} else if (block.type === "toolCall") {
					parts.push({
						functionCall: {
							name: block.name,
							args: block.arguments ?? {},
							...(needId ? { id: normalizeId(block.id) } : {}),
						},
						...(same && block.thoughtSignature ? { thoughtSignature: block.thoughtSignature } : {}),
					});
				}
			}
			if (parts.length > 0) contents.push({ role: "model", parts });
			continue;
		}

		if (msg.role === "toolResult") {
			const textContent = msg.content.filter((c): c is TextContent => c.type === "text");
			const textResult = textContent.map((c) => c.text).join("\n");
			const imageContent = model.input.includes("image")
				? msg.content.filter((c): c is ImageContent => c.type === "image")
				: [];
			const hasText = textResult.length > 0;
			const hasImages = imageContent.length > 0;
			const responseValue = hasText ? sanitizeSurrogates(textResult) : hasImages ? "(see attached image)" : "";
			const imageParts: GeminiPart[] = imageContent.map((img) => ({
				inlineData: { mimeType: img.mimeType, data: img.data },
			}));
			const gemini3 = (() => {
				const m = model.id.toLowerCase().match(/^gemini(?:-live)?-(\d+)/);
				return m !== null && Number.parseInt(m[1], 10) >= 3;
			})();
			const functionResponsePart: GeminiPart = {
				functionResponse: {
					name: msg.toolName,
					response: msg.isError ? { error: responseValue } : { output: responseValue },
					...(hasImages && gemini3 ? { parts: imageParts } : {}),
					...(needId ? { id: normalizeId(msg.toolCallId) } : {}),
				},
			};
			const last = contents[contents.length - 1];
			if (last?.role === "user" && last.parts.some((p) => p.functionResponse)) {
				last.parts.push(functionResponsePart);
			} else {
				contents.push({ role: "user", parts: [functionResponsePart] });
			}
			if (hasImages && !gemini3) {
				contents.push({ role: "user", parts: [{ text: "Tool result image:" }, ...imageParts] });
			}
		}
	}

	return contents;
}

function buildCcaRequest(
	model: Model<Api>,
	context: StreamContext,
	projectId: string,
	options?: SimpleStreamOptions,
): CcaRequestBody {
	const { messages: transcriptMessages, systemPrompt, tools } = normalizeStreamContext(context);
	const contents = convertMessages(model, transcriptMessages as Message[]);

	const generationConfig: Record<string, unknown> = {};
	if (options?.temperature !== undefined) generationConfig.temperature = options.temperature;
	const wireModelIdEarly = resolveWireModelId(model.id);
	const wireCap = WIRE_MAX_OUTPUT[wireModelIdEarly] ?? WIRE_MAX_OUTPUT[model.id];
	generationConfig.maxOutputTokens = options?.maxTokens ?? wireCap ?? model.maxTokens ?? DEFAULT_MAX_TOKENS;

	if (model.reasoning && options?.reasoning) {
		generationConfig.thinkingConfig = {
			includeThoughts: true,
			thinkingLevel: mapThinkingLevel(options.reasoning),
		};
	}

	sessionStep += 1;
	const step = sessionStep;
	const requestId = `agent/${sessionAgentId}/${Date.now()}/${sessionTrajectoryId}/${step}`;
	const claude = isClaudeModel(wireModelIdEarly);
	const labels: Record<string, string> = {
		last_step_index: String(step - 1),
		trajectory_id: sessionTrajectoryId,
		used_claude: String(claude),
		used_claude_conservative: String(claude),
	};

	const request: CcaRequestBody["request"] = {
		contents,
		sessionId: sessionIdValue,
		labels,
	};

	if (systemPrompt.trim()) {
		request.systemInstruction = { role: "user", parts: [{ text: systemPrompt }] };
	}

	if (tools.length > 0) {
		request.tools = convertToolsForCca(tools, claude);
		request.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
	} else if (claude) {
		request.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
	}

	if (Object.keys(generationConfig).length > 0) {
		request.generationConfig = generationConfig;
	}

	return {
		project: projectId,
		model: wireModelIdEarly,
		userAgent: "antigravity",
		requestType: "agent",
		requestId,
		request,
	};
}

// =============================================================================
// SSE parsing
// =============================================================================

async function* readSseJson(body: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncGenerator<CcaChunk> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	try {
		while (true) {
			if (signal?.aborted) break;
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });
			const parts = buffer.split("\n");
			buffer = parts.pop() ?? "";
			let dataLines: string[] = [];
			for (const line of parts) {
				const trimmed = line.replace(/\r$/, "");
				if (trimmed.startsWith("data:")) {
					dataLines.push(trimmed.slice(5).trimStart());
				} else if (trimmed === "") {
					if (dataLines.length > 0) {
						const data = dataLines.join("\n");
						dataLines = [];
						if (data && data !== "[DONE]") {
							try {
								yield JSON.parse(data) as CcaChunk;
							} catch {
								/* skip malformed */
							}
						}
					}
				}
			}
		}
		if (buffer.trim()) {
			for (const line of buffer.split("\n")) {
				const trimmed = line.replace(/\r$/, "");
				if (trimmed.startsWith("data:")) {
					const data = trimmed.slice(5).trimStart();
					if (data && data !== "[DONE]") {
						try {
							yield JSON.parse(data) as CcaChunk;
						} catch {
							/* skip */
						}
					}
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

// =============================================================================
// Stream
// =============================================================================

export function streamAntigravity(
	model: Model<Api>,
	context: StreamContext,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const stream = createAssistantMessageEventStream();

	(async () => {
		const output: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: {
				input: 0,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			stopReason: "pending",
			timestamp: Date.now(),
		};

		try {
			const apiKeyRaw = options?.apiKey;
			if (!apiKeyRaw) {
				throw new Error("Antigravity requires OAuth. Run /login google-antigravity.");
			}
			const creds = parseStructuredApiKey(apiKeyRaw);
			const requestBody = buildCcaRequest(model, context, creds.projectId, options);
			const requestHeaders: Record<string, string> = {
				Authorization: `Bearer ${creds.token}`,
				"Content-Type": "application/json",
				Accept: "text/event-stream",
				"User-Agent": getAntigravityUserAgent(),
				...(options?.headers ?? {}),
			};
			const bodyJson = JSON.stringify(requestBody);

			stream.push({ type: "start", partial: output });

			let responseBody: ReadableStream<Uint8Array> | undefined;
			let lastError: Error | undefined;
			for (let i = 0; i < ENDPOINT_FALLBACKS.length; i++) {
				const endpoint = ENDPOINT_FALLBACKS[i];
				const isLast = i === ENDPOINT_FALLBACKS.length - 1;
				try {
					const response = await fetch(`${endpoint}/v1internal:streamGenerateContent?alt=sse`, {
						method: "POST",
						headers: requestHeaders,
						body: bodyJson,
						signal: options?.signal,
					});
					if (!response.ok) {
						const errText = await response.text();
						let msg = `Cloud Code Assist API error (${response.status}): ${errText.slice(0, 800)}`;
						if (response.status === 404) {
							const wire = resolveWireModelId(model.id);
							msg += ` [model=${wire} project=${creds.projectId}]. Gemini 3 Pro needs -low/-high; try /model google-antigravity/gemini-3.1-pro-low or /login again to refresh discovery.`;
						}
						const err = new Error(msg);
						if (!isLast && (response.status >= 500 || response.status === 429 || response.status === 408)) {
							lastError = err;
							continue;
						}
						throw err;
					}
					if (!response.body) throw new Error("Cloud Code Assist returned empty body");
					responseBody = response.body;
					break;
				} catch (e) {
					lastError = e instanceof Error ? e : new Error(String(e));
					if (isLast || options?.signal?.aborted) throw lastError;
				}
			}
			if (!responseBody) {
				throw lastError ?? new Error("No response from Cloud Code Assist");
			}
			const sseIterator = readSseJson(responseBody, options?.signal);

			let currentKind: "text" | "thinking" | null = null;
			let sawFinish = false;
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

			for await (const chunk of sseIterator) {
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
						} else if (part.text === "" && part.thoughtSignature && !part.functionCall) {
							if (currentKind === "thinking") {
								const block = output.content[blockIndex()] as ThinkingContent;
								block.thinkingSignature = part.thoughtSignature;
							} else if (currentKind === "text") {
								const block = output.content[blockIndex()] as TextContent;
								block.textSignature = part.thoughtSignature;
							}
						}

						if (part.functionCall) {
							endCurrent();
							const providedId = part.functionCall.id;
							const needsNew =
								!providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);
							const toolCallId = needsNew
								? `call_${(part.functionCall.name || "tool").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}_${randomUUID().slice(0, 8)}`
								: providedId;
							const argsJson = JSON.stringify(part.functionCall.args ?? {});
							const toolCall: ToolCall = {
								type: "toolCall",
								id: toolCallId,
								name: part.functionCall.name || "",
								arguments: (part.functionCall.args ?? {}) as Record<string, unknown>,
								...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
							};
							output.content.push(toolCall);
							const idx = blockIndex();
							stream.push({ type: "toolcall_start", contentIndex: idx, partial: output });
							stream.push({ type: "toolcall_delta", contentIndex: idx, delta: argsJson, partial: output });
							stream.push({ type: "toolcall_end", contentIndex: idx, toolCall, partial: output });
						}
					}
				}

				if (candidate?.finishReason) {
					sawFinish = true;
					const mapped = mapStopReasonString(candidate.finishReason);
					if ((mapped === "stop" || mapped === "length") && output.content.some((b) => b.type === "toolCall")) {
						output.stopReason = "toolUse";
					} else {
						output.stopReason = mapped;
						if (mapped === "error") {
							output.errorMessage = `Generation failed with finish reason: ${candidate.finishReason}`;
						}
					}
				}

				if (responseData.usageMetadata) {
					const promptTokens = responseData.usageMetadata.promptTokenCount || 0;
					const cacheReadTokens = responseData.usageMetadata.cachedContentTokenCount || 0;
					const thinkingTokens = responseData.usageMetadata.thoughtsTokenCount || 0;
					output.usage = {
						input: Math.max(0, promptTokens - cacheReadTokens),
						output: (responseData.usageMetadata.candidatesTokenCount || 0) + thinkingTokens,
						cacheRead: cacheReadTokens,
						cacheWrite: 0,
						totalTokens: responseData.usageMetadata.totalTokenCount || 0,
						...(thinkingTokens > 0 ? { reasoning: thinkingTokens } : {}),
						cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
					};
					calculateCost(model, output.usage);
				}
			}

			endCurrent();

			if (options?.signal?.aborted) {
				output.stopReason = "aborted";
				output.errorMessage = output.errorMessage ?? "Request was aborted";
			}

			if (output.stopReason === "pending") {
				if (sawFinish) {
					output.stopReason = output.content.some((b) => b.type === "toolCall") ? "toolUse" : "stop";
				} else if (output.content.length > 0) {
					// Partial stream without finishReason — treat as stop if we got content
					output.stopReason = output.content.some((b) => b.type === "toolCall") ? "toolUse" : "stop";
				} else {
					throw new Error("Cloud Code Assist stream ended without content or finish reason");
				}
			}

			if (output.stopReason === "error" || output.stopReason === "aborted") {
				stream.push({ type: "error", reason: output.stopReason, error: output });
			} else {
				stream.push({ type: "done", reason: output.stopReason, message: output });
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

// =============================================================================
// Extension entry
// =============================================================================

/** Not used as extension entry — streamAntigravity is imported by stream.ts. */
export default function (_pi: ExtensionAPI) {
	/* no-op when loaded as a library module */
}
