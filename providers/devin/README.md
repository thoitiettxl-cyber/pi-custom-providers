# pi-extension-custom-provider-devin

| | |
|--|--|
| Login | `/login devin` |
| Stream | Native Connect HTTP/1.1 + protobuf `GetChatMessage` (`devin-native.ts`) |

Endpoints from oh-my-pi wire/devin: `https://server.codeium.com` + Connect proto paths. Catalog codecs from `@oh-my-pi/pi-catalog/discovery/devin-proto`.

Refresh policy: `refresh "none"` — re-login when session expires.

```bash
bun run test:devin
```
