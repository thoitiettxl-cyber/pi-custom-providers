# Cài đặt nhanh (Tiếng Việt)

Gói **pi-custom-providers** thêm 10 provider chat cho Pi **0.86.x**. Mọi `streamSimple` đều **native** (fetch/SSE hoặc Connect) — không còn phụ thuộc Bun để stream omp.

## Cách chính: `pi install`

```bash
cd pi-custom-providers
PI_SKIP_VERSION_CHECK=1 pi install .

# Hoặc từ GitHub (không pin commit)
PI_SKIP_VERSION_CHECK=1 pi install git:github.com/thoitiettxl-cyber/pi-custom-providers
```

Khởi động lại Pi hoặc gõ `/reload`.

## Đăng nhập + chọn model

```
/login cursor
/login devin
/login google-antigravity
/login google-gemini-cli
/login gitlab-duo
/login gitlab-duo-agent
/login openai-codex-device
/login muse-code
/login zai-coding-plan
/login xai-omp
```

Rồi chọn model: `/model <provider>/...` (ví dụ `/model xai-omp/grok-4`, `/model google-antigravity/gemini-3.1-pro-low`).

| Provider | Stream |
|----------|--------|
| cursor | Native HTTP/2 Connect AgentService |
| devin | Native Connect GetChatMessage |
| google-antigravity | Native CCA SSE |
| google-gemini-cli | Native CCA SSE (Gemini CLI headers) |
| gitlab-duo / gitlab-duo-agent | Native Anthropic Messages (AI Gateway) |
| openai-codex-device | Native Codex `/codex/responses` SSE |
| muse-code / xai-omp | Native OpenAI Responses SSE |
| zai-coding-plan | Native Anthropic Messages SSE |

## Cảnh báo: refresh token SuperGrok xoay giữa nhiều máy

Cùng một grant SuperGrok **không** được refresh đồng thời trên laptop + agent/CI/box. Mỗi lần refresh sẽ **xoay/thu hồi** refresh token cũ → máy kia gặp `invalid_grant`.

Sau khi agent/box đã refresh: chạy lại **`/login xai-omp`** trên máy bạn, **hoặc** copy entry `xai-omp` sau refresh (không dán token vào chat). Kiểm tra: `node scripts/check-xai-omp-auth.mjs`.

## Troubleshooting

| Triệu chứng | Gợi ý |
|-------------|--------|
| Extension không load | `pi update --extensions`; kiểm tra `bun run smoke:node` |
| `baseUrl` required | Xóa/sửa block provider thiếu `baseUrl` trong `~/.pi/agent/models.json` |
| Cursor/Devin lỗi auth | Chạy lại `/login cursor` hoặc `/login devin` (cần tài khoản thật) |
| Gemini CLI 404 model | Chọn id wire đúng; Antigravity dùng suffix `-low`/`-high` |
| Codex 401 region | Workspace enterprise region-pin — login lại / kiểm tra residency JWT |
| Duo Agent | Hiện dùng HTTP Anthropic gateway (không phải full Workflow WS) |
| Node vs Bun | **Không còn bắt buộc Bun** cho stream native; Pi host vẫn là Node+jiti |

## Kiểm tra nhanh

```bash
bun install
bun run smoke:node
bun run test
```

Chi tiết EN: [README.md](./README.md) · Kiến trúc: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).

## Cập nhật theo omp (OAuth/catalog)

```bash
pi update --extensions
```

(Chỉ khi cài git **không pin** commit.)
