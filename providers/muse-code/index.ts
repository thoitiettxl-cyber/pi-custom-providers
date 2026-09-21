/**
 * muse-code: Meta Muse device-code OAuth (omp login) + native OpenAI Responses stream.
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider } from "../../shared/omp-thin.ts";
import { createNativeOpenAIResponsesStreamSimple } from "../../shared/native-openai-responses.ts";

const BASE = "https://api.meta.ai/v1";
const API = "openai-responses";

export default async function museCodeExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "muse-code",
		displayName: "Muse Code",
		apiId: API,
		baseUrl: BASE,
		catalogId: "muse-code",
		streamSimple: createNativeOpenAIResponsesStreamSimple({
			loginHint: "/login muse-code",
			defaultBaseUrl: BASE,
		}),
		streamLabel: "native-openai-responses-fetch-sse",
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
				api: API,
				baseUrl: BASE,
			},
		],
		notes: [
			"oauth: device-code + after-exchange muse-code-key mint (omp login hooks)",
			"stream: native OpenAI Responses fetch/SSE (shared/native-openai-responses.ts)",
		],
	});
}
