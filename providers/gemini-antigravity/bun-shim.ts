/**
 * Minimal Bun global for Node/jiti hosts.
 *
 * @oh-my-pi/pi-* ships TypeScript that assumes the Bun runtime (`Bun.env`,
 * `Bun.hash`, …). Published earendil/pi loads extensions via jiti under Node,
 * so those imports throw `ReferenceError: Bun is not defined` and the
 * streamGoogleGeminiCli loader caches failure → Continuity memory pipeline
 * ("previous import failed").
 *
 * Under real Bun this is a no-op. Do not use for general Bun emulation beyond
 * what Antigravity stream / catalog / headers need.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, existsSync, promises as fsp } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { inspect } from "node:util";

type BunLike = {
	env: NodeJS.ProcessEnv;
	main: string;
	isMainThread: boolean;
	version?: string;
	hash: (input: string | ArrayBuffer | Uint8Array | object) => number;
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

function installBunShim(): void {
	const g = globalThis as typeof globalThis & { Bun?: BunLike };
	if (typeof g.Bun !== "undefined" && g.Bun?.env) return;

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
		hash: (input) => fnv1a32(toBytes(input)),
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

export { installBunShim };
