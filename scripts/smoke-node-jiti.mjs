#!/usr/bin/env node
/**
 * Node+jiti smoke: load each provider extension factory (registration path)
 * and run stream import probes. Never prints secrets.
 */
import { createRequire } from "node:module";
import { writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const require = createRequire(import.meta.url);

function resolveJiti() {
  const candidates = [
    "/workspace/pi/node_modules/jiti/lib/jiti.mjs",
    join(ROOT, "node_modules/jiti/lib/jiti.mjs"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return pathToFileURL(p).href;
  }
  try {
    return pathToFileURL(require.resolve("jiti/lib/jiti.mjs")).href;
  } catch {
    throw new Error("jiti not found; install Pi or jiti to run this smoke");
  }
}

const { createJiti } = await import(resolveJiti());
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const results = {
  when_ict: new Date().toISOString(),
  runtime: "node+jiti",
  root: ROOT,
  providers: {},
};

async function smoke(name, indexPath, probeImport) {
  const out = { load: null, probe: null };
  try {
    const factory = await jiti.import(indexPath);
    const fn = factory?.default ?? factory;
    if (typeof fn !== "function") throw new Error("default export is not a function");
    const registered = { providers: [], commands: [] };
    const api = {
      registerProvider: (id, cfg) => {
        registered.providers.push({
          id,
          api: cfg?.api,
          baseUrl: cfg?.baseUrl,
          models: Array.isArray(cfg?.models) ? cfg.models.length : 0,
          hasStreamSimple: typeof cfg?.streamSimple === "function",
          hasOauth: Boolean(cfg?.oauth),
        });
      },
      registerCommand: (id) => {
        registered.commands.push(id);
      },
    };
    await fn(api);
    out.load = { ok: true, ...registered };
  } catch (e) {
    out.load = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  try {
    out.probe = await probeImport();
  } catch (e) {
    out.probe = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  results.providers[name] = out;
}

const cursorProbe = async () => {
  const mod = await jiti.import(join(ROOT, "providers/cursor/stream.ts"));
  return mod.probeStreamCursorImport();
};
const devinProbe = async () => {
  const mod = await jiti.import(join(ROOT, "providers/devin/stream.ts"));
  return mod.probeStreamDevinImport();
};
const antiProbe = async () => {
  const mod = await jiti.import(join(ROOT, "providers/gemini-antigravity/stream.ts"));
  return mod.probeStreamGoogleGeminiCliImport();
};

await smoke("cursor", join(ROOT, "providers/cursor/index.ts"), cursorProbe);
await smoke("devin", join(ROOT, "providers/devin/index.ts"), devinProbe);
await smoke(
  "gemini-antigravity",
  join(ROOT, "providers/gemini-antigravity/index.ts"),
  antiProbe,
);

const exportDir = existsSync("/workspace/exports") ? "/workspace/exports" : join(ROOT, "tmp");
const outPath = join(exportDir, "pi-custom-providers-node-jiti-smoke.json");
try {
  writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
  console.log("wrote", outPath);
} catch {
  console.log("(could not write export file)");
}
console.log(JSON.stringify(results, null, 2));

const failed = Object.values(results.providers).some((p) => !p.load?.ok);
process.exit(failed ? 1 : 0);
