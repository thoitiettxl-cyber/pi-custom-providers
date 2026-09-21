/**
 * google-gemini-cli: omp OAuth login + native CCA fetch/SSE stream (no omp stream).
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider } from "../../shared/omp-thin.ts";
import {
	createNativeGeminiCliStreamSimple,
	GEMINI_CLI_DEFAULT_ENDPOINT,
	GEMINI_CLI_API_ID,
	GEMINI_CLI_NATIVE_ENGINE,
} from "./gemini-cli-native.ts";

const BASE = GEMINI_CLI_DEFAULT_ENDPOINT;
const API = GEMINI_CLI_API_ID;

export default async function extension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "google-gemini-cli",
		displayName: "Google Gemini CLI",
		apiId: API,
		baseUrl: BASE,
		catalogId: "google-gemini-cli",
		streamSimple: createNativeGeminiCliStreamSimple({
			loginHint: "/login google-gemini-cli",
			defaultBaseUrl: BASE,
		}),
		streamLabel: GEMINI_CLI_NATIVE_ENGINE,
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
			`stream: native CCA fetch/SSE (${GEMINI_CLI_NATIVE_ENGINE})`,
			"wire: cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse (Gemini CLI headers)",
		],
	});
}
