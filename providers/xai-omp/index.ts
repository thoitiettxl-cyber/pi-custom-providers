/**
 * Thin omp wrapper: xai-omp (SuperGrok OAuth-web catalog only; does not collide with Pi first-party `xai`).
 * Auth uses Pi-compatible native SuperGrok device OAuth (same tokens as `xai`) — no omp registry.
 */
import "./bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider, type OmpStreamFn } from "../../shared/omp-thin.ts";
import { makeXaiNativeOAuth } from "../../shared/xai-oauth-native.ts";

const BASE = "https://api.x.ai/v1";
const API = "openai-responses";
const ZERO = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

async function loadStream(): Promise<OmpStreamFn> {
	const mod = await import("@oh-my-pi/pi-ai/providers/openai-responses");
	return mod.streamOpenAIResponses as OmpStreamFn;
}

export default async function xaiOmpExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "xai-omp",
		// Auth is native; ompAuthId unused when oauthFactory is set (kept for docs/info clarity).
		ompAuthId: "xai-oauth",
		// Pi ProviderConfig has no storeCredentialsAs; /login xai-omp persists under "xai-omp".
		// Hint documents omp auth bucket (SuperGrok OAuth) for users copying creds.
		storeCredentialsAs: "xai-oauth",
		displayName: "xAI Grok (SuperGrok OAuth)",
		apiId: API,
		baseUrl: BASE,
		catalogId: "xai-oauth",
		catalogLimit: 16,
		loadStreamFn: loadStream,
		streamLabel: "streamOpenAIResponses",
		loginHint: "/login xai-omp",
		// openai-shared treats both xai and xai-oauth for SuperGrok stream shaping
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
			"stream still via omp `streamOpenAIResponses` (+ bun-shim under Node)",
			"update: Dependabot bumps @oh-my-pi/* → merge → pi update --extensions",
		],
	});
}
