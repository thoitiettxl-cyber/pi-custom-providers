/**
 * gitlab-duo-agent: omp OAuth login + native Anthropic Messages via GitLab AI Gateway.
 *
 * Full Duo Agent Platform WebSocket workflow (omp streamGitLabDuoWorkflow) is deferred —
 * this ships the viable native HTTP chat path (same AI Gateway Anthropic proxy as
 * gitlab-duo). Prefer working stream over stub.
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider } from "../../shared/omp-thin.ts";
import { createNativeAnthropicMessagesStreamSimple } from "../../shared/native-anthropic-messages.ts";

const BASE = "https://cloud.gitlab.com/ai/v1/proxy/anthropic";
const API = "anthropic-messages";
const ENGINE = "gitlab-duo-agent-native-anthropic-gateway-fetch-sse";

export default async function extension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "gitlab-duo-agent",
		displayName: "GitLab Duo Agent",
		apiId: API,
		baseUrl: BASE,
		catalogId: "gitlab-duo-agent",
		// Also surface gitlab-duo anthropic-friendly model ids when agent catalog is sparse.
		extraCatalogIds: ["gitlab-duo"],
		streamSimple: createNativeAnthropicMessagesStreamSimple({
			loginHint: "/login gitlab-duo-agent",
			defaultBaseUrl: BASE,
		}),
		streamLabel: ENGINE,
		loginHint: "/login gitlab-duo-agent",
		infoCommand: "gitlab-duo-agent-provider-info",
		fallbackModels: [
			{
				id: "claude-sonnet-4-5-20250929",
				name: "Claude Sonnet 4.5 (Duo Agent HTTP)",
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
			"oauth: omp login hooks (vscode:// callback — paste URL if needed)",
			`stream: native Anthropic Messages via GitLab AI Gateway (${ENGINE})`,
			"deferred: full Duo Agent Platform WebSocket ambient workflow (omp gitlab-duo-workflow)",
			"prefer /login gitlab-duo for the same HTTP chat path with Duo chat OAuth",
		],
	});
}
