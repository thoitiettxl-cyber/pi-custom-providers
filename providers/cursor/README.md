# pi-extension-custom-provider-cursor

| | |
|--|--|
| Login | `/login cursor` (loginDeepControl + poll `api2.cursor.sh`) |
| Stream | Native HTTP/2 Connect + protobuf `AgentService/Run` (`cursor-native.ts`) |
| Tools | Local `exec-handlers.ts` (read/ls/grep/write/delete/shell) |

Endpoints from oh-my-pi only — do not invent APIs. Catalog protobuf codecs from `@oh-my-pi/pi-catalog/discovery/cursor-proto`.

Deferred: full omp CursorExecHandlers, MCP resources, quota UI.

```bash
bun run test:cursor
```
