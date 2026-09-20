/**
 * Future Node-native Cursor AgentService stream (HTTP/2 Connect + protobuf).
 *
 * Pi 0.86.1 loads extensions under Node+jiti. @oh-my-pi/pi-ai streamCursor pulls
 * Bun-only deps (Bun.env, bun:ffi, bun:sqlite, import.meta.dir). Full vendor is
 * ~5.5k LOC + execHandlers — deferred (TypeSafe hybrid: shim+omp now, native later).
 *
 * When implemented, stream.ts should prefer this module under Node the same way
 * gemini-antigravity prefers cca-native.ts.
 */
export const CURSOR_NATIVE_ENGINE = "cursor-native-connect-http2-pending" as const;

export function isCursorNativeReady(): boolean {
	return false;
}
