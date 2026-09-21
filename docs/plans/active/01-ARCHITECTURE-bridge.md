# Architecture: Stable Bridge (MyInjector pattern)

Status: active  
Repo: `pi-custom-providers`  
Analog: [MyInjector `bridge` + `arch`](https://github.com/5ec1cff/MyInjector/tree/master/app/src/main/java/io/github/a13e300/myinjector) vs libxposed API 102  
Date: 2026-09-21

## Problem

Upstream churn (omp stream modules, Bun-only APIs, Continuity path helpers) previously forced patches *outside* the provider contract. That is the same failure mode as hook code importing `XposedInterface` directly and breaking when libxposed bumps.

## Goal

Freeze a **stable contract** that providers and Continuity consumers rely on. Confine omp / Pi host / Bun differences to **one thin adapter layer**. Bumping omp or Pi must not require rewriting provider handlers or Continuity.

## Non-goals

- Vendoring full omp OAuth/stream implementations.
- Patching `pi-continuity-work-memory` to paper over omp stream / Bun bugs (reverted; Continuity owns memory authority only).
- Dual stream paths (omp stream + native) for the same provider.

## Layer map (MyInjector → this repo)

| MyInjector | This repo | Owns | Must NOT import |
|---|---|---|---|
| `Entry : XposedModule` | Root `package.json` `pi.extensions` + each `providers/*/index.ts` default export | Host lifecycle: register models, oauth, `streamSimple` | omp `pi-ai/providers/*` streams |
| `bridge.*` (XC_MethodHook surface) | **Bridge contract**: earendil `ExtensionAPI` + `streamSimple(model, context, options)` returning Pi assistant event stream; shared factories in `shared/native-*.ts` and `shared/xai-oauth-native.ts` public shapes | Stable call shapes for handlers | Host Bun internals; Continuity internals |
| `MethodHookCallback` / Invoker ORIGIN | **Adapters**: `shared/omp-thin.ts` (catalog + optional omp OAuth), `shared/omp-import.ts` + `bun-shim.ts` (Node/jiti), `*-native.ts` (HTTP/SSE/Connect → events) | Translate omp/registry/network → bridge | Continuity; feature policy |
| `IHook` / app handlers | **Handlers**: `providers/<id>/*` (minus `*-native` which is adapter) | Package-specific wiring only | `@oh-my-pi/pi-ai/providers/*` |
| `HotLoadClassLoader` keeps `bridge.*` on parent | **Shared modules stay identity-stable**: handlers import `../../shared/*`; do not duplicate stream helpers per provider unless protocol-unique | Class/module identity across reloads | Re-exporting omp stream modules |

## Authority split (dual-authority with Continuity)

| Authority | Owns | Does not own |
|---|---|---|
| **pi-custom-providers** | Provider registration, OAuth adapters, **native streams**, catalog load from omp `models.json` | Session memory, workflow eligibility, Continuity paths |
| **omp (`@oh-my-pi/*`)** | Catalog JSON, optional OAuth login hooks, protobuf codecs under `pi-catalog/discovery` | Runtime stream used by Pi |
| **Pi host (earendil)** | ExtensionAPI, auth.json store, jiti load | omp version pins inside this package |
| **pi-continuity-work-memory** | Memory pipeline, skills, workflow eligibility | Provider stream implementation |

Rule: a bug that only appears on `cursor`/`xai-omp` streams is a **providers** bug (fix native adapter), never a Continuity patch.

## Hard invariants

1. **No** `import` / `importOmp("@oh-my-pi/pi-ai/providers/...")` under `providers/` or `shared/native-*.ts` or `providers/**/*-native.ts`.
2. Every registered provider passes a **native** `streamSimple` (required). `loadStreamFn` / `createOmpStreamSimple` are removed.
3. omp may appear only for: catalog `models.json`, OAuth `getProviderDefinition` login/refresh (unless `oauthFactory`), Connect protobuf codecs.
4. Peer-only `@earendil-works/pi-*` and `typebox`.
5. Smoke on **Node + jiti** before ship (`smoke:node`, `smoke:pong` when creds exist).

## TypeSafe labels

- `stream_strategy=native_fetch_sse_or_connect`
- `auth_strategy=omp_oauth_or_native_factory`
- `catalog_strategy=omp_models_json_fs`
- `update_strategy=dependabot_omp_deps`
- `boundary_enforcement=check_bridge_boundary_script`
- `continuity_strategy=separate_authority_no_stream_patches`

## Diagram

```text
Pi host (ExtensionAPI, auth.json, jiti)
        │
        ▼
 providers/*/index.ts          ← Entry / handler wiring
        │
        ├─► shared/omp-thin.ts     ← Adapter: catalog + optional omp OAuth
        │         │
        │         └─► @oh-my-pi/pi-catalog | pi-ai/registry (OAuth only)
        │
        └─► streamSimple ──────────► shared/native-*.ts | *-native.ts
                                            │
                                            └─► fetch / SSE / Connect  (no omp stream)
```

## Success criteria

- Docs describe the four layers and Continuity boundary.
- `bun run check:boundary` fails if any forbidden omp stream import appears.
- `loadStreamFn` / `createOmpStreamSimple` dead path removed; missing `streamSimple` throws.
- Existing smokes still pass; no provider behavior change intended beyond enforcement.
