/**
 * openai-codex-device: omp OAuth login + explicit native-unavailable stream (no omp stream fallback).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider } from "../../shared/omp-thin.ts";
import { createNativeUnavailableStreamSimple } from "../../shared/native-unavailable-stream.ts";

const BASE = "https://chatgpt.com/backend-api";
const API = "openai-codex-responses";

export default async function extension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "openai-codex-device",
		displayName: "ChatGPT Codex (device)",
		apiId: API,
		baseUrl: BASE,
		catalogId: "openai-codex",
		streamSimple: createNativeUnavailableStreamSimple({
			providerId: "openai-codex-device",
			reason: "ChatGPT Codex backend wire is large; native HTTP port pending",
			loginHint: "/login openai-codex-device",
		}),
		streamLabel: "native-unavailable-no-omp-fallback",
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
			"oauth: omp login hooks (catalog/auth only)",
			"stream: native unavailable — omp stream fallback disabled by policy",
			"ChatGPT Codex backend wire is large; native HTTP port pending",
		],
	});
}
