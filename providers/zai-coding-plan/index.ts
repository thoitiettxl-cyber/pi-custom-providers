/**
 * zai-coding-plan: Z.AI coding-plan OAuth (omp login) + native Anthropic Messages stream.
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider } from "../../shared/omp-thin.ts";
import { createNativeAnthropicMessagesStreamSimple } from "../../shared/native-anthropic-messages.ts";

const BASE = "https://api.z.ai/api/anthropic";
const API = "anthropic-messages";

export default async function zaiCodingPlanExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "zai-coding-plan",
		ompAuthId: "zai-coding-plan",
		displayName: "Z.AI Coding Plan",
		apiId: API,
		baseUrl: BASE,
		catalogId: "zai",
		streamSimple: createNativeAnthropicMessagesStreamSimple({
			loginHint: "/login zai-coding-plan",
			defaultBaseUrl: BASE,
		}),
		streamLabel: "native-anthropic-messages-fetch-sse",
		loginHint: "/login zai-coding-plan",
		ompProviderId: "zai",
		ompApiId: API,
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
				api: API,
				baseUrl: BASE,
			},
		],
		notes: [
			"oauth: oauth-code zcode:// callback (manual paste remote); after-exchange zai-mint-key (omp login)",
			"stream: native Anthropic Messages fetch/SSE (shared/native-anthropic-messages.ts)",
		],
	});
}
