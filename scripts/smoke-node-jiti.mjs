#!/usr/bin/env node
/**
 * Node+jiti smoke: load each provider factory the way Pi does, then validate
 * registrations with earendil validateExtensionProvider and assert every model
 * has baseUrl. Never prints secrets.
 */
import { createRequire } from "node:module";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
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

function resolveValidate() {
  const candidates = [
    join(ROOT, "node_modules/@earendil-works/pi-coding-agent/dist/core/provider-composer.js"),
    "/workspace/pi/packages/coding-agent/dist/core/provider-composer.js",
  ];
  for (const p of candidates) {
    if (existsSync(p)) return pathToFileURL(p).href;
  }
  throw new Error("provider-composer.js not found for validateExtensionProvider");
}

const { createJiti } = await import(resolveJiti());
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { validateExtensionProvider } = await import(resolveValidate());

const results = {
  when_ict: new Date().toISOString(),
  runtime: "node+jiti",
  root: ROOT,
  providers: {},
};

function assertModelBaseUrls(id, cfg) {
  const models = Array.isArray(cfg?.models) ? cfg.models : [];
  const missing = models.filter((m) => !m?.baseUrl || !String(m.baseUrl).trim());
  if (!cfg?.baseUrl || !String(cfg.baseUrl).trim()) {
    throw new Error(`provider ${id}: missing provider-level baseUrl`);
  }
  if (missing.length) {
    throw new Error(
      `provider ${id}: ${missing.length}/${models.length} models missing baseUrl (e.g. ${missing[0]?.id})`,
    );
  }
  try {
    validateExtensionProvider(id, undefined, undefined, cfg);
  } catch (e) {
    throw new Error(`validateExtensionProvider(${id}): ${e instanceof Error ? e.message : String(e)}`);
  }
  return { modelCount: models.length, providerBaseUrl: cfg.baseUrl };
}

async function smoke(name, indexPath, probeImport) {
  const out = { load: null, probe: null, verdict: "FAIL" };
  try {
    const factory = await jiti.import(indexPath);
    const fn = factory?.default ?? factory;
    if (typeof fn !== "function") throw new Error("default export is not a function");
    const registered = { providers: [], commands: [] };
    const api = {
      registerProvider: (id, cfg) => {
        const checks = assertModelBaseUrls(id, cfg);
        registered.providers.push({
          id,
          api: cfg?.api,
          baseUrl: cfg?.baseUrl,
          models: checks.modelCount,
          hasStreamSimple: typeof cfg?.streamSimple === "function",
          hasOauth: Boolean(cfg?.oauth),
          allModelsHaveBaseUrl: true,
        });
      },
      registerCommand: (id) => {
        registered.commands.push(id);
      },
    };
    await fn(api);
    if (!registered.providers.length) throw new Error("no providers registered");
    out.load = { ok: true, ...registered };
  } catch (e) {
    out.load = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (probeImport) {
    try {
      out.probe = await probeImport();
    } catch (e) {
      out.probe = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  } else {
    out.probe = { ok: true, note: "thin-wrapper (no dedicated probe)" };
  }
  out.verdict = out.load?.ok ? "PASS" : "FAIL";
  results.providers[name] = out;
  console.log(`${out.verdict}\t${name}${out.load?.ok ? "" : `\t${out.load?.error}`}`);
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
await smoke("gemini-antigravity", join(ROOT, "providers/gemini-antigravity/index.ts"), antiProbe);

const thin = [
  "google-gemini-cli",
  "gitlab-duo",
  "gitlab-duo-agent",
  "openai-codex-device",
  "muse-code",
  "zai-coding-plan",
  "xai-omp",
];
for (const id of thin) {
  await smoke(id, join(ROOT, `providers/${id}/index.ts`), null);
}

const exportDir = existsSync("/workspace/exports") ? "/workspace/exports" : join(ROOT, "tmp");
mkdirSync(exportDir, { recursive: true });
const outPath = join(exportDir, "pi-custom-providers-node-jiti-smoke.json");
writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
console.log("wrote", outPath);

const failed = Object.values(results.providers).some((p) => p.verdict !== "PASS");
process.exit(failed ? 1 : 0);
