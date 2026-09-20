/**
 * Thin omp wrapper: gitlab-duo-agent (Duo Agent / workflow WebSocket).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider, type OmpStreamFn } from "../../shared/omp-thin.ts";

async function loadStream(): Promise<OmpStreamFn> {
	const mod = await import("@oh-my-pi/pi-ai/providers/gitlab-duo-workflow");
	return mod.streamGitLabDuoWorkflow as OmpStreamFn;
}

export default async function gitlabDuoAgentExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "gitlab-duo-agent",
		displayName: "GitLab Duo Agent",
		apiId: "gitlab-duo-agent",
		baseUrl: "https://gitlab.com",
		catalogId: "gitlab-duo-agent",
		loadStreamFn: loadStream,
		streamLabel: "streamGitLabDuoWorkflow",
		loginHint: "/login gitlab-duo-agent",
		infoCommand: "gitlab-duo-agent-provider-info",
		notes: [
			"oauth: oauth-code with vscode:// manual callback (paste URL if needed)",
			"stream may prefer Bun host for WebSocket path — bun-shim installed; full Bun recommended",
		],
	});
}
