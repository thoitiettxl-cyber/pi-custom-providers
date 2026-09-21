/**
 * Thin omp wrapper: zai-coding-plan (Z.AI GLM coding-plan OAuth → minted API key).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider, type OmpStreamFn } from "../../shared/omp-thin.ts";
import { importOmp } from "../../shared/omp-import.ts";

async function loadStream(): Promise<OmpStreamFn> {
	const mod = await importOmp<{ streamAnthropic: OmpStreamFn }>("@oh-my-pi/pi-ai/providers/anthropic");
	return mod.streamAnthropic as OmpStreamFn;
}

export default async function zaiCodingPlanExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "zai-coding-plan",
		ompAuthId: "zai-coding-plan",
		displayName: "Z.AI Coding Plan",
		apiId: "anthropic-messages",
		baseUrl: "https://api.z.ai/api/anthropic",
		catalogId: "zai",
		loadStreamFn: loadStream,
		streamLabel: "streamAnthropic",
		loginHint: "/login zai-coding-plan",
		ompProviderId: "zai",
		ompApiId: "anthropic-messages",
		infoCommand: "zai-coding-plan-provider-info",
		fallbackModels: [
			{
				id: "glm-4.6",
				name: "GLM-4.6",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 128000,
				api: "anthropic-messages",
				baseUrl: "https://api.z.ai/api/anthropic",
			},
		],
		notes: [
			"oauth: oauth-code zcode:// callback (manual paste remote); after-exchange zai-mint-key",
			"stream via omp streamAnthropic with zai host shaping",
		],
	});
}
