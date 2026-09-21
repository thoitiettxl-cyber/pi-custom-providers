#!/usr/bin/env node
/**
 * Live PONG smoke for xai-omp via native OpenAI Responses (fetch/SSE).
 * Never prints tokens.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { homedir } from "node:os";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const AUTH_PATH = process.env.PI_AUTH_JSON || join(homedir(), ".pi/agent/auth.json");
const MODEL_ID = process.env.XAI_SMOKE_MODEL || "grok-4.6";
const BASE = "https://api.x.ai/v1";

const require = createRequire(import.meta.url);

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
  return JSON.parse(readFileSync(AUTH_PATH, "utf8"));
}

function saveAuth(auth) {
  writeFileSync(AUTH_PATH, JSON.stringify(auth, null, 2) + "\n", { mode: 0o600 });
}

function pickCreds(auth) {
  return auth["xai-omp"] || auth["xai-oauth"] || auth["xai"] || null;
}

function isExpired(creds, skewMs = 60_000) {
  if (!creds?.expires) return false;
  return Number(creds.expires) <= Date.now() + skewMs;
}

function summarizeCreds(creds) {
  if (!creds) return null;
  return {
    type: creds.type ?? null,
    expires: creds.expires != null ? new Date(creds.expires).toISOString() : null,
    accessLen: (creds.access || "").length,
    refreshLen: (creds.refresh || "").length,
  };
}

async function loadNativeAuth() {
  const mod = await jiti.import(join(ROOT, "shared/xai-oauth-native.ts"));
  return mod.makeXaiNativeOAuth();
}

async function ensureAccess(auth) {
  const creds = pickCreds(auth);
  if (!creds?.access) throw new Error("no xai-omp/xai-oauth/xai credentials in auth.json");

  const oauth = await loadNativeAuth();
  const refresh = { attempted: false, ok: null, error: null };

  if (isExpired(creds)) {
    refresh.attempted = true;
    try {
      const next = await oauth.refreshToken(
        { access: creds.access, refresh: creds.refresh, expires: creds.expires },
        AbortSignal.timeout(30_000),
      );
      if (!next?.access) throw new Error("refresh returned empty access");
      const updated = {
        type: "oauth",
        access: next.access,
        refresh: next.refresh || creds.refresh,
        expires: next.expires,
      };
      auth["xai-omp"] = { ...updated };
      auth["xai-oauth"] = { ...updated };
      auth["xai"] = { ...updated };
      saveAuth(auth);
      Object.assign(creds, updated);
      refresh.ok = true;
    } catch (e) {
      refresh.ok = false;
      refresh.error = String(e?.message || e).slice(0, 300);
    }
  }

  return { creds, apiKey: oauth.getApiKey(creds), refresh, oauth };
}

async function streamOnce(apiKey, modelId) {
  const { createNativeOpenAIResponsesStreamSimple } = await jiti.import(
    join(ROOT, "shared/native-openai-responses.ts"),
  );
  const streamSimple = createNativeOpenAIResponsesStreamSimple({
    loginHint: "/login xai-omp",
    defaultBaseUrl: BASE,
  });
  const model = {
    id: modelId,
    name: modelId,
    api: "openai-responses",
    provider: "xai-omp",
    baseUrl: BASE,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000,
    maxTokens: 256,
  };
  const context = {
    systemPrompt: "Reply with exactly: PONG",
    messages: [{ role: "user", content: "Reply with exactly: PONG", timestamp: Date.now() }],
  };

  const row = {
    ok: false,
    stopReason: null,
    textPreview: "",
    errorMessage: null,
    throw: null,
    events: 0,
    ms: 0,
    model: modelId,
    engine: "native-openai-responses-fetch-sse",
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  const t0 = Date.now();
  try {
    const stream = streamSimple(model, context, { apiKey, signal: ac.signal, maxTokens: 64 });
    let text = "";
    for await (const ev of stream) {
      row.events++;
      if (ev?.type === "text_delta" && typeof ev.delta === "string") text += ev.delta;
      if (ev?.type === "done") {
        row.stopReason = ev.reason ?? null;
        if (!text) {
          const c = ev.message?.content;
          if (Array.isArray(c)) {
            text = c.filter((x) => x?.type === "text").map((x) => x.text || "").join("");
          }
        }
        if (ev.message?.errorMessage) {
          row.errorMessage = String(ev.message.errorMessage).slice(0, 400);
        }
      }
      if (ev?.type === "error") {
        row.stopReason = ev.reason ?? "error";
        row.errorMessage = String(ev.error?.errorMessage || ev.error?.message || "error").slice(0, 400);
      }
      if (row.events > 500) break;
    }
    row.textPreview = text.slice(0, 80);
    row.ok = !row.throw && row.stopReason !== "error" && !row.errorMessage && /pong/i.test(text);
  } catch (e) {
    row.throw = String(e?.message || e).slice(0, 500);
  } finally {
    clearTimeout(timer);
    row.ms = Date.now() - t0;
  }
  return row;
}

const auth = loadAuth();
const report = {
  when_ict: new Date().toISOString(),
  auth_keys: Object.keys(auth),
  creds_before: summarizeCreds(pickCreds(auth)),
  refresh: null,
  stream: null,
  engine: "native-openai-responses-fetch-sse",
};

let apiKey;
let oauth;
try {
  const ensured = await ensureAccess(auth);
  report.refresh = ensured.refresh;
  report.creds_after = summarizeCreds(ensured.creds);
  apiKey = ensured.apiKey;
  oauth = ensured.oauth;
} catch (e) {
  report.refresh = { attempted: false, ok: false, error: String(e?.message || e).slice(0, 300) };
}

if (apiKey) {
  let stream = await streamOnce(apiKey, MODEL_ID);
  const msg = `${stream.errorMessage || ""} ${stream.throw || ""}`;
  if (!stream.ok && /401|unauthor|expired|invalid.?token|subscription/i.test(msg)) {
    try {
      if (!oauth) oauth = await loadNativeAuth();
      const creds = pickCreds(auth);
      const next = await oauth.refreshToken(
        { access: creds.access, refresh: creds.refresh, expires: creds.expires },
        AbortSignal.timeout(30_000),
      );
      const updated = {
        type: "oauth",
        access: next.access,
        refresh: next.refresh || creds.refresh,
        expires: next.expires,
      };
      auth["xai-omp"] = { ...updated };
      auth["xai-oauth"] = { ...updated };
      auth["xai"] = { ...updated };
      saveAuth(auth);
      report.refresh = { attempted: true, ok: true, error: null, reason: "retry-after-stream-fail" };
      report.creds_after = summarizeCreds(updated);
      stream = await streamOnce(oauth.getApiKey(updated), MODEL_ID);
    } catch (e) {
      report.refresh = {
        attempted: true,
        ok: false,
        error: String(e?.message || e).slice(0, 300),
        reason: "retry-after-stream-fail",
      };
    }
  }
  report.stream = stream;
} else {
  report.stream = { ok: false, skipped: true, reason: "no apiKey after auth/refresh" };
}

const exportDir = existsSync("/workspace/exports") ? "/workspace/exports" : join(ROOT, "tmp");
mkdirSync(exportDir, { recursive: true });
const outPath = join(exportDir, "xai-omp-pong-smoke.json");
writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));
console.log("wrote", outPath);

if (!report.stream?.ok) process.exitCode = 1;
