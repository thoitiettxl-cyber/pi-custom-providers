/**
 * gitlab-duo-agent: omp OAuth login + explicit native-unavailable stream (no omp stream fallback).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider } from "../../shared/omp-thin.ts";
import { createNativeUnavailableStreamSimple } from "../../shared/native-unavailable-stream.ts";

const BASE = "https://gitlab.com";
const API = "gitlab-duo-agent";

export default async function extension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "gitlab-duo-agent",
		displayName: "GitLab Duo Agent",
		apiId: API,
		baseUrl: BASE,
		catalogId: "gitlab-duo-agent",
		streamSimple: createNativeUnavailableStreamSimple({
			providerId: "gitlab-duo-agent",
			reason: "Duo Agent WebSocket/workflow wire is large; native port pending",
			loginHint: "/login gitlab-duo-agent",
		}),
		streamLabel: "native-unavailable-no-omp-fallback",
		loginHint: "/login gitlab-duo-agent",
		infoCommand: "gitlab-duo-agent-provider-info",
		fallbackModels: [
			{
				id: "claude_sonnet_4_6_vertex",
				name: "Claude Sonnet 4.6 (Duo Agent)",
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
			"oauth: omp login hooks (catalog/auth only)",
			"stream: native unavailable — omp stream fallback disabled by policy",
			"Duo Agent WebSocket/workflow wire is large; native port pending",
		],
	});
}
