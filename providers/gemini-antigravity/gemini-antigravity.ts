/**
 * Named entry `gemini-antigravity.ts` for the Google Antigravity provider extension.
 * Prefer loading the package directory (pi resolves package.json → index.ts).
 */

import "./bun-shim.ts";
export { default } from "./index.ts";
export { CURATED_ANTIGRAVITY_MODELS, loadAntigravityModels, resolveAntigravityModelMeta } from "./models.ts";
export {
	ANTIGRAVITY_OAUTH_URLS,
	discoverAntigravityProject,
	generateAntigravityAuthParams,
	generatePKCE,
	getAntigravityApiKey,
	loginAntigravity,
	parseStructuredAntigravityApiKey,
	refreshAntigravityToken,
} from "./oauth.ts";
export {
	ANTIGRAVITY_API_ID,
	ANTIGRAVITY_API_URL,
	ANTIGRAVITY_PROVIDER_ID,
	probeStreamGoogleGeminiCliImport,
	streamSimpleAntigravity,
} from "./stream.ts";
