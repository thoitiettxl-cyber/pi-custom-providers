/**
 * Cursor model definitions for registerProvider.
 * Curated subset so /model works without catalog; optionally enrich from @oh-my-pi/pi-catalog.
 */

export type CursorModelDef = {
	id: string;
	name: string;
	reasoning: boolean;
	input: ("text" | "image")[];
	cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
	contextWindow: number;
	maxTokens: number;
	compat?: Record<string, unknown>;
	identity?: { class: string; family?: string; revision?: string };
};

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/** Stable curated subset (ids from oh-my-pi cursor catalog / quirks docs). */
export const CURATED_CURSOR_MODELS: CursorModelDef[] = [
	{
		id: "default",
		name: "Cursor Default",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "claude-4.6-opus-high",
		name: "Claude Opus 4.6",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "claude-4.5-sonnet",
		name: "Claude Sonnet 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "claude-4.6-sonnet-medium",
		name: "Claude Sonnet 4.6 1M",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 64_000,
	},
	{
		id: "claude-4.5-opus-high",
		name: "Claude Opus 4.5",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
	{
		id: "claude-opus-4-7-xhigh",
		name: "Claude Opus 4.7 1M",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 64_000,
	},
	{
		id: "gpt-5.2",
		name: "GPT-5.2",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 272_000,
		maxTokens: 64_000,
	},
	{
		id: "gpt-5.1",
		name: "GPT-5.1",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 272_000,
		maxTokens: 64_000,
	},
	{
		id: "gemini-3-flash",
		name: "Gemini 3 Flash",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 1_000_000,
		maxTokens: 64_000,
	},
	{
		id: "composer-1.5",
		name: "Composer 1.5",
		reasoning: true,
		input: ["text", "image"],
		cost: ZERO_COST,
		contextWindow: 200_000,
		maxTokens: 64_000,
	},
];

function mapCatalogModel(raw: Record<string, unknown>): CursorModelDef | null {
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
		typeof raw.maxTokens === "number"
			? raw.maxTokens
			: typeof raw.max_tokens === "number"
				? raw.max_tokens
				: 64_000;
	const inputRaw = raw.input;
	const input: ("text" | "image")[] = Array.isArray(inputRaw)
		? (inputRaw.filter((x) => x === "text" || x === "image") as ("text" | "image")[])
		: ["text", "image"];
	const compat =
		raw.compat && typeof raw.compat === "object" && !Array.isArray(raw.compat)
			? (raw.compat as Record<string, unknown>)
			: undefined;
	const identityRaw = raw.identity;
	const identity =
		identityRaw && typeof identityRaw === "object" && !Array.isArray(identityRaw)
			? (identityRaw as { class: string; family?: string; revision?: string })
			: undefined;
	return {
		id,
		name,
		reasoning,
		input: input.length ? input : ["text"],
		cost: ZERO_COST,
		contextWindow,
		maxTokens,
		...(compat ? { compat } : {}),
		...(identity?.class ? { identity } : {}),
	};
}

/**
 * Prefer catalog (full list); fall back to curated. Caps at `limit` for /model UX.
 */
export async function loadCursorModels(limit = 40): Promise<{
	models: CursorModelDef[];
	source: "catalog" | "curated";
	error?: string;
}> {
	try {
		const mod = await import("@oh-my-pi/pi-catalog/models");
		const getBundled = (mod as { getBundledModels?: (p: string) => unknown[] }).getBundledModels;
		if (typeof getBundled !== "function") {
			return { models: CURATED_CURSOR_MODELS, source: "curated", error: "getBundledModels missing" };
		}
		const rawList = getBundled("cursor") as Record<string, unknown>[];
		const mapped = rawList.map(mapCatalogModel).filter((m): m is CursorModelDef => Boolean(m));
		if (mapped.length === 0) {
			return { models: CURATED_CURSOR_MODELS, source: "curated", error: "catalog empty" };
		}
		const byId = new Map(mapped.map((m) => [m.id, m]));
		const preferred = CURATED_CURSOR_MODELS.map((c) => byId.get(c.id) ?? c);
		const preferredIds = new Set(preferred.map((m) => m.id));
		const rest = mapped.filter((m) => !preferredIds.has(m.id));
		return { models: [...preferred, ...rest].slice(0, limit), source: "catalog" };
	} catch (err) {
		return {
			models: CURATED_CURSOR_MODELS,
			source: "curated",
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
