# Cài Cursor extension (bun, độc lập)

```bash
cd pi-cursor-extension
rm -f package-lock.json bun.lock bun.lockb
bun install
pi -e "$(pwd)"
```

Rồi `/login cursor`. Không dùng lock monorepo cũ.
