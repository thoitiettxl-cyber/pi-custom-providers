/**
 * openai-codex-device: omp OAuth login + native Codex Responses HTTP SSE (no omp stream).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider } from "../../shared/omp-thin.ts";
import {
	CODEX_BASE_URL,
	CODEX_NATIVE_ENGINE,
	createNativeCodexStreamSimple,
} from "./codex-native.ts";

const BASE = CODEX_BASE_URL;
const API = "openai-codex-responses";

export default async function extension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "openai-codex-device",
		displayName: "ChatGPT Codex (device)",
		apiId: API,
		baseUrl: BASE,
		catalogId: "openai-codex",
		streamSimple: createNativeCodexStreamSimple({
			loginHint: "/login openai-codex-device",
			defaultBaseUrl: BASE,
		}),
		streamLabel: CODEX_NATIVE_ENGINE,
		loginHint: "/login openai-codex-device",
		infoCommand: "openai-codex-device-provider-info",
		fallbackModels: [
			{
				id: "gpt-5.5",
				name: "GPT-5.5",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 64000,
				api: API,
				baseUrl: BASE,
			},
		],
		notes: [
			"oauth: omp login hooks (device/headless Codex)",
			`stream: native Codex Responses fetch/SSE (${CODEX_NATIVE_ENGINE})`,
			"wire: POST chatgpt.com/backend-api/codex/responses (SSE; WS/compaction deferred)",
		],
	});
}
