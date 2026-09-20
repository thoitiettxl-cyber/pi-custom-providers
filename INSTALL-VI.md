# Cài đặt nhanh (Tiếng Việt)

Gói **pi-custom-providers** thêm 3 nhà cung cấp chat cho Pi **0.86.1**: Cursor, Devin, Gemini Antigravity.

## Cách chính: `pi install`

```bash
# Từ thư mục đã clone
cd pi-custom-providers
PI_SKIP_VERSION_CHECK=1 pi install .

# Hoặc từ GitHub
PI_SKIP_VERSION_CHECK=1 pi install git:github.com/thoitiettxl-cyber/pi-custom-providers
```

Khởi động lại Pi hoặc gõ `/reload`.

## Đăng nhập

```
/login cursor
/login devin
/login google-antigravity
```

Chọn model: `/model cursor/...`, `/model devin/...`, `/model google-antigravity/...`.

## Cách phụ (dev): symlink

```bash
bun install
bash scripts/link-extensions.sh
```

## Kiểm tra nhanh

```bash
bun run smoke:node
```

Chi tiết tiếng Anh: [README.md](./README.md) · Kiến trúc: [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md).


## Cập nhật theo omp

Cài git **không pin commit**:

```bash
PI_SKIP_VERSION_CHECK=1 pi install git:github.com/thoitiettxl-cyber/pi-custom-providers
```

Khi omp sửa provider (Dependabot merge trên repo này), chỉ cần:

```bash
pi update --extensions
```
