#!/usr/bin/env bun
/**
 * One-off live PONG smoke for xai-omp (SuperGrok OAuth).
 * Uses native SuperGrok OAuth refresh (shared/xai-oauth-native.ts). Never prints tokens.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const AUTH_PATH = process.env.PI_AUTH_JSON || join(homedir(), ".pi/agent/auth.json");
const MODEL_ID = process.env.XAI_SMOKE_MODEL || "grok-4.6";
const BASE = "https://api.x.ai/v1";
const API = "openai-responses";

// Ensure Node+jiti hosts also get Bun APIs if somehow run under node
try {
  await import(join(ROOT, "shared/bun-shim.ts"));
} catch {
  /* bun native */
}

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
  const { makeXaiNativeOAuth } = await import(join(ROOT, "shared/xai-oauth-native.ts"));
  return makeXaiNativeOAuth();
}

async function ensureAccess(auth) {
  const creds = pickCreds(auth);
  if (!creds?.access) throw new Error("no xai-omp/xai-oauth/xai credentials in auth.json");

  const oauth = await loadNativeAuth();
  let refresh = { attempted: false, ok: null, error: null };

  const needsRefresh = isExpired(creds);
  if (needsRefresh) {
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

  const apiKey = oauth.getApiKey(creds);
  return { creds, apiKey, refresh, oauth };
}

async function loadCatalogModel(modelId) {
  const catalogPath = join(
    ROOT,
    "node_modules/.bun/@oh-my-pi+pi-catalog@18.2.6/node_modules/@oh-my-pi/pi-catalog/src/models.json",
  );
  const models = JSON.parse(readFileSync(catalogPath, "utf8"));
  const bucket = models["xai-oauth"] || {};
  const entry = bucket[modelId] || Object.values(bucket)[0];
  if (!entry) throw new Error("xai-oauth catalog empty");
  return entry;
}

async function streamOnce(apiKey, modelId) {
  const { streamOpenAIResponses } = await import("@oh-my-pi/pi-ai/providers/openai-responses");
  const catalogModel = await loadCatalogModel(modelId);
  const model = {
    ...catalogModel,
    maxTokens: Math.min(catalogModel.maxTokens || 1024, 1024),
  };
  modelId = model.id;
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
  };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  const t0 = Date.now();
  try {
    const stream = streamOpenAIResponses(model, context, { apiKey, signal: ac.signal });
    let text = "";
    for await (const ev of stream) {
      row.events++;
      if (ev?.type === "text_delta" && typeof ev.delta === "string") text += ev.delta;
      if (ev?.type === "text" && typeof ev.text === "string") text += ev.text;
      if (ev?.type === "done" && ev.message) {
        // some streams emit final message
        const c = ev.message.content;
        if (Array.isArray(c)) text += c.filter((x) => x?.type === "text").map((x) => x.text || "").join("");
      }
      if (ev?.type === "error") {
        row.errorMessage = String(ev.error?.errorMessage || ev.error?.message || ev.message || "error").slice(0, 400);
      }
      if (row.events > 500) break;
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
      const key = oauth.getApiKey(updated);
      stream = await streamOnce(key, MODEL_ID);
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
