/**
 * Thin omp wrapper: google-gemini-cli (Cloud Code Assist / Gemini CLI OAuth).
 * Stream + login come from @oh-my-pi/pi-ai — not vendored copies.
 */
import "../../shared/bun-shim.ts";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerThinOmpProvider, type OmpStreamFn } from "../../shared/omp-thin.ts";
import { importOmp } from "../../shared/omp-import.ts";

async function loadStream(): Promise<OmpStreamFn> {
	const mod = await importOmp<{ streamGoogleGeminiCli: OmpStreamFn }>("@oh-my-pi/pi-ai/providers/google-gemini-cli");
	return mod.streamGoogleGeminiCli as OmpStreamFn;
}

export default async function googleGeminiCliExtension(pi: ExtensionAPI) {
	await registerThinOmpProvider(pi, {
		id: "google-gemini-cli",
		displayName: "Google Gemini CLI",
		apiId: "google-gemini-cli",
		baseUrl: "https://cloudcode-pa.googleapis.com",
		catalogId: "google-gemini-cli",
		loadStreamFn: loadStream,
		streamLabel: "streamGoogleGeminiCli",
		loginHint: "/login google-gemini-cli",
		infoCommand: "google-gemini-cli-provider-info",
		fallbackModels: [
			{
				id: "gemini-2.5-pro",
				name: "Gemini 2.5 Pro",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 1048576,
				maxTokens: 65536,
				api: "google-gemini-cli",
				baseUrl: "https://cloudcode-pa.googleapis.com",
			},
		],
		notes: [
			"oauth: oauth-code PKCE + project provision hook (omp google-gemini-cli-project)",
			"distinct from google-antigravity (different OAuth client / model set)",
		],
	});
}
