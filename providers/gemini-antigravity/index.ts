/**
 * Google Antigravity Provider Extension
 *
 * Registers Antigravity as a chat provider with OAuth `/login google-antigravity`
 * (PKCE + local callback 127.0.0.1:51121/oauth-callback, paste fallback) and
 * streamSimple that talks to Cloud Code Assist via @oh-my-pi/pi-ai streamGoogleGeminiCli.
 *
 * Usage:
 *   cd packages/coding-agent/examples/extensions/custom-provider-gemini-antigravity && bun install
 *   pi -e ./packages/coding-agent/examples/extensions/custom-provider-gemini-antigravity
 *   # Then /login google-antigravity, /model google-antigravity/<id>, chat
 *
 * Or symlink:
 *   ln -sfn "$(pwd)/packages/coding-agent/examples/extensions/custom-provider-gemini-antigravity" ~/.pi/agent/extensions/gemini-antigravity
 *
 * Named entry: gemini-antigravity.ts (re-exports this default).
 */

import "./bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type AntigravityModelDef, CURATED_ANTIGRAVITY_MODELS, loadAntigravityModels } from "./models.ts";
import { getAntigravityApiKey, loginAntigravity, refreshAntigravityToken } from "./oauth.ts";
import {
	ANTIGRAVITY_API_ID,
	ANTIGRAVITY_API_URL,
	ANTIGRAVITY_PROVIDER_ID,
	probeStreamGoogleGeminiCliImport,
	streamSimpleAntigravity,
} from "./stream.ts";

function toProviderModels(models: AntigravityModelDef[]) {
	return models.map((m) => ({
		id: m.id,
		name: m.name,
		reasoning: m.reasoning,
		input: m.input,
		cost: m.cost,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
	}));
}

export default async function antigravityExtension(pi: ExtensionAPI) {
	const loaded = await loadAntigravityModels(40);
	const models = loaded.models.length > 0 ? loaded.models : CURATED_ANTIGRAVITY_MODELS;

	pi.registerProvider(ANTIGRAVITY_PROVIDER_ID, {
		baseUrl: ANTIGRAVITY_API_URL,
		api: ANTIGRAVITY_API_ID,
		models: toProviderModels(models),
		oauth: {
			name: "Antigravity",
			login: loginAntigravity,
			refreshToken: refreshAntigravityToken,
			getApiKey: getAntigravityApiKey,
		},
		streamSimple: streamSimpleAntigravity,
	});

	pi.registerCommand("antigravity-provider-info", {
		description: "Show Antigravity provider registration status (oauth + stream wrap); never prints tokens",
		handler: async (_args, ctx) => {
			const probe = await probeStreamGoogleGeminiCliImport();
			const lines = [
				"Google Antigravity provider (earendil extension)",
				`provider: ${ANTIGRAVITY_PROVIDER_ID}`,
				`api: ${ANTIGRAVITY_API_ID}`,
				`baseUrl: ${ANTIGRAVITY_API_URL}`,
				`models: ${models.length} (source=${loaded.source}${loaded.error ? `; note=${loaded.error}` : ""})`,
				`default: gemini-3.1-pro (wire → gemini-3.1-pro-low)`,
				`streamGoogleGeminiCli_import: ${probe.ok ? "ok" : `FAIL: ${probe.error}`}`,
				"oauth: /login google-antigravity (PKCE + 127.0.0.1:51121/oauth-callback; paste-URL fallback; refresh + projectId)",
				"stream: streamSimple → streamGoogleGeminiCli (provider=google-antigravity, structured apiKey)",
				"deferred: quota ranking, multi-account, live discovery UI",
			];
			const text = lines.join("\n");
			ctx.ui?.notify?.(text, probe.ok ? "info" : "warning");
			console.log(text);
		},
	});
}
