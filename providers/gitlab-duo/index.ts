/**
 * Thin omp wrapper: gitlab-duo (non-agentic AI Gateway).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider, type OmpStreamFn } from "../../shared/omp-thin.ts";

async function loadStream(): Promise<OmpStreamFn> {
	const mod = await import("@oh-my-pi/pi-ai/providers/gitlab-duo");
	return mod.streamGitLabDuo as OmpStreamFn;
}

export default async function gitlabDuoExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "gitlab-duo",
		displayName: "GitLab Duo",
		apiId: "anthropic-messages",
		baseUrl: "https://cloud.gitlab.com/ai/v1/proxy/anthropic/",
		catalogId: "gitlab-duo",
		loadStreamFn: loadStream,
		streamLabel: "streamGitLabDuo",
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
				api: "anthropic-messages",
				baseUrl: "https://cloud.gitlab.com/ai/v1/proxy/anthropic/",
			},
		],
		notes: [
			"oauth: oauth-code PKCE; optional GITLAB_CLIENT_ID / GITLAB_REDIRECT_URI / GITLAB_TOKEN",
			"earendil example exists but is not a bundled first-party OAuth provider — this tracks omp",
		],
	});
}
