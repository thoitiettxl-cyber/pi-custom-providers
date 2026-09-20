/**
 * Thin omp wrapper: zai-coding-plan (Z.AI GLM coding-plan OAuth → minted API key).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider, type OmpStreamFn } from "../../shared/omp-thin.ts";

async function loadStream(): Promise<OmpStreamFn> {
	const mod = await import("@oh-my-pi/pi-ai/providers/anthropic");
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
		notes: [
			"oauth: oauth-code zcode:// callback (manual paste remote); after-exchange zai-mint-key",
			"stream via omp streamAnthropic with zai host shaping",
		],
	});
}
