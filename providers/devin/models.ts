/**
 * Devin model definitions for registerProvider.
 * Static seeds match oh-my-pi catalog seed (swe-1-6, swe-1-6-fast).
 * Optionally enrich from @oh-my-pi/pi-catalog when available.
 */

import { importOmp } from "../../shared/omp-import.ts";

export type DevinModelDef = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
};

/** Stable curated subset from oh-my-pi seedModels("devin") / models.json. */
export const CURATED_DEVIN_MODELS: DevinModelDef[] = [
	{
		id: "swe-1-6",
		name: "SWE-1.6",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 128_000,
	},
	{
		id: "swe-1-6-fast",
		name: "SWE-1.6 Fast",
		reasoning: true,
		input: ["text"],
		cost: { input: 0.3, output: 1.5, cacheRead: 0.03, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 128_000,
	},
];

function mapCatalogModel(raw: Record<string, unknown>): DevinModelDef | null {
	const id = typeof raw.id === "string" ? raw.id : null;
	if (!id) return null;
	const name = typeof raw.name === "string" ? raw.name : id;
	const reasoning = Boolean(raw.reasoning);
	const contextWindow =
		typeof raw.contextWindow === "number"
			? raw.contextWindow
			: typeof raw.context_window === "number"
				? raw.context_window
				: 200_000;
	const maxTokens =
		typeof raw.maxTokens === "number" ? raw.maxTokens : typeof raw.max_tokens === "number" ? raw.max_tokens : 128_000;
	const inputRaw = raw.input;
	const input: ("text" | "image")[] = Array.isArray(inputRaw)
		? (inputRaw.filter((x) => x === "text" || x === "image") as ("text" | "image")[])
		: ["text"];
	const costRaw = raw.cost;
	const cost =
		costRaw && typeof costRaw === "object"
			? {
					input: Number((costRaw as { input?: number }).input) || 0,
					output: Number((costRaw as { output?: number }).output) || 0,
					cacheRead: Number((costRaw as { cacheRead?: number }).cacheRead) || 0,
					cacheWrite: Number((costRaw as { cacheWrite?: number }).cacheWrite) || 0,
				}
			: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
	return {
		id,
		name,
		reasoning,
		input: input.length ? input : ["text"],
		cost,
		contextWindow,
		maxTokens,
	};
}

/**
 * Prefer catalog (full list); fall back to curated. Caps at `limit` for /model UX.
 * Note: live Cascade catalog is credential-scoped; without DEVIN_API_KEY, seeds only.
 */
export async function loadDevinModels(limit = 40): Promise<{
	models: DevinModelDef[];
	source: "catalog" | "curated";
	error?: string;
}> {
	try {
		const mod = await importOmp<{ getBundledModels?: (p: string) => unknown[] }>("@oh-my-pi/pi-catalog/models");
		const getBundled = mod.getBundledModels;
		if (typeof getBundled !== "function") {
			return { models: CURATED_DEVIN_MODELS, source: "curated", error: "getBundledModels missing" };
		}
		const rawList = getBundled("devin") as Record<string, unknown>[];
		const mapped = rawList.map(mapCatalogModel).filter((m): m is DevinModelDef => Boolean(m));
		if (mapped.length === 0) {
			return { models: CURATED_DEVIN_MODELS, source: "curated", error: "catalog empty" };
		}
		const byId = new Map(mapped.map((m) => [m.id, m]));
		const preferred = CURATED_DEVIN_MODELS.map((c) => byId.get(c.id) ?? c);
		const preferredIds = new Set(preferred.map((m) => m.id));
		const rest = mapped.filter((m) => !preferredIds.has(m.id));
		return { models: [...preferred, ...rest].slice(0, limit), source: "catalog" };
	} catch (err) {
		return {
			models: CURATED_DEVIN_MODELS,
			source: "curated",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
