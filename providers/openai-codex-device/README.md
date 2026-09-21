# openai-codex-device

| | |
|--|--|
| Login | `/login openai-codex-device` |
| Stream | Native Codex Responses SSE (`codex-native.ts`) |

Wire: `POST chatgpt.com/backend-api/codex/responses`. WS/compaction/attestation deferred.

OAuth may still use omp registry login hooks; **stream does not** import `@oh-my-pi/pi-ai/providers/*`.
