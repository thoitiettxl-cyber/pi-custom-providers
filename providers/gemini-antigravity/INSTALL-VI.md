# Cài extension Google Antigravity cho pi (máy của bạn)

## Yêu cầu
- [Bun](https://bun.sh) (khuyến nghị) — hoặc Node.js `>=22.19`
- `pi` (coding-agent) đã cài / build được
- Tài khoản Google có quyền Cloud Code Assist / Antigravity

## Cài dependency
```bash
cd pi-gemini-antigravity-extension   # hoặc custom-provider-gemini-antigravity trong monorepo
bun install
```

(Nếu không có bun: `npm install`.)

**Lưu ý:** `package.json` chỉ dùng phiên bản npm registry (`@oh-my-pi/*@18.2.5`, `@earendil-works/*@0.85.1`). Không dùng `file:` lockfile.

## Chạy với pi
```bash
pi -e /đường/dẫn/tới/pi-gemini-antigravity-extension
```

Hoặc symlink:
```bash
ln -sfn /đường/dẫn/tới/pi-gemini-antigravity-extension ~/.pi/agent/extensions/gemini-antigravity
```

Hoặc file entry tên người dùng:
```bash
# gemini-antigravity.ts re-export default
pi -e /đường/dẫn/tới/pi-gemini-antigravity-extension/gemini-antigravity.ts
```

## Auth trên máy bạn (quan trọng)
Gói này có **code OAuth** (`oauth.ts`), **không** kèm token.

1. Trong pi: `/login google-antigravity` (tên hiển thị: **Antigravity**)
2. Mở URL Google OAuth → đồng ý quyền (offline + consent)
3. Callback ưu tiên local: `http://127.0.0.1:51121/oauth-callback`. Nếu cổng bận, dán (paste) URL callback khi được hỏi.
4. Extension tự discovery `projectId` qua Cloud Code Assist (`loadCodeAssist` / `onboardUser`)
5. `/model` → ví dụ `google-antigravity/gemini-3.1-pro` (wire: `gemini-3.1-pro-low`), `gemini-3-flash`, `gemini-3.1-flash-lite`
6. Chat; tool đi qua CCA function calling

**Refresh:** dùng refresh_token Google; giữ `projectId`. Hết hạn / lỗi thì `/login google-antigravity` lại.

## Kiểm tra
```bash
bun run check
bun test
```

Xem thêm `README.md`.
