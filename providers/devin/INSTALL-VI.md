# Cài extension Devin (máy độc lập, bun)

## Quan trọng
Gói này **không** dùng `file:` trỏ monorepo. Chỉ cần registry npm.

## Cài
```bash
cd pi-devin-extension
rm -f package-lock.json bun.lock bun.lockb   # nếu còn lock cũ bị hỏng
bun install
```

## Chạy
```bash
pi -e "$(pwd)"
```
Rồi `/login devin` → `/model` → `devin/swe-1-6`.

## Ghi chú
- Dependency npm: `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-catalog`, `@earendil-works/pi-ai`, `@earendil-works/pi-coding-agent`
- Vẫn cần lệnh `pi` (coding-agent) trên PATH để mở session
- Không kèm token; login trên máy bạn

## Kiểm tra
```bash
bun run check
bun test
```
