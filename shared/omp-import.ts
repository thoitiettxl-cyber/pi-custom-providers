/**
 * Load @oh-my-pi/* under Node+jiti (Pi `node … -p`) and real Bun.
 *
 * Node's native ESM loader refuses to strip types for TypeScript under
 * node_modules (including bun's node_modules/.bun layout), which breaks
 * `await import("@oh-my-pi/pi-ai/…")`. Real Bun can load those .ts sources;
 * under Node we load via jiti instead.
 *
 * Never logs secrets.
 */
import { installBunShim } from "./bun-shim.ts";

type JitiLike = {
	import: (id: string) => Promise<unknown>;
};

let jitiInstance: JitiLike | null = null;
let jitiLoading: Promise<JitiLike> | null = null;

/** True when global Bun is the real runtime (not our 0.0.0-node-shim). */
export function isRealBun(): boolean {
	const bun = (globalThis as { Bun?: { version?: string } }).Bun;
	return (
		typeof bun !== "undefined" &&
		typeof bun.version === "string" &&
		!bun.version.includes("node-shim")
	);
}

async function getJiti(): Promise<JitiLike> {
	if (jitiInstance) return jitiInstance;
	if (jitiLoading) return jitiLoading;
	jitiLoading = (async () => {
		const { createJiti } = await import("jiti");
		jitiInstance = createJiti(import.meta.url, { interopDefault: true }) as JitiLike;
		return jitiInstance;
	})();
	try {
		return await jitiLoading;
	} finally {
		jitiLoading = null;
	}
}

/**
 * Dynamic-import an @oh-my-pi (or other) specifier.
 * Call after / instead of bare `await import(specifier)` for omp TS packages.
 */
export async function importOmp<T = unknown>(specifier: string): Promise<T> {
	installBunShim();
	if (isRealBun()) {
		return (await import(specifier)) as T;
	}
	const jiti = await getJiti();
	return (await jiti.import(specifier)) as T;
}
