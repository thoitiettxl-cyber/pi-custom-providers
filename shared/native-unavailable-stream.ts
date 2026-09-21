/**
 * Explicit native-unavailable streamSimple — no @oh-my-pi stream fallback.
 */
import type { Api, AssistantMessage, Model, SimpleStreamOptions } from "@earendil-works/pi-ai/compat";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import type { NativeStreamContext } from "./native-openai-responses.ts";

function emptyUsage(): AssistantMessage["usage"] {
	return {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	};
}

export function createNativeUnavailableStreamSimple(opts: {
	providerId: string;
	reason: string;
	loginHint?: string;
}) {
	const message =
		`${opts.providerId}: native stream not available yet (${opts.reason}). ` +
		`omp stream fallback is disabled. ${opts.loginHint ? `Login: ${opts.loginHint}. ` : ""}` +
		`Use a provider with a native fetch/SSE stream (e.g. xai-omp, muse-code, zai-coding-plan, google-antigravity).`;

	return function streamSimple(
		model: Model<Api>,
		_context: NativeStreamContext,
		_options?: SimpleStreamOptions,
	) {
		const out = createAssistantMessageEventStream();
		const error: AssistantMessage = {
			role: "assistant",
			content: [],
			api: model.api,
			provider: model.provider,
			model: model.id,
			usage: emptyUsage(),
			stopReason: "error",
			errorMessage: message,
			timestamp: Date.now(),
		};
		queueMicrotask(() => {
			out.push({ type: "error", reason: "error", error });
			out.end();
		});
		return out;
	};
}
