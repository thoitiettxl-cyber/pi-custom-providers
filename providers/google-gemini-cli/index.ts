/**
 * google-gemini-cli: omp OAuth login + explicit native-unavailable stream (no omp stream fallback).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider } from "../../shared/omp-thin.ts";
import { createNativeUnavailableStreamSimple } from "../../shared/native-unavailable-stream.ts";

const BASE = "https://cloudcode-pa.googleapis.com";
const API = "google-gemini-cli";

export default async function extension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "google-gemini-cli",
		displayName: "Google Gemini CLI",
		apiId: API,
		baseUrl: BASE,
		catalogId: "google-gemini-cli",
		streamSimple: createNativeUnavailableStreamSimple({
			providerId: "google-gemini-cli",
			reason: "Cloud Code Assist Connect/CCA port still pending (use google-antigravity for native CCA)",
			loginHint: "/login google-gemini-cli",
		}),
		streamLabel: "native-unavailable-no-omp-fallback",
		loginHint: "/login google-gemini-cli",
		infoCommand: "google-gemini-cli-provider-info",
		fallbackModels: [
			{
				id: "gemini-2.5-pro",
				name: "Gemini 2.5 Pro",
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
			"Cloud Code Assist Connect/CCA port still pending (use google-antigravity for native CCA)",
		],
	});
}
