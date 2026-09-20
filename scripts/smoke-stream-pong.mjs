#!/usr/bin/env node
/**
 * Live stream PONG smoke when auth exists.
 * - google-antigravity: expected when ~/.pi/agent/auth.json has credentials
 * - cursor / devin: skipped (documented) when no auth
 * Never prints tokens.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const require = createRequire(import.meta.url);
const AUTH_PATH = process.env.PI_AUTH_JSON || join(homedir(), ".pi/agent/auth.json");

function resolveJiti() {
  const candidates = [
    "/workspace/pi/node_modules/jiti/lib/jiti.mjs",
    join(ROOT, "node_modules/jiti/lib/jiti.mjs"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return pathToFileURL(p).href;
  }
  return pathToFileURL(require.resolve("jiti/lib/jiti.mjs")).href;
}

const { createJiti } = await import(resolveJiti());
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });

function loadAuth() {
  if (!existsSync(AUTH_PATH)) return {};
  try {
    return JSON.parse(readFileSync(AUTH_PATH, "utf8"));
  } catch {
    return {};
  }
}

function hasCred(auth, id) {
  const c = auth?.[id];
  return Boolean(c && (c.access || c.apiKey || c.token));
}

async function pongAntigravity(auth) {
  const row = {
    provider: "google-antigravity",
    skipped: false,
    ok: false,
    textPreview: "",
    stopReason: null,
    errorMessage: null,
    throw: null,
    events: 0,
    ms: 0,
  };
  if (!hasCred(auth, "google-antigravity")) {
    row.skipped = true;
    row.reason = "no auth for google-antigravity";
    return row;
  }
  const streamMod = await jiti.import(join(ROOT, "providers/gemini-antigravity/stream.ts"));
  const modelsMod = await jiti.import(join(ROOT, "providers/gemini-antigravity/models.ts"));
  const oauthMod = await jiti.import(join(ROOT, "providers/gemini-antigravity/oauth.ts"));
  const {
    streamSimpleAntigravity,
    ANTIGRAVITY_API_URL,
    ANTIGRAVITY_API_ID,
    ANTIGRAVITY_PROVIDER_ID,
  } = streamMod;
  const { CURATED_ANTIGRAVITY_MODELS } = modelsMod;
  const { getAntigravityApiKey } = oauthMod;
  const creds = auth["google-antigravity"];
  const apiKey = getAntigravityApiKey({
    access: creds.access,
    refresh: creds.refresh,
    expires: creds.expires,
    projectId: creds.projectId,
  });
  const modelDef =
    CURATED_ANTIGRAVITY_MODELS.find((m) => /flash/i.test(m.id)) || CURATED_ANTIGRAVITY_MODELS[0];
  const model = {
    id: modelDef.id,
    name: modelDef.name,
    provider: ANTIGRAVITY_PROVIDER_ID,
    api: ANTIGRAVITY_API_ID,
    baseUrl: ANTIGRAVITY_API_URL,
    reasoning: modelDef.reasoning,
    input: modelDef.input,
    cost: modelDef.cost,
    contextWindow: modelDef.contextWindow,
    maxTokens: Math.min(modelDef.maxTokens || 1024, 1024),
  };
  const context = {
    systemPrompt: "Reply with exactly the single word PONG and nothing else.",
    messages: [{ role: "user", content: "ping", timestamp: Date.now() }],
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 90000);
  const t0 = Date.now();
  try {
    const stream = streamSimpleAntigravity(model, context, { apiKey, signal: ac.signal });
    let text = "";
    for await (const ev of stream) {
      row.events++;
      if (ev?.type === "text_delta" && typeof ev.delta === "string") text += ev.delta;
      if (ev?.type === "text" && typeof ev.text === "string") text += ev.text;
      if (ev?.type === "error") {
        row.errorMessage = String(ev.error?.errorMessage || ev.error?.message || "error").slice(0, 400);
      }
      if (row.events > 400) break;
    }
    if (typeof stream.result === "function") {
      const r = await stream.result();
      row.stopReason = r?.stopReason ?? null;
      if (r?.errorMessage) row.errorMessage = String(r.errorMessage).slice(0, 400);
      if (!text && Array.isArray(r?.content)) {
        text = r.content.filter((c) => c?.type === "text").map((c) => c.text || "").join("");
      }
    }
    row.textPreview = text.slice(0, 80);
    row.ok = !row.throw && row.stopReason !== "error" && !row.errorMessage && /pong/i.test(text);
  } catch (e) {
    row.throw = String(e).slice(0, 500);
  } finally {
    clearTimeout(timer);
    row.ms = Date.now() - t0;
  }
  return row;
}

function skipNoAuth(provider) {
  return {
    provider,
    skipped: true,
    reason: `no auth for ${provider} — live stream skipped (documented)`,
    ok: null,
  };
}

const auth = loadAuth();
const results = {
  when_ict: new Date().toISOString(),
  auth_keys: Object.keys(auth),
  providers: {},
};

results.providers["google-antigravity"] = await pongAntigravity(auth);
results.providers.cursor = hasCred(auth, "cursor")
  ? { provider: "cursor", skipped: true, reason: "auth present but native/live PONG harness not wired for cursor yet", ok: null }
  : skipNoAuth("cursor");
results.providers.devin = hasCred(auth, "devin")
  ? { provider: "devin", skipped: true, reason: "auth present but native/live PONG harness not wired for devin yet", ok: null }
  : skipNoAuth("devin");

const exportDir = existsSync("/workspace/exports") ? "/workspace/exports" : join(ROOT, "tmp");
mkdirSync(exportDir, { recursive: true });
const outPath = join(exportDir, "pi-custom-providers-stream-pong-smoke.json");
writeFileSync(outPath, JSON.stringify(results, null, 2) + "\n");
console.log(JSON.stringify(results, null, 2));
console.log("wrote", outPath);

const anti = results.providers["google-antigravity"];
if (!anti.skipped && !anti.ok) process.exit(1);
