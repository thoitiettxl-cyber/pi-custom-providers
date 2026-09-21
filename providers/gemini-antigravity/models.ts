/**
 * Google Antigravity model definitions for registerProvider.
 * Curated subset matches oh-my-pi catalog seeds / provider default-model.
 * Wire ids: collapsed catalog ids carry requestModelId (e.g. gemini-3.1-pro → gemini-3.1-pro-low).
 */

import "./bun-shim.ts";
import { importOmp } from "../../shared/omp-import.ts";
export type AntigravityModelDef = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	/** CCA wire model id when different from display id (404 if bare pro/flash used). */
	requestModelId?: string;
	identity?: { class: string; family?: string; revision?: string };
	compat?: Record<string, unknown>;
};

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const GEMINI_COMPAT: Record<string, unknown> = {
	supportsFunctionPartId: false,
	requiresSkipThoughtSignature: false,
	requiresSkipThoughtSignatureOnFirstFunctionCall: true,
	dropUnsignedThinking: false,
	ccaLegacyParametersSchema: false,
	multimodalFunctionResponse: true,
	flashStreamLeakWorkaround: false,
	claudeThinkingBetaHeader: false,
	antigravityClaudeToolMode: false,
	stripImageInput: false,
	thinkingLoopGuard: "gemini",
};

/** Stable curated subset from oh-my-pi seedModels("google-antigravity"). */
export const CURATED_ANTIGRAVITY_MODELS: AntigravityModelDef[] = [
	{
		id: "gemini-3.1-pro",
		name: "Gemini 3.1 Pro",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 1_048_576,
		maxTokens: 65_535,
		requestModelId: "gemini-3.1-pro-low",
		identity: { class: "gemini", family: "pro", revision: "3.1.0" },
		compat: { ...GEMINI_COMPAT },
	},
	{
		id: "gemini-3.7-flash",
		name: "Gemini 3.7 Flash",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		requestModelId: "gemini-3.7-flash-low",
		identity: { class: "gemini", family: "flash", revision: "3.7.0" },
		compat: { ...GEMINI_COMPAT, flashStreamLeakWorkaround: true, streamFirstEventTimeoutMs: 60_000 },
	},
	{
		id: "gemini-3.1-flash-lite",
		name: "Gemini 3.1 Flash Lite",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 1_048_576,
		maxTokens: 65_536,
		identity: { class: "gemini", family: "lite", revision: "3.1.0" },
		compat: { ...GEMINI_COMPAT },
	},
];

const metaById = new Map(CURATED_ANTIGRAVITY_MODELS.map((m) => [m.id, m]));

/** Lookup rich omp fields for stream adapter (requestModelId / identity / compat). */
export function resolveAntigravityModelMeta(id: string): AntigravityModelDef | undefined {
	return metaById.get(id);
}

function mapCatalogModel(raw: Record<string, unknown>): AntigravityModelDef | null {
	const id = typeof raw.id === "string" ? raw.id : null;
	if (!id) return null;
	const name = typeof raw.name === "string" ? raw.name : id;
	const reasoning = Boolean(raw.reasoning);
	const contextWindow =
		typeof raw.contextWindow === "number"
			? raw.contextWindow
			: typeof raw.context_window === "number"
				? raw.context_window
				: 1_048_576;
	const maxTokens =
		typeof raw.maxTokens === "number" ? raw.maxTokens : typeof raw.max_tokens === "number" ? raw.max_tokens : 65_536;
	const inputRaw = raw.input;
	const input: ("text" | "image")[] = Array.isArray(inputRaw)
		? (inputRaw.filter((x) => x === "text" || x === "image") as ("text" | "image")[])
		: ["text", "image"];
	const costRaw = raw.cost;
	const cost =
		costRaw && typeof costRaw === "object"
			? {
					input: Number((costRaw as { input?: number }).input) || 0,
					output: Number((costRaw as { output?: number }).output) || 0,
					cacheRead: Number((costRaw as { cacheRead?: number }).cacheRead) || 0,
					cacheWrite: Number((costRaw as { cacheWrite?: number }).cacheWrite) || 0,
				}
			: ZERO_COST;
	const requestModelId = typeof raw.requestModelId === "string" ? raw.requestModelId : undefined;
	const identity =
		raw.identity && typeof raw.identity === "object" ? (raw.identity as AntigravityModelDef["identity"]) : undefined;
	const compat = raw.compat && typeof raw.compat === "object" ? (raw.compat as Record<string, unknown>) : undefined;
	const def: AntigravityModelDef = {
		id,
		name,
		reasoning,
		input: input.length ? input : ["text", "image"],
		cost,
		contextWindow,
		maxTokens,
		requestModelId,
		identity,
		compat,
	};
	metaById.set(id, def);
	return def;
}

/**
 * Prefer catalog (full list); fall back to curated. Caps at `limit` for /model UX.
 */
export async function loadAntigravityModels(limit = 40): Promise<{
	models: AntigravityModelDef[];
	source: "catalog" | "curated";
	error?: string;
}> {
	try {
		const mod = await importOmp<{ getBundledModels?: (p: string) => unknown[] }>("@oh-my-pi/pi-catalog/models");
		const getBundled = mod.getBundledModels;
		if (typeof getBundled !== "function") {
			return { models: CURATED_ANTIGRAVITY_MODELS, source: "curated", error: "getBundledModels missing" };
		}
		const rawList = getBundled("google-antigravity") as Record<string, unknown>[];
		const mapped = rawList.map(mapCatalogModel).filter((m): m is AntigravityModelDef => Boolean(m));
		if (mapped.length === 0) {
			return { models: CURATED_ANTIGRAVITY_MODELS, source: "curated", error: "catalog empty" };
		}
		const byId = new Map(mapped.map((m) => [m.id, m]));
		const preferred = CURATED_ANTIGRAVITY_MODELS.map((c) => byId.get(c.id) ?? c);
		for (const m of preferred) metaById.set(m.id, m);
		const preferredIds = new Set(preferred.map((m) => m.id));
		const rest = mapped.filter((m) => !preferredIds.has(m.id));
		return { models: [...preferred, ...rest].slice(0, limit), source: "catalog" };
	} catch (err) {
		return {
			models: CURATED_ANTIGRAVITY_MODELS,
			source: "curated",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
