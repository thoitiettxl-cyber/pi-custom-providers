/**
 * Unit tests for local Cursor execHandlers (no live Cursor API).
 */
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { createCursorExecHandlers, getDefaultCursorExecHandlers } from "./exec-handlers.ts";

describe("createCursorExecHandlers", () => {
	it("read returns exact contents of a temp file", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-exec-"));
		const file = path.join(dir, "secret.txt");
		const payload = "SMOKE_UNIT_TOKEN_9a2b\n";
		fs.writeFileSync(file, payload, "utf8");
		try {
			const handlers = createCursorExecHandlers({ cwd: dir });
			const result = await handlers.read({ path: file, toolCallId: "t-read" });
			assert.equal(result.role, "toolResult");
			assert.equal(result.toolName, "read");
			assert.equal(result.isError, false);
			assert.equal(result.content[0]?.text, payload);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("read respects relative path under cwd", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-exec-"));
		fs.writeFileSync(path.join(dir, "note.txt"), "hello-rel", "utf8");
		try {
			const handlers = createCursorExecHandlers({ cwd: dir });
			const result = await handlers.read({ path: "note.txt", toolCallId: "t-rel" });
			assert.equal(result.isError, false);
			assert.equal(result.content[0]?.text, "hello-rel");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("rejects relative path escape when confined", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-exec-"));
		try {
			const handlers = createCursorExecHandlers({ cwd: dir, confineRelativeToCwd: true });
			const result = await handlers.read({ path: "../outside.txt", toolCallId: "t-esc" });
			assert.equal(result.isError, true);
			assert.match(result.content[0]?.text ?? "", /escapes working directory/i);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("write then delete round-trip", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cursor-exec-"));
		const file = path.join(dir, "out.txt");
		try {
			const handlers = createCursorExecHandlers({ cwd: dir });
			const w = await handlers.write({ path: file, fileText: "abc", toolCallId: "t-w" });
			assert.equal(w.isError, false);
			assert.equal(fs.readFileSync(file, "utf8"), "abc");
			const d = await handlers.delete({ path: file, toolCallId: "t-d" });
			assert.equal(d.isError, false);
			assert.equal(fs.existsSync(file), false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	it("shell runs a simple command", async () => {
		const handlers = createCursorExecHandlers();
		const result = await handlers.shell({ command: "echo hi-exec", toolCallId: "t-sh" });
		assert.equal(result.isError, false);
		assert.match(result.content[0]?.text ?? "", /hi-exec/);
	});

	it("getDefaultCursorExecHandlers exposes required tools", () => {
		const h = getDefaultCursorExecHandlers();
		for (const name of ["read", "ls", "grep", "write", "delete", "shell", "shellStream"] as const) {
			assert.equal(typeof h[name], "function");
		}
	});
});
