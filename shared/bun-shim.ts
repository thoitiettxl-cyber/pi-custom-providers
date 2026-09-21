/**
 * Minimal Bun global + Bun/Node gaps for earendil/Pi (Node+jiti) hosts.
 *
 * @oh-my-pi/pi-* assumes Bun (`Bun.env`, `Bun.hash`, `Bun.hash.wyhash`,
 * `import.meta.dir` / `import.meta.path`). Under Node+jiti those throw or yield
 * `path.join(undefined)` → ERR_INVALID_ARG_TYPE. gemini-antigravity avoids this
 * via native CCA; cursor + xai-omp hit omp streams and need this shim.
 *
 * Under real Bun this is mostly a no-op (Bun already defined).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspect } from "node:util";
import Module from "node:module";

/** Node 22+; absent on Bun's node:module shim — resolve dynamically. */
const registerHooks: typeof import("node:module").registerHooks | undefined =
	typeof (Module as { registerHooks?: unknown }).registerHooks === "function"
		? (Module as { registerHooks: typeof import("node:module").registerHooks }).registerHooks
		: undefined;

type HashFn = ((input: string | ArrayBuffer | Uint8Array | object) => number) & {
	wyhash: (input: string | ArrayBuffer | Uint8Array | object) => number | bigint;
};

type BunLike = {
	env: NodeJS.ProcessEnv;
	main: string;
	isMainThread: boolean;
	version?: string;
	hash: HashFn;
	sha: (input: string | Uint8Array, encoding?: string) => string | Uint8Array;
	sleep: (ms: number) => Promise<void>;
	sleepSync?: (ms: number) => void;
	write: (path: string, data: string | Uint8Array) => Promise<number>;
	file: (path: string) => {
		text: () => Promise<string>;
		json: () => Promise<unknown>;
		arrayBuffer: () => Promise<ArrayBuffer>;
		exists: () => boolean;
	};
	which: (command: string, options?: { PATH?: string }) => string | null;
	inspect: (value: unknown, options?: object) => string;
	deepEquals: (a: unknown, b: unknown) => boolean;
	spawnSync: (
		cmd: string[],
		opts?: { stdout?: string; stderr?: string; env?: NodeJS.ProcessEnv; cwd?: string },
	) => { exitCode: number; stdout: Uint8Array; stderr: Uint8Array };
	CryptoHasher: new (algorithm: string) => {
		update: (data: string | Uint8Array) => { digest: (encoding?: string) => string | Uint8Array };
	};
	Glob?: new (pattern: string) => { scanSync: (cwd?: string) => string[] };
	serve?: (...args: unknown[]) => never;
};

function toBytes(input: string | ArrayBuffer | Uint8Array | object): Uint8Array {
	if (typeof input === "string") return new TextEncoder().encode(input);
	if (input instanceof Uint8Array) return input;
	if (input instanceof ArrayBuffer) return new Uint8Array(input);
	return new TextEncoder().encode(JSON.stringify(input));
}

function fnv1a32(bytes: Uint8Array): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < bytes.length; i++) {
		h ^= bytes[i]!;
		h = Math.imul(h, 0x01000193);
	}
	return h >>> 0;
}

function makeHashFn(): HashFn {
	const hash = ((input: string | ArrayBuffer | Uint8Array | object) => fnv1a32(toBytes(input))) as HashFn;
	// pi-utils dirs.ts: Bun.hash.wyhash(path) — same non-crypto digest is enough for path keys.
	hash.wyhash = (input) => fnv1a32(toBytes(input));
	return hash;
}


/** Make `import … from "bun"` resolve under Node/jiti (omp frontmatter uses Bun.YAML). */
function installBunPackageShim(): void {
	const g = globalThis as typeof globalThis & { __ompBunPackageShim?: boolean };
	if (g.__ompBunPackageShim) return;
	g.__ompBunPackageShim = true;

	const here = dirname(fileURLToPath(import.meta.url));
	const shimDir = join(here, "bun-node-shim");
	const shimCjs = join(shimDir, "index.cjs");
	const shimMjs = join(shimDir, "index.mjs");
	const ffiCjs = join(shimDir, "ffi.cjs");
	const sqliteCjs = join(shimDir, "sqlite.cjs");
	if (!existsSync(shimCjs)) return;

	const mapRequest = (request: string): string | undefined => {
		if (request === "bun") return shimCjs;
		if (request === "bun:ffi") return ffiCjs;
		if (request === "bun:sqlite") return sqliteCjs;
		return undefined;
	};

	try {
		const mod = Module as typeof Module & {
			_resolveFilename?: (request: string, parent: unknown, isMain: boolean, options?: unknown) => string;
		};
		if (typeof mod._resolveFilename === "function") {
			const orig = mod._resolveFilename.bind(mod);
			mod._resolveFilename = (request: string, parent: unknown, isMain: boolean, options?: unknown) => {
				const mapped = mapRequest(request);
				if (mapped) return mapped;
				return orig(request, parent, isMain, options);
			};
		}
	} catch {
		/* ignore */
	}

	try {
		if (typeof registerHooks === "function") {
			registerHooks({
				resolve(specifier, context, nextResolve) {
					const mapped = mapRequest(specifier);
					if (mapped) {
						return { shortCircuit: true, url: pathToFileURL(mapped).href };
					}
					return nextResolve(specifier, context);
				},
			});
		}
	} catch {
		/* older Node */
	}
}

/** Rewrite Bun-only import.meta.dir / .path for Node ESM + jiti data: modules. */
function installImportMetaDirPolyfill(): void {
	const g = globalThis as typeof globalThis & { __ompImportMetaDirHook?: boolean };
	if (g.__ompImportMetaDirHook) return;
	g.__ompImportMetaDirHook = true;

	// Node has dirname/filename; Bun has dir/path. jiti evaluates via data: URLs
	// where dirname is absent but the wrapper provides __dirname / __filename.
	const dirExpr =
		'(import.meta.dirname||(typeof __dirname!=="undefined"?__dirname:process.cwd()))';
	const pathExpr =
		'(import.meta.filename||(typeof __filename!=="undefined"?__filename:process.cwd()))';

	try {
		if (typeof registerHooks !== "function") return;
		registerHooks({
			load(url, context, nextLoad) {
				// Bun text imports (*.md) — Node has no format; serve as string default export.
				const pathPart = url.split("?")[0] ?? url;
				if (/\.(md|txt|html|svg|csv)$/i.test(pathPart)) {
					try {
						const filePath = fileURLToPath(pathPart);
						const body = readFileSync(filePath, "utf8");
						return {
							format: "module",
							source: `export default ${JSON.stringify(body)};`,
							shortCircuit: true,
						};
					} catch {
						return { format: "module", source: "export default \"\";", shortCircuit: true };
					}
				}
				// Rewrite Bun-only import.meta.dir/path for:
				// - jiti data: modules (dirname/filename absent; __dirname may exist)
				// - @oh-my-pi file: modules under Node (has dirname, not dir)
				const isData = url.startsWith("data:");
				const isOmpFile =
					url.startsWith("file:") &&
					(/node_modules\/@oh-my-pi\//.test(url) || /node_modules\/\.bun\/@oh-my-pi\+/.test(url));
				if (!isData && !isOmpFile) {
					return nextLoad(url, context);
				}
				const result = nextLoad(url, context);
				if (!result?.source) return result;
				let source =
					typeof result.source === "string"
						? result.source
						: Buffer.from(result.source).toString("utf8");
				if (!/import\.meta\.(dir|path)\b/.test(source)) return result;
				source = source
					.replace(/import\.meta\.dir\b/g, dirExpr)
					.replace(/import\.meta\.path\b/g, pathExpr);
				return { format: result.format || "module", source, shortCircuit: true };
			},
		});
	} catch {
		/* older Node without registerHooks — stream path still needs compat={} */
	}
}

/**
 * Point omp pi-utils at Pi's agent dir (~/.pi/agent) before first omp import.
 * Default omp root is ~/.omp/agent; under earendil auth/sessions live in ~/.pi/agent.
 */
function ensurePiAgentDir(): void {
	const g = globalThis as typeof globalThis & { __ompPiAgentDirEnsured?: boolean };
	if (g.__ompPiAgentDirEnsured) return;
	g.__ompPiAgentDirEnsured = true;

	const piAgent = process.env.PI_CODING_AGENT_DIR?.trim() || join(homedir(), ".pi", "agent");
	if (!process.env.PI_CODING_AGENT_DIR?.trim()) {
		process.env.PI_CODING_AGENT_DIR = piAgent;
	}
	// Do not import @oh-my-pi/pi-utils here (pulls `bun` YAML / heavy graph). Setting
	// PI_CODING_AGENT_DIR before first omp import is enough for DirResolver; callers that
	// already loaded pi-utils can call setAgentDir themselves.
}

function installBunShim(): void {
	installBunPackageShim();
	installImportMetaDirPolyfill();
	ensurePiAgentDir();

	const g = globalThis as typeof globalThis & { Bun?: BunLike };
	if (typeof g.Bun !== "undefined" && g.Bun?.env) {
		// Real Bun or prior shim: still ensure wyhash exists on hash.
		const existing = g.Bun.hash as HashFn | undefined;
		if (existing && typeof existing === "function" && typeof existing.wyhash !== "function") {
			existing.wyhash = (input) => existing(input);
		}
		return;
	}

	class CryptoHasher {
		#algo: string;
		#chunks: Uint8Array[] = [];
		constructor(algorithm: string) {
			this.#algo = algorithm === "sha256" ? "sha256" : algorithm;
		}
		update(data: string | Uint8Array) {
			this.#chunks.push(typeof data === "string" ? new TextEncoder().encode(data) : data);
			return {
				digest: (encoding?: string) => {
					const h = createHash(this.#algo);
					for (const c of this.#chunks) h.update(c);
					if (encoding === "hex" || encoding === undefined) return h.digest("hex");
					return h.digest();
				},
			};
		}
	}

	const shim: BunLike = {
		env: process.env,
		main: process.argv[1] ? pathToFileURL(process.argv[1]).href : "",
		isMainThread: true,
		version: "0.0.0-node-shim",
		hash: makeHashFn(),
		sha: (input, encoding) => {
			const h = createHash("sha256").update(toBytes(input as string | Uint8Array));
			return encoding === "hex" || encoding === undefined ? h.digest("hex") : h.digest();
		},
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		write: async (path, data) => {
			const buf = typeof data === "string" ? Buffer.from(data) : Buffer.from(data);
			writeFileSync(path, buf);
			return buf.byteLength;
		},
		file: (path) => ({
			text: async () => readFileSync(path, "utf8"),
			json: async () => JSON.parse(readFileSync(path, "utf8")),
			arrayBuffer: async () => {
				const b = readFileSync(path);
				return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
			},
			exists: () => existsSync(path),
		}),
		which: (command, options) => {
			const pathEnv = options?.PATH ?? process.env.PATH ?? "";
			const result = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
				env: { ...process.env, PATH: pathEnv },
				encoding: "utf8",
			});
			if (result.status !== 0) return null;
			const line = String(result.stdout || "").split(/\r?\n/).find(Boolean);
			return line ?? null;
		},
		inspect: (value, options) => inspect(value, { colors: false, ...(options as object) }),
		deepEquals: (a, b) => {
			try {
				return JSON.stringify(a) === JSON.stringify(b);
			} catch {
				return Object.is(a, b);
			}
		},
		spawnSync: (cmd, opts) => {
			const r = spawnSync(cmd[0]!, cmd.slice(1), {
				cwd: opts?.cwd,
				env: opts?.env ?? process.env,
				encoding: "buffer",
			});
			return {
				exitCode: r.status ?? 1,
				stdout: r.stdout instanceof Buffer ? new Uint8Array(r.stdout) : new Uint8Array(),
				stderr: r.stderr instanceof Buffer ? new Uint8Array(r.stderr) : new Uint8Array(),
			};
		},
		CryptoHasher: CryptoHasher as BunLike["CryptoHasher"],
		serve: () => {
			throw new Error("Bun.serve is not available in the Node Bun shim (Antigravity does not need it)");
		},
	};

	g.Bun = shim;
}

installBunShim();

export { installBunShim, ensurePiAgentDir, installImportMetaDirPolyfill, installBunPackageShim };
