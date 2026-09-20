/**
 * Devin Provider Extension
 *
 * Registers Devin as a chat provider with OAuth `/login devin`
 * (PKCE + local callback 127.0.0.1:59653, paste fallback) and streamSimple
 * that talks to Cascade via @oh-my-pi/pi-ai streamDevin.
 *
 * Usage:
 *   cd packages/coding-agent/examples/extensions/custom-provider-devin && bun install
 *   pi -e ./packages/coding-agent/examples/extensions/custom-provider-devin
 *   # Then /login devin, /model devin/<id>, chat
 *
 * Or symlink:
 *   ln -sfn "$(pwd)/packages/coding-agent/examples/extensions/custom-provider-devin" ~/.pi/agent/extensions/devin
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURATED_DEVIN_MODELS, type DevinModelDef, loadDevinModels } from "./models.ts";
import { getDevinApiKey, loginDevin, refreshDevinToken } from "./oauth.ts";
import { DEVIN_API_ID, DEVIN_API_URL, probeStreamDevinImport, streamSimpleDevin } from "./stream.ts";

function toProviderModels(models: DevinModelDef[]) {
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

export default async function devinExtension(pi: ExtensionAPI) {
	const loaded = await loadDevinModels(40);
	const models = loaded.models.length > 0 ? loaded.models : CURATED_DEVIN_MODELS;

	pi.registerProvider("devin", {
		baseUrl: DEVIN_API_URL,
		api: DEVIN_API_ID,
		apiKey: "$DEVIN_API_KEY",
		models: toProviderModels(models),
		oauth: {
			name: "Devin",
			login: loginDevin,
			refreshToken: refreshDevinToken,
			getApiKey: getDevinApiKey,
		},
		streamSimple: streamSimpleDevin,
	});

	pi.registerCommand("devin-provider-info", {
		description: "Show Devin provider registration status (oauth + stream wrap); never prints tokens",
		handler: async (_args, ctx) => {
			const probe = await probeStreamDevinImport();
			const lines = [
				"Devin provider (earendil extension)",
				`api: ${DEVIN_API_ID}`,
				`baseUrl: ${DEVIN_API_URL}`,
				`models: ${models.length} (source=${loaded.source}${loaded.error ? `; note=${loaded.error}` : ""})`,
				`streamDevin_import: ${probe.ok ? "ok" : `FAIL: ${probe.error}`}`,
				`stream_engine: ${probe.engine ?? "unknown"} (runtime=${probe.runtime ?? "?"})`,
				"oauth: /login devin (PKCE + 127.0.0.1:59653/callback; paste-URL fallback; refresh=none)",
				"stream: streamSimple → bun-shim + omp streamDevin (Node-native Connect TBD in devin-native.ts)",
				"tools: NO Cursor-style execHandlers — Devin uses its own toolCalls channel in Connect chat",
			];
			const text = lines.join("\n");
			ctx.ui?.notify?.(text, probe.ok ? "info" : "warning");
			console.log(text);
		},
	});
}
