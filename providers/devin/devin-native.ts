/**
 * Future Node-native Devin/Cascade stream (Connect HTTP/1.1 + protobuf GetChatMessage).
 *
 * Same Bun-coupling class as Cursor/Antigravity. Native vendor deferred; see
 * gemini-antigravity cca-native.ts for the preferred pattern once ported.
 */
export const DEVIN_NATIVE_ENGINE = "devin-native-connect-http1-pending" as const;

export function isDevinNativeReady(): boolean {
	return false;
}
