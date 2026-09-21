/**
 * Thin bridge from earendil ExtensionAPI oauth/stream to @oh-my-pi/pi-ai.
 * Do not vendor omp oauth/stream implementations — import hooks so
 * `pi update --extensions` (after Dependabot bumps) picks up omp fixes.
 */
import { installBunShim } from "./bun-shim.ts";
installBunShim();

import type {
	Api,
	AssistantMessage,
	AssistantMessageEvent,
	Model,
	OAuthCredentials,
	OAuthLoginCallbacks,
	SimpleStreamOptions,
	Tool,
} from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export type OmpModelIdentity = {
	class: string;
	family?: string;
	revision?: string;
	[key: string]: unknown;
};

export type ProviderModelDef = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	api?: string;
	baseUrl?: string;
	/** omp stream helpers read model.compat.* without optional chaining. */
	compat?: Record<string, unknown>;
	/** omp identity.class (e.g. xai) — not on earendil Model but applyExtension spreads extras. */
	identity?: OmpModelIdentity;
};

export type OmpStreamFn = (
	model: unknown,
	context: unknown,
	options?: unknown,
) => AsyncIterable<AssistantMessageEvent> & {
	result?: () => Promise<AssistantMessage>;
};

type StreamContext = {
	messages: Array<{ role: string; content?: unknown; tools?: Tool[] }>;
	systemPrompt?: string | string[];
	tools?: Tool[];
};

type OmpProviderDef = {
	id: string;
	name: string;
	login?: (callbacks: Record<string, unknown>) => Promise<OAuthCredentials | string>;
	refreshToken?: (credentials: OAuthCredentials, signal?: AbortSignal) => Promise<OAuthCredentials>;
	getApiKey?: (credentials: OAuthCredentials) => string;
	storeCredentialsAs?: string;
};

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

function adaptCallbacks(cb: OAuthLoginCallbacks): Record<string, unknown> {
	return {
		onAuth: (info: { url: string; instructions?: string; launchUrl?: string }) => {
			cb.onAuth({ url: info.url, instructions: info.instructions });
		},
		onPrompt: (prompt: { message: string; placeholder?: string; allowEmpty?: boolean }) =>
			cb.onPrompt({
				message: prompt.message,
				placeholder: prompt.placeholder,
				allowEmpty: prompt.allowEmpty,
			}),
		onProgress: cb.onProgress,
		onManualCodeInput: cb.onManualCodeInput
			? async (_signal?: AbortSignal) => cb.onManualCodeInput!()
			: undefined,
		signal: cb.signal,
		// Device-code flows in omp often surface via onAuth + onPrompt; map
		// verification URI into onDeviceCode when present for Pi UX.
		onDeviceCode: (info: {
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
		}) => {
			cb.onDeviceCode?.(info);
		},
	};
}

export async function loadOmpProviderDef(providerId: string): Promise<OmpProviderDef> {
	installBunShim();
	const mod = await import("@oh-my-pi/pi-ai/registry");
	const getDef = (mod as { getProviderDefinition?: (id: string) => OmpProviderDef | undefined })
		.getProviderDefinition;
	if (typeof getDef !== "function") {
		throw new Error(
			`@oh-my-pi/pi-ai/registry getProviderDefinition missing for "${providerId}" ` +
			`(import succeeded but export absent — Node/jiti often cannot load omp's TS package exports the same way bun does; ` +
			`run under bun, or use a provider with native oauthFactory e.g. xai-omp)`,
		);
	}
	const def = getDef(providerId);
	if (!def?.login) {
		throw new Error(`omp provider "${providerId}" has no login hook`);
	}
	return def;
}

export function makeOmpOAuth(providerId: string, displayName?: string) {
	return {
		name: displayName ?? providerId,
		login: async (callbacks: OAuthLoginCallbacks): Promise<OAuthCredentials> => {
			const def = await loadOmpProviderDef(providerId);
			const result = await def.login!(adaptCallbacks(callbacks));
			if (typeof result === "string") {
				return {
					access: result,
					refresh: "",
					expires: Number.MAX_SAFE_INTEGER,
				};
			}
			return result;
		},
		refreshToken: async (credentials: OAuthCredentials, signal: AbortSignal) => {
			const def = await loadOmpProviderDef(providerId);
			if (!def.refreshToken) return credentials;
			return def.refreshToken(credentials, signal);
		},
		getApiKey: (credentials: OAuthCredentials) => {
			// Prefer omp getApiKey when present (structured keys, muse minted key, etc.)
			// Sync path: use credential.access; async def load is not available here.
			return credentials.access;
		},
	};
}

/** Async getApiKey that consults omp def (call during register if needed). */
export async function resolveOmpGetApiKey(
	providerId: string,
): Promise<(credentials: OAuthCredentials) => string> {
	try {
		const def = await loadOmpProviderDef(providerId);
		if (def.getApiKey) return (c) => def.getApiKey!(c);
	} catch {
		/* fall through */
	}
	return (c) => c.access;
}

function resolveModelsJsonPath(): string {
	/**
	 * @oh-my-pi/pi-catalog only exposes ESM "import" conditions — createRequire
	 * cannot resolve package.json / models.json via exports. Walk resolve.paths
	 * and parents of this file so `pi install` git layouts (~/.pi/agent/git/...) work.
	 */
	const here = dirname(fileURLToPath(import.meta.url));
	const require = createRequire(import.meta.url);
	const candidates: string[] = [];

	for (const nodeModules of require.resolve.paths("@oh-my-pi/pi-catalog") ?? []) {
		candidates.push(join(nodeModules, "@oh-my-pi", "pi-catalog", "src", "models.json"));
	}

	let dir = here;
	for (let i = 0; i < 12; i++) {
		candidates.push(join(dir, "node_modules", "@oh-my-pi", "pi-catalog", "src", "models.json"));
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	candidates.push(join(here, "..", "node_modules", "@oh-my-pi", "pi-catalog", "src", "models.json"));

	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate;
	}

	return candidates[0] ?? join(here, "..", "node_modules", "@oh-my-pi", "pi-catalog", "src", "models.json");
}

export function loadCatalogModels(
	catalogProviderId: string,
	opts?: { limit?: number },
): { models: ProviderModelDef[]; source: string; error?: string } {
	try {
		const raw = JSON.parse(readFileSync(resolveModelsJsonPath(), "utf8")) as Record<
			string,
			Record<string, Record<string, unknown>>
		>;
		const bucket = raw[catalogProviderId];
		if (!bucket || typeof bucket !== "object") {
			return { models: [], source: "catalog-missing", error: `no models for ${catalogProviderId}` };
		}
		const models: ProviderModelDef[] = [];
		for (const entry of Object.values(bucket)) {
			const id = typeof entry.id === "string" ? entry.id : null;
			if (!id) continue;
			const inputRaw = entry.input;
			const input: ("text" | "image")[] = Array.isArray(inputRaw)
				? (inputRaw.filter((x) => x === "text" || x === "image") as ("text" | "image")[])
				: ["text"];
			const costRaw = (entry.cost as Record<string, number> | undefined) ?? ZERO_COST;
			const compat =
				entry.compat && typeof entry.compat === "object" && !Array.isArray(entry.compat)
					? (entry.compat as Record<string, unknown>)
					: undefined;
			const identityRaw = entry.identity;
			const identity =
				identityRaw && typeof identityRaw === "object" && !Array.isArray(identityRaw)
					? (identityRaw as OmpModelIdentity)
					: undefined;
			models.push({
				id,
				name: typeof entry.name === "string" ? entry.name : id,
				reasoning: Boolean(entry.reasoning),
				input,
				cost: {
					input: costRaw.input ?? 0,
					output: costRaw.output ?? 0,
					cacheRead: costRaw.cacheRead ?? 0,
					cacheWrite: costRaw.cacheWrite ?? 0,
				},
				contextWindow:
					typeof entry.contextWindow === "number" ? entry.contextWindow : 128_000,
				maxTokens: typeof entry.maxTokens === "number" ? entry.maxTokens : 16_384,
				api: typeof entry.api === "string" ? entry.api : undefined,
				baseUrl: typeof entry.baseUrl === "string" ? entry.baseUrl : undefined,
				...(compat ? { compat } : {}),
				...(identity?.class ? { identity } : {}),
			});
			if (opts?.limit && models.length >= opts.limit) break;
		}
		return { models, source: `omp-catalog:${catalogProviderId}` };
	} catch (err) {
		return {
			models: [],
			source: "catalog-error",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}

/** Prefer the richer catalog entry when merging duplicate model ids. */
function preferRicherModel(a: ProviderModelDef, b: ProviderModelDef): ProviderModelDef {
	const score = (m: ProviderModelDef) =>
		(m.name && m.name !== m.id ? 2 : 0) +
		(m.api ? 1 : 0) +
		(m.baseUrl ? 1 : 0) +
		(m.input?.length ?? 0) +
		(m.contextWindow > 0 ? 1 : 0) +
		(m.maxTokens > 0 ? 1 : 0) +
		(m.reasoning ? 1 : 0) +
		(m.compat ? 3 : 0) +
		(m.identity?.class ? 2 : 0);
	return score(b) > score(a) ? b : a;
}

/**
 * Load one or more omp catalog buckets and merge by model id (richer entry wins).
 */
export function loadCatalogModelsUnion(
	catalogIds: string[],
	opts?: { limit?: number },
): { models: ProviderModelDef[]; source: string; error?: string } {
	const byId = new Map<string, ProviderModelDef>();
	const sources: string[] = [];
	const errors: string[] = [];
	for (const catalogId of catalogIds) {
		// Load each bucket fully; apply opts.limit only after merge.
		const loaded = loadCatalogModels(catalogId);
		sources.push(loaded.source);
		if (loaded.error) errors.push(`${catalogId}: ${loaded.error}`);
		for (const m of loaded.models) {
			const prev = byId.get(m.id);
			byId.set(m.id, prev ? preferRicherModel(prev, m) : m);
		}
	}
	let models = [...byId.values()];
	if (opts?.limit && models.length > opts.limit) {
		models = models.slice(0, opts.limit);
	}
	return {
		models,
		source: sources.join("+"),
		...(errors.length ? { error: errors.join("; ") } : {}),
	};
}

export type ProviderModelDefaults = {
	baseUrl?: string;
	api?: string;
};

/**
 * Map catalog/fallback defs to Pi registerProvider models.
 * Always stamp baseUrl (and api when known): Pi requires baseUrl on custom models
 * when provider-level inheritance is missing (e.g. models.json merge edge cases).
 * Prefer per-model catalog values when present (gitlab-duo has dual anthropic/openai URLs).
 */
export function toProviderModels(models: ProviderModelDef[], defaults?: ProviderModelDefaults) {
	return models.map((m) => {
		const baseUrl = (m.baseUrl && m.baseUrl.trim()) || defaults?.baseUrl;
		const api = (m.api && m.api.trim()) || defaults?.api;
		if (!baseUrl) {
			throw new Error(
				`toProviderModels: model "${m.id}" has no baseUrl; pass provider default baseUrl`,
			);
		}
		return {
			id: m.id,
			name: m.name,
			reasoning: m.reasoning,
			input: m.input,
			cost: m.cost,
			contextWindow: m.contextWindow,
			maxTokens: m.maxTokens,
			baseUrl,
			...(api ? { api } : {}),
			// openai-responses / shared omp streams require model.compat (even {}).
			compat: m.compat ?? {},
			...(m.identity?.class ? { identity: m.identity } : {}),
		};
	});
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
	return { ...partial, api: model.api, provider: model.provider, model: model.id };
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

export type ThinStreamConfig = {
	providerId: string;
	apiId: string;
	baseUrl: string;
	/** Literal dynamic import of omp stream (must be static-analyzable at call site). */
	loadStreamFn: () => Promise<OmpStreamFn>;
	streamLabel: string;
	loginHint: string;
	/** Override omp model.provider / api fields. */
	ompProviderId?: string;
	ompApiId?: string;
};

export function createOmpStreamSimple(cfg: ThinStreamConfig) {
	let cached: OmpStreamFn | null | undefined;
	let cachedEngine: string | undefined;
	let cachedError: string | undefined;

	async function loadStream(): Promise<OmpStreamFn> {
		if (cached) return cached;
		if (cached === null) {
			throw new Error(cachedError ?? `${cfg.streamLabel} unavailable (previous import failed)`);
		}
		installBunShim();
		try {
			const fn = await cfg.loadStreamFn();
			if (typeof fn !== "function") {
				cached = null;
				cachedError = `${cfg.streamLabel} is not a function`;
				throw new Error(cachedError);
			}
			cached = fn;
			cachedEngine = `omp-${cfg.streamLabel}+bun-shim`;
			return cached;
		} catch (err) {
			cached = null;
			cachedError = err instanceof Error ? err.message : String(err);
			cachedEngine = undefined;
			throw err;
		}
	}

	function streamSimple(model: Model<Api>, context: StreamContext, options?: SimpleStreamOptions) {
		const out = createAssistantMessageEventStream();
		(async () => {
			try {
				const apiKey = options?.apiKey;
				if (!apiKey) {
					throw new Error(`No API key. Run ${cfg.loginHint}.`);
				}
				const streamFn = await loadStream();
				const modelExtra = model as Model<Api> & {
					compat?: Record<string, unknown>;
					identity?: OmpModelIdentity;
				};
				const ompModel = {
					id: model.id,
					name: model.name ?? model.id,
					api: cfg.ompApiId ?? cfg.apiId,
					provider: cfg.ompProviderId ?? cfg.providerId,
					baseUrl: model.baseUrl || cfg.baseUrl,
					reasoning: model.reasoning,
					input: model.input,
					cost: model.cost,
					contextWindow: model.contextWindow,
					maxTokens: model.maxTokens,
					// Required: omp reads model.compat.* / model.identity.class without ?.
					compat: modelExtra.compat ?? {},
					identity: modelExtra.identity ?? { class: "unknown", family: model.id },
				};
				const ompContext = {
					systemPrompt: extractSystemPrompt(context),
					messages: context.messages.filter((m) => m.role !== "system"),
					tools: extractTools(context),
				};
				const inner = streamFn(ompModel, ompContext, {
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

	async function probe(): Promise<{ ok: boolean; error?: string; engine?: string; runtime?: string }> {
		const bun = (globalThis as { Bun?: { version?: string } }).Bun;
		const runtime =
			typeof bun?.version === "string" && bun.version.includes("node-shim")
				? "node+bun-shim"
				: typeof bun !== "undefined"
					? "bun-or-shim"
					: "node";
		try {
			await loadStream();
			return { ok: true, engine: cachedEngine, runtime };
		} catch (err) {
			return { ok: false, error: err instanceof Error ? err.message : String(err), runtime };
		}
	}

	return { streamSimple, probe, cfg };
}

export type ThinProviderOptions = {
	/** Pi registerProvider id (/login id). */
	id: string;
	/** omp auth registry id (login hooks). */
	ompAuthId?: string;
	/**
	 * Optional credential storage key hint for docs / future Pi support.
	 * Pi ProviderConfig oauth has no storeCredentialsAs today — credentials persist
	 * under the registerProvider id. Documented in notes when set.
	 */
	storeCredentialsAs?: string;
	displayName: string;
	apiId: string;
	baseUrl: string;
	/** Catalog bucket for models.json (may differ from id, e.g. zai for zai-coding-plan). */
	catalogId: string;
	/** Extra omp catalog buckets merged by model id (richer entry wins). */
	extraCatalogIds?: string[];
	/** Max models after merge (default 40; raise for large catalogs e.g. xai ~31). */
	catalogLimit?: number;
	loadStreamFn: () => Promise<OmpStreamFn>;
	streamLabel: string;
	loginHint: string;
	ompProviderId?: string;
	ompApiId?: string;
	infoCommand?: string;
	notes?: string[];
	fallbackModels?: ProviderModelDef[];
	/**
	 * Optional custom OAuth factory. When set, skips makeOmpOAuth / loadOmpProviderDef
	 * (and resolveOmpGetApiKey) so auth works without omp registry exports.
	 */
	oauthFactory?: () => Promise<{
		name: string;
		login: (callbacks: OAuthLoginCallbacks) => Promise<OAuthCredentials>;
		refreshToken: (credentials: OAuthCredentials, signal: AbortSignal) => Promise<OAuthCredentials>;
		getApiKey: (credentials: OAuthCredentials) => string;
	}>;
};

/**
 * Register a thin omp-backed provider on Pi ExtensionAPI.
 */
export async function registerThinOmpProvider(pi: ExtensionAPI, opts: ThinProviderOptions) {
	installBunShim();
	const authId = opts.ompAuthId ?? opts.id;
	const catalogLimit = opts.catalogLimit ?? 40;
	const catalogIds = [opts.catalogId, ...(opts.extraCatalogIds ?? [])];
	const loaded =
		catalogIds.length > 1
			? loadCatalogModelsUnion(catalogIds, { limit: catalogLimit })
			: loadCatalogModels(opts.catalogId, { limit: catalogLimit });
	const models =
		loaded.models.length > 0 ? loaded.models : (opts.fallbackModels ?? []);
	const oauth = opts.oauthFactory
		? await opts.oauthFactory()
		: makeOmpOAuth(authId, opts.displayName);
	const getApiKey = opts.oauthFactory
		? oauth.getApiKey
		: await resolveOmpGetApiKey(authId);
	const stream = createOmpStreamSimple({
		providerId: opts.id,
		apiId: opts.apiId,
		baseUrl: opts.baseUrl,
		loadStreamFn: opts.loadStreamFn,
		streamLabel: opts.streamLabel,
		loginHint: opts.loginHint,
		ompProviderId: opts.ompProviderId ?? opts.id,
		ompApiId: opts.ompApiId ?? opts.apiId,
	});

	if (!opts.baseUrl?.trim()) {
		throw new Error(`registerThinOmpProvider(${opts.id}): baseUrl is required`);
	}

	pi.registerProvider(opts.id, {
		baseUrl: opts.baseUrl,
		api: opts.apiId,
		models: toProviderModels(models, { baseUrl: opts.baseUrl, api: opts.apiId }),
		oauth: {
			name: opts.displayName,
			login: oauth.login,
			refreshToken: oauth.refreshToken,
			getApiKey,
		},
		streamSimple: stream.streamSimple,
	});

	const cmd = opts.infoCommand ?? `${opts.id.replace(/[^a-z0-9]+/gi, "-")}-provider-info`;
	pi.registerCommand(cmd, {
		description: `Show ${opts.displayName} thin-omp provider status (never prints tokens)`,
		handler: async (_args, ctx) => {
			const probe = await stream.probe();
			const lines = [
				`${opts.displayName} (thin omp wrapper)`,
				`provider: ${opts.id}`,
				`omp_auth: ${opts.oauthFactory ? "(native oauthFactory)" : authId}`,
				`api: ${opts.apiId}`,
				`baseUrl: ${opts.baseUrl}`,
				`models: ${models.length} (source=${loaded.source}${loaded.error ? `; note=${loaded.error}` : ""})`,
				`stream_import: ${probe.ok ? "ok" : `FAIL: ${probe.error}`}`,
				`stream_engine: ${probe.engine ?? "unknown"} (runtime=${probe.runtime ?? "?"})`,
				`login: ${opts.loginHint}`,
				`catalog: ${catalogIds.join("+")} (limit=${catalogLimit})`,
				...(opts.storeCredentialsAs
					? [
							`credentials_key_hint: ${opts.storeCredentialsAs} (Pi stores under provider id ${opts.id}; no storeCredentialsAs on ProviderConfig)`,
						]
					: []),
				"update: dependabot bumps @oh-my-pi/* → merge → pi update --extensions",
				...(opts.notes ?? []),
			];
			const text = lines.join("\n");
			ctx.ui?.notify?.(text, probe.ok ? "info" : "warning");
			console.log(text);
		},
	});

	return { models, loaded, stream };
}
