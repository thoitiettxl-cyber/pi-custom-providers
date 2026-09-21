/**
 * Thin omp wrapper: openai-codex-device (headless/device ChatGPT Codex login).
 * Distinct from Pi first-party openai-codex (browser oauth-code on :1455).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider, type OmpStreamFn } from "../../shared/omp-thin.ts";
import { importOmp } from "../../shared/omp-import.ts";

async function loadStream(): Promise<OmpStreamFn> {
	const mod = await importOmp<{ streamOpenAICodexResponses: OmpStreamFn }>("@oh-my-pi/pi-ai/providers/openai-codex-responses");
	return mod.streamOpenAICodexResponses as OmpStreamFn;
}

export default async function openaiCodexDeviceExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "openai-codex-device",
		ompAuthId: "openai-codex-device",
		displayName: "ChatGPT Codex (device)",
		apiId: "openai-codex-responses",
		baseUrl: "https://chatgpt.com/backend-api",
		catalogId: "openai-codex",
		loadStreamFn: loadStream,
		streamLabel: "streamOpenAICodexResponses",
		loginHint: "/login openai-codex-device",
		ompProviderId: "openai-codex",
		ompApiId: "openai-codex-responses",
		infoCommand: "openai-codex-device-provider-info",
		fallbackModels: [
			{
				id: "gpt-5.5",
				name: "GPT-5.5",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 272000,
				maxTokens: 128000,
				api: "openai-codex-responses",
				baseUrl: "https://chatgpt.com/backend-api",
			},
		],
		notes: [
			"login: custom device/headless hook (omp openai-codex-device)",
			"models: same catalog as openai-codex; credentials live under this provider id in Pi auth.json",
			"prefer Pi /login openai-codex for interactive browser when available",
		],
	});
}
