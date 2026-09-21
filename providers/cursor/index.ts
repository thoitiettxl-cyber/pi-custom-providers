/**
 * Cursor Provider Extension
 *
 * Registers Cursor as a chat provider with OAuth `/login cursor`
 * (loginDeepControl + poll api2.cursor.sh) and streamSimple that talks to
 * Cursor AgentService Run via native HTTP/2 Connect (cursor-native.ts).
 *
 * Usage:
 *   cd packages/coding-agent/examples/extensions/custom-provider-cursor && npm install
 *   pi -e ./packages/coding-agent/examples/extensions/custom-provider-cursor
 *   # Then /login cursor, /model cursor/<id>, chat
 *
 * Or symlink:
 *   ln -sfn "$(pwd)/packages/coding-agent/examples/extensions/custom-provider-cursor" ~/.pi/agent/extensions/cursor
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { CURATED_CURSOR_MODELS, loadCursorModels, type CursorModelDef } from "./models.ts";
import { loginCursor, refreshCursorToken } from "./oauth.ts";
import {
	CURSOR_API_ID,
	CURSOR_API_URL,
	probeStreamCursorImport,
	streamSimpleCursor,
} from "./stream.ts";

function toProviderModels(models: CursorModelDef[]) {
	return models.map((m) => ({
		id: m.id,
		name: m.name,
		reasoning: m.reasoning,
		input: m.input,
		cost: m.cost,
		contextWindow: m.contextWindow,
		maxTokens: m.maxTokens,
		// Pi requires baseUrl on custom models; stamp provider default explicitly.
		baseUrl: CURSOR_API_URL,
		api: CURSOR_API_ID,
		// omp streamCursor requires model.compat (even {}); identity.class when present.
		compat: m.compat ?? {},
		...(m.identity?.class ? { identity: m.identity } : {}),
	}));
}

export default async function cursorExtension(pi: ExtensionAPI) {
	const loaded = await loadCursorModels(40);
	const models = loaded.models.length > 0 ? loaded.models : CURATED_CURSOR_MODELS;

	pi.registerProvider("cursor", {
		baseUrl: CURSOR_API_URL,
		api: CURSOR_API_ID,
		apiKey: "$CURSOR_ACCESS_TOKEN",
		models: toProviderModels(models),
		oauth: {
			name: "Cursor",
			login: loginCursor,
			refreshToken: refreshCursorToken,
			getApiKey: (cred) => cred.access,
		},
		streamSimple: streamSimpleCursor,
	});

	pi.registerCommand("cursor-provider-info", {
		description:
			"Show Cursor provider registration status (oauth + stream wrap); never prints tokens",
		handler: async (_args, ctx) => {
			const probe = await probeStreamCursorImport();
			const lines = [
				"Cursor provider (earendil extension)",
				`api: ${CURSOR_API_ID}`,
				`baseUrl: ${CURSOR_API_URL}`,
				`models: ${models.length} (source=${loaded.source}${
					loaded.error ? `; note=${loaded.error}` : ""
				})`,
				`cursor_native_probe: ${probe.ok ? "ok" : `FAIL: ${probe.error}`}`,
				`stream_engine: ${probe.engine ?? "unknown"} (runtime=${probe.runtime ?? "?"})`,
				"oauth: /login cursor (loginDeepControl + poll; setTimeout sleep)",
				"stream: streamSimple → native HTTP/2 Connect AgentService/Run (cursor-native.ts)",
				"deferred: full omp CursorExecHandlers / MCP / quota UI (local exec-handlers for basics)",
			];
			const text = lines.join("\n");
			ctx.ui?.notify?.(text, probe.ok ? "info" : "warning");
			console.log(text);
		},
	});
}
