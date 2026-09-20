/**
 * Thin omp wrapper: muse-code (Meta Muse subscription device-code).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider, type OmpStreamFn } from "../../shared/omp-thin.ts";

async function loadStream(): Promise<OmpStreamFn> {
	const mod = await import("@oh-my-pi/pi-ai/providers/openai-responses");
	return mod.streamOpenAIResponses as OmpStreamFn;
}

export default async function museCodeExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "muse-code",
		displayName: "Muse Code",
		apiId: "openai-responses",
		baseUrl: "https://api.meta.ai/v1",
		catalogId: "muse-code",
		loadStreamFn: loadStream,
		streamLabel: "streamOpenAIResponses",
		loginHint: "/login muse-code",
		infoCommand: "muse-code-provider-info",
		fallbackModels: [
			{
				id: "muse-spark-1.1",
				name: "Muse Spark 1.1",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128000,
				maxTokens: 16384,
				api: "openai-responses",
				baseUrl: "https://api.meta.ai/v1",
			},
		],
		notes: [
			"oauth: device-code + after-exchange muse-code-key mint",
			"stream via omp streamOpenAIResponses with muse-code provider transport",
		],
	});
}
