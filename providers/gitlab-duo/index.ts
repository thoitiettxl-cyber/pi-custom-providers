/**
 * gitlab-duo: GitLab Duo OAuth (omp login) + native Anthropic Messages against AI Gateway.
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider } from "../../shared/omp-thin.ts";
import { createNativeAnthropicMessagesStreamSimple } from "../../shared/native-anthropic-messages.ts";

const BASE = "https://cloud.gitlab.com/ai/v1/proxy/anthropic";
const API = "anthropic-messages";

export default async function gitlabDuoExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "gitlab-duo",
		displayName: "GitLab Duo",
		apiId: API,
		baseUrl: BASE,
		catalogId: "gitlab-duo",
		streamSimple: createNativeAnthropicMessagesStreamSimple({
			loginHint: "/login gitlab-duo",
			defaultBaseUrl: BASE,
		}),
		streamLabel: "native-anthropic-messages-fetch-sse",
		loginHint: "/login gitlab-duo",
		infoCommand: "gitlab-duo-provider-info",
		fallbackModels: [
			{
				id: "claude-sonnet-4-5-20250929",
				name: "Claude Sonnet 4.5",
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
			"oauth: oauth-code PKCE; optional GITLAB_CLIENT_ID / GITLAB_REDIRECT_URI / GITLAB_TOKEN (omp login)",
			"stream: native Anthropic Messages fetch/SSE via GitLab AI Gateway",
		],
	});
}
