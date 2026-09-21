/**
 * xai-omp: SuperGrok OAuth-web catalog + native OpenAI Responses stream.
 * Auth: Pi-compatible native SuperGrok device OAuth (shared/xai-oauth-native.ts).
 * Stream: shared/native-openai-responses.ts (fetch/SSE) — no @oh-my-pi provider stream.
 */
import "./bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider } from "../../shared/omp-thin.ts";
import { makeXaiNativeOAuth } from "../../shared/xai-oauth-native.ts";
import { createNativeOpenAIResponsesStreamSimple } from "../../shared/native-openai-responses.ts";

const BASE = "https://api.x.ai/v1";
const API = "openai-responses";
const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

export default async function xaiOmpExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "xai-omp",
		ompAuthId: "xai-oauth",
		storeCredentialsAs: "xai-oauth",
		displayName: "xAI Grok (SuperGrok OAuth)",
		apiId: API,
		baseUrl: BASE,
		catalogId: "xai-oauth",
		catalogLimit: 16,
		streamSimple: createNativeOpenAIResponsesStreamSimple({
			loginHint: "/login xai-omp",
			defaultBaseUrl: BASE,
		}),
		streamLabel: "native-openai-responses-fetch-sse",
		loginHint: "/login xai-omp",
		ompProviderId: "xai-oauth",
		ompApiId: API,
		infoCommand: "xai-omp-provider-info",
		oauthFactory: async () => makeXaiNativeOAuth("xAI Grok (SuperGrok OAuth)"),
		fallbackModels: [
			{
				id: "grok-4.6",
				name: "Grok 4.6",
				reasoning: true,
				input: ["text", "image"],
				cost: ZERO,
				contextWindow: 500000,
				maxTokens: 500000,
				api: API,
				baseUrl: BASE,
			},
			{
				id: "grok-4.5",
				name: "Grok 4.5",
				reasoning: true,
				input: ["text", "image"],
				cost: ZERO,
				contextWindow: 500000,
				maxTokens: 500000,
				api: API,
				baseUrl: BASE,
			},
			{
				id: "grok-4.3",
				name: "Grok 4.3",
				reasoning: true,
				input: ["text", "image"],
				cost: ZERO,
				contextWindow: 1000000,
				maxTokens: 1000000,
				api: API,
				baseUrl: BASE,
			},
			{
				id: "grok-4.20-0309-reasoning",
				name: "Grok 4.20 (Reasoning)",
				reasoning: true,
				input: ["text", "image"],
				cost: ZERO,
				contextWindow: 2000000,
				maxTokens: 2000000,
				api: API,
				baseUrl: BASE,
			},
			{
				id: "grok-4.20-0309-non-reasoning",
				name: "Grok 4.20 (Non-Reasoning)",
				reasoning: false,
				input: ["text", "image"],
				cost: ZERO,
				contextWindow: 2000000,
				maxTokens: 2000000,
				api: API,
				baseUrl: BASE,
			},
			{
				id: "grok-composer-2.5-fast",
				name: "Grok Composer 2.5 Fast",
				reasoning: false,
				input: ["text"],
				cost: ZERO,
				contextWindow: 200000,
				maxTokens: 200000,
				api: API,
				baseUrl: BASE,
			},
		],
		notes: [
			"SuperGrok OAuth-web catalog only (`xai-oauth`, ~9 models) — not the paid API-key `xai` bucket (~31)",
			"does not collide with Pi first-party provider id `xai` — this registers as `xai-omp`",
			"auth: Pi-compatible SuperGrok device OAuth (same client/tokens as first-party `xai`); refresh does not need omp registry",
			"login: `/login xai-omp` OR copy existing Pi `xai` oauth entry to `xai-omp` in auth.json (never commit secrets)",
			"stream: native OpenAI Responses fetch/SSE (shared/native-openai-responses.ts) — no @oh-my-pi stream",
		],
	});
}
