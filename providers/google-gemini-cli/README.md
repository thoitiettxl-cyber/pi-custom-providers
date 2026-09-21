# google-gemini-cli

| | |
|--|--|
| Login | `/login google-gemini-cli` |
| Stream | Native CCA fetch/SSE (`gemini-cli-native.ts`) |

Wire: `cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse` with GeminiCLI User-Agent. OAuth via omp login hooks.

OAuth may still use omp registry login hooks; **stream does not** import `@oh-my-pi/pi-ai/providers/*`.
