/**
 * Local Cursor execHandlers bridge for the earendil extension.
 *
 * Cursor AgentService sends native exec frames (read/ls/grep/write/delete/shell).
 * The extension cannot reach pi's live AgentTool registry, so these handlers
 * execute with Node fs / child_process and return ToolResultMessage shapes that
 * @oh-my-pi/pi-ai can turn into proto ExecClientMessage results.
 *
 * Not a full port of oh-my-pi CursorExecHandlers (no approval UI, MCP, todos,
 * or pi_* modern frames). Good enough for default coding-agent tools.
 */

import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Minimal ToolResultMessage shape accepted by omp CursorExecHandlerResult. */
export type LocalToolResultMessage = {
	role: "toolResult";
	toolCallId: string;
	toolName: string;
	content: Array<{ type: "text"; text: string }>;
	isError: boolean;
	timestamp: number;
	details?: unknown;
};

export type CursorExecHandlersOptions = {
	/** Default working directory for relative paths and shell. Defaults to process.cwd(). */
	cwd?: string;
	/** Optional absolute root; relative paths that escape it are rejected. Absolute paths still allowed. */
	confineRelativeToCwd?: boolean;
};

type ReadLikeArgs = {
	path?: string;
	toolCallId?: string;
	offset?: number;
	limit?: number;
};

type LsLikeArgs = {
	path?: string;
	toolCallId?: string;
	ignore?: string[];
};

type GrepLikeArgs = {
	pattern?: string;
	path?: string;
	glob?: string;
	toolCallId?: string;
	caseInsensitive?: boolean;
	offset?: number;
	headLimit?: number;
};

type WriteLikeArgs = {
	path?: string;
	toolCallId?: string;
	fileText?: string;
	fileBytes?: Uint8Array;
};

type DeleteLikeArgs = {
	path?: string;
	toolCallId?: string;
};

type ShellLikeArgs = {
	command?: string;
	workingDirectory?: string;
	timeout?: number;
	toolCallId?: string;
};

type ShellStreamCallbacks = {
	onStdout(data: string): void;
	onStderr(data: string): void;
};

export type LocalCursorExecHandlers = {
	read: (args: ReadLikeArgs) => Promise<LocalToolResultMessage>;
	ls: (args: LsLikeArgs) => Promise<LocalToolResultMessage>;
	grep: (args: GrepLikeArgs) => Promise<LocalToolResultMessage>;
	write: (args: WriteLikeArgs) => Promise<LocalToolResultMessage>;
	delete: (args: DeleteLikeArgs) => Promise<LocalToolResultMessage>;
	shell: (args: ShellLikeArgs) => Promise<LocalToolResultMessage>;
	shellStream: (args: ShellLikeArgs, callbacks: ShellStreamCallbacks) => Promise<LocalToolResultMessage>;
};

function decodeToolCallId(toolCallId?: string): string {
	return toolCallId && toolCallId.length > 0 ? toolCallId : randomUUID();
}

function toolResult(
	toolCallId: string,
	toolName: string,
	text: string,
	isError = false,
	details?: unknown,
): LocalToolResultMessage {
	return {
		role: "toolResult",
		toolCallId,
		toolName,
		content: [{ type: "text", text }],
		isError,
		timestamp: Date.now(),
		...(details !== undefined ? { details } : {}),
	};
}

function getCwd(options: CursorExecHandlersOptions): string {
	return options.cwd ? path.resolve(options.cwd) : process.cwd();
}

/**
 * Resolve a path for file tools.
 * - Absolute paths are used as-is (coding agents often pass absolute fixture paths).
 * - Relative paths resolve against cwd; when confineRelativeToCwd is true (default),
 *   reject if the resolved path escapes cwd via `..`.
 */
function resolveToolPath(
	rawPath: string | undefined,
	options: CursorExecHandlersOptions,
	fallback = ".",
): { ok: true; absolute: string } | { ok: false; error: string } {
	const input = (rawPath && rawPath.length > 0 ? rawPath : fallback).replace(/\0/g, "");
	if (input.includes("\0")) {
		return { ok: false, error: "Path contains null byte" };
	}
	const cwd = getCwd(options);
	const absolute = path.isAbsolute(input) ? path.resolve(input) : path.resolve(cwd, input);
	const confine = options.confineRelativeToCwd !== false;
	if (confine && !path.isAbsolute(input)) {
		const rel = path.relative(cwd, absolute);
		if (rel.startsWith("..") || path.isAbsolute(rel)) {
			return { ok: false, error: `Path escapes working directory: ${input}` };
		}
	}
	return { ok: true, absolute };
}

function applyOffsetLimit(text: string, offset?: number, limit?: number): string {
	if (limit === 0) return "";
	const lines = text.split("\n");
	// Cursor/omp: offset is 1-indexed start line when set; omit = from start.
	const start =
		offset !== undefined && offset !== null && Number.isFinite(offset)
			? Math.max(0, Math.floor(offset) - 1)
			: 0;
	const end =
		limit !== undefined && limit !== null && Number.isFinite(limit) && limit > 0
			? start + Math.floor(limit)
			: undefined;
	return lines.slice(start, end).join("\n");
}

function matchGlob(name: string, glob: string): boolean {
	// Minimal * / ? glob for basename matching.
	const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
	return new RegExp(`^${escaped}$`, "i").test(name);
}

async function walkFiles(
	root: string,
	glob: string | undefined,
	ignoreNames: Set<string>,
	out: string[],
	maxFiles: number,
): Promise<void> {
	if (out.length >= maxFiles) return;
	let entries: fs.Dirent[];
	try {
		entries = await fs.promises.readdir(root, { withFileTypes: true });
	} catch {
		return;
	}
	for (const ent of entries) {
		if (out.length >= maxFiles) return;
		if (ignoreNames.has(ent.name) || ent.name === ".git" || ent.name === "node_modules") continue;
		const full = path.join(root, ent.name);
		if (ent.isDirectory()) {
			await walkFiles(full, glob, ignoreNames, out, maxFiles);
		} else if (ent.isFile()) {
			if (!glob || matchGlob(ent.name, glob)) out.push(full);
		}
	}
}

export function createCursorExecHandlers(options: CursorExecHandlersOptions = {}): LocalCursorExecHandlers {
	const handlers: LocalCursorExecHandlers = {
		async read(args) {
			const toolCallId = decodeToolCallId(args.toolCallId);
			const resolved = resolveToolPath(args.path, options);
			if (!resolved.ok) return toolResult(toolCallId, "read", resolved.error, true);
			try {
				if (args.limit === 0) {
					return toolResult(toolCallId, "read", "", false);
				}
				const raw = await fs.promises.readFile(resolved.absolute, "utf8");
				const text = applyOffsetLimit(raw, args.offset, args.limit);
				return toolResult(toolCallId, "read", text, false);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return toolResult(toolCallId, "read", message, true);
			}
		},

		async ls(args) {
			const toolCallId = decodeToolCallId(args.toolCallId);
			const resolved = resolveToolPath(args.path, options, ".");
			if (!resolved.ok) return toolResult(toolCallId, "ls", resolved.error, true);
			try {
				const ignore = new Set(args.ignore ?? []);
				const entries = await fs.promises.readdir(resolved.absolute, { withFileTypes: true });
				const lines = entries
					.filter((e) => !ignore.has(e.name))
					.map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
					.sort((a, b) => a.localeCompare(b));
				return toolResult(toolCallId, "ls", lines.join("\n"), false);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return toolResult(toolCallId, "ls", message, true);
			}
		},

		async grep(args) {
			const toolCallId = decodeToolCallId(args.toolCallId);
			const pattern = args.pattern ?? "";
			if (!pattern) return toolResult(toolCallId, "grep", "pattern is required", true);
			let regex: RegExp;
			try {
				regex = new RegExp(pattern, args.caseInsensitive ? "i" : "");
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return toolResult(toolCallId, "grep", `Invalid pattern: ${message}`, true);
			}
			const searchRoot = resolveToolPath(args.path || ".", options, ".");
			if (!searchRoot.ok) return toolResult(toolCallId, "grep", searchRoot.error, true);

			try {
				const files: string[] = [];
				const st = await fs.promises.stat(searchRoot.absolute);
				if (st.isFile()) {
					files.push(searchRoot.absolute);
				} else {
					await walkFiles(searchRoot.absolute, args.glob, new Set(), files, 500);
				}
				const skip = args.offset && args.offset > 0 ? Math.floor(args.offset) : 0;
				const head = args.headLimit && args.headLimit > 0 ? Math.floor(args.headLimit) : 200;
				const matches: string[] = [];
				let fileIndex = 0;
				for (const file of files) {
					if (matches.length >= head) break;
					if (fileIndex++ < skip) continue;
					let content: string;
					try {
						content = await fs.promises.readFile(file, "utf8");
					} catch {
						continue;
					}
					const lines = content.split("\n");
					for (let i = 0; i < lines.length; i++) {
						if (matches.length >= head) break;
						if (regex.test(lines[i]!)) {
							matches.push(`${file}:${i + 1}:${lines[i]}`);
						}
					}
				}
				const text = matches.length ? matches.join("\n") : "No matches found";
				return toolResult(toolCallId, "grep", text, false);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return toolResult(toolCallId, "grep", message, true);
			}
		},

		async write(args) {
			const toolCallId = decodeToolCallId(args.toolCallId);
			const resolved = resolveToolPath(args.path, options);
			if (!resolved.ok) return toolResult(toolCallId, "write", resolved.error, true);
			if (!args.path) return toolResult(toolCallId, "write", "path is required", true);
			try {
				await fs.promises.mkdir(path.dirname(resolved.absolute), { recursive: true });
				if (args.fileBytes && args.fileBytes.length > 0) {
					await fs.promises.writeFile(resolved.absolute, Buffer.from(args.fileBytes));
				} else {
					await fs.promises.writeFile(resolved.absolute, args.fileText ?? "", "utf8");
				}
				const size = (await fs.promises.stat(resolved.absolute)).size;
				return toolResult(toolCallId, "write", `Wrote ${args.path} (${size} bytes)`, false);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return toolResult(toolCallId, "write", message, true);
			}
		},

		async delete(args) {
			const toolCallId = decodeToolCallId(args.toolCallId);
			const resolved = resolveToolPath(args.path, options);
			if (!resolved.ok) return toolResult(toolCallId, "delete", resolved.error, true);
			if (!args.path) return toolResult(toolCallId, "delete", "path is required", true);
			try {
				const st = await fs.promises.stat(resolved.absolute);
				if (!st.isFile()) {
					return toolResult(toolCallId, "delete", `Path is not a file: ${args.path}`, true);
				}
				await fs.promises.rm(resolved.absolute);
				const sizeText = st.size ? ` (${st.size} bytes)` : "";
				return toolResult(toolCallId, "delete", `Deleted ${args.path}${sizeText}`, false);
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return toolResult(toolCallId, "delete", message, true);
			}
		},

		async shell(args) {
			const toolCallId = decodeToolCallId(args.toolCallId);
			const command = args.command ?? "";
			if (!command) return toolResult(toolCallId, "bash", "command is required", true);
			const cwdResolved = args.workingDirectory
				? resolveToolPath(args.workingDirectory, options)
				: { ok: true as const, absolute: getCwd(options) };
			if (!cwdResolved.ok) return toolResult(toolCallId, "bash", cwdResolved.error, true);
			const timeoutSec = args.timeout && args.timeout > 0 ? args.timeout : 30;
			try {
				const { stdout, stderr } = await execFileAsync("/bin/bash", ["-lc", command], {
					cwd: cwdResolved.absolute,
					timeout: timeoutSec * 1000,
					maxBuffer: 4 * 1024 * 1024,
					encoding: "utf8",
				});
				const text = [stdout, stderr].filter(Boolean).join(stderr ? "\n" : "");
				return toolResult(toolCallId, "bash", text || "(no output)", false);
			} catch (err: unknown) {
				const e = err as {
					stdout?: string;
					stderr?: string;
					message?: string;
					killed?: boolean;
					code?: number | string;
				};
				const parts = [e.stdout, e.stderr, e.message].filter((p) => typeof p === "string" && p.length);
				const text = parts.length ? parts.join("\n") : String(err);
				return toolResult(toolCallId, "bash", text, true);
			}
		},

		async shellStream(args, callbacks) {
			const toolCallId = decodeToolCallId(args.toolCallId);
			const command = args.command ?? "";
			if (!command) return toolResult(toolCallId, "bash", "command is required", true);
			const cwdResolved = args.workingDirectory
				? resolveToolPath(args.workingDirectory, options)
				: { ok: true as const, absolute: getCwd(options) };
			if (!cwdResolved.ok) return toolResult(toolCallId, "bash", cwdResolved.error, true);
			const timeoutSec = args.timeout && args.timeout > 0 ? args.timeout : 30;

			return await new Promise<LocalToolResultMessage>((resolve) => {
				const child = spawn("/bin/bash", ["-lc", command], {
					cwd: cwdResolved.absolute,
					stdio: ["ignore", "pipe", "pipe"],
				});
				let stdout = "";
				let stderr = "";
				let settled = false;
				const timer = setTimeout(() => {
					child.kill("SIGKILL");
				}, timeoutSec * 1000);

				child.stdout?.on("data", (chunk: Buffer | string) => {
					const s = chunk.toString();
					stdout += s;
					callbacks.onStdout(s);
				});
				child.stderr?.on("data", (chunk: Buffer | string) => {
					const s = chunk.toString();
					stderr += s;
					callbacks.onStderr(s);
				});

				const finish = (isError: boolean, extra?: string) => {
					if (settled) return;
					settled = true;
					clearTimeout(timer);
					const text = [stdout, stderr, extra].filter(Boolean).join(stderr || extra ? "\n" : "") || "(no output)";
					resolve(toolResult(toolCallId, "bash", text, isError));
				};

				child.on("error", (err) => finish(true, err.message));
				child.on("close", (code) => finish(code !== 0, code !== 0 ? `exit ${code}` : undefined));
			});
		},
	};

	return handlers;
}

/** Singleton default handlers (cwd = process.cwd()). */
let defaultHandlers: LocalCursorExecHandlers | undefined;

export function getDefaultCursorExecHandlers(): LocalCursorExecHandlers {
	if (!defaultHandlers) defaultHandlers = createCursorExecHandlers();
	return defaultHandlers;
}

/** Stable fingerprint for diagnostics (never includes secrets). */
export function execHandlersFingerprint(handlers: LocalCursorExecHandlers = getDefaultCursorExecHandlers()): string {
	const keys = Object.keys(handlers).sort().join(",");
	return createHash("sha256").update(keys).digest("hex").slice(0, 12);
}
