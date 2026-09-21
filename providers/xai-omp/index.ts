/**
 * Thin omp wrapper: xai-omp (full omp Grok catalog; does not collide with Pi first-party `xai`).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider, type OmpStreamFn } from "../../shared/omp-thin.ts";

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
		ompAuthId: "xai-oauth",
		// Pi ProviderConfig has no storeCredentialsAs; /login xai-omp persists under "xai-omp".
		// Hint documents omp auth bucket (SuperGrok OAuth) for users copying creds.
		storeCredentialsAs: "xai-oauth",
		displayName: "xAI Grok (omp catalog)",
		apiId: API,
		baseUrl: BASE,
		catalogId: "xai",
		extraCatalogIds: ["xai-oauth"],
		catalogLimit: 64,
		loadStreamFn: loadStream,
		streamLabel: "streamOpenAIResponses",
		loginHint: "/login xai-omp",
		ompProviderId: "xai",
		ompApiId: API,
		infoCommand: "xai-omp-provider-info",
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
				maxTokens: 30000,
				api: API,
				baseUrl: BASE,
			},
			{
				id: "grok-code-fast-1",
				name: "Grok Code Fast 1",
				reasoning: true,
				input: ["text"],
				cost: ZERO,
				contextWindow: 256000,
				maxTokens: 10000,
				api: API,
				baseUrl: BASE,
			},
			{
				id: "grok-4.20-0309-reasoning",
				name: "Grok 4.20 (Reasoning)",
				reasoning: true,
				input: ["text", "image"],
				cost: ZERO,
				contextWindow: 1000000,
				maxTokens: 30000,
				api: API,
				baseUrl: BASE,
			},
		],
		notes: [
			"supersedes thin Pi built-in `xai` catalog (~3 models) with full omp `xai`+`xai-oauth` union (~34)",
			"does not collide with Pi first-party provider id `xai` — this registers as `xai-omp`",
			"oauth hooks from omp `xai-oauth` (SuperGrok); Pi stores credentials under provider id `xai-omp`",
			"login: `/login xai-omp` OR copy existing Pi `xai` oauth entry to `xai-omp` in auth.json (never commit secrets)",
			"update: Dependabot bumps @oh-my-pi/* → merge → pi update --extensions",
		],
	});
}
