# Continuity boundary

`pi-continuity-work-memory` and `pi-custom-providers` are **separate authorities**.

| If the symptom is… | Fix in… |
|---|---|
| Stream hang, Bun `import.meta.dir`, omp `providers/*` load under Node | **This repo** (native adapter / shim) |
| OAuth refresh / catalog model list | This repo adapter or omp Dependabot bump |
| Memory pipeline, workflow eligibility, undefined `file.path` in Continuity | **pi-continuity-work-memory** |
| Auth store path / ExtensionAPI | Pi host |

Never patch Continuity to compensate for an omp stream or Bun-only provider module. Prefer native `streamSimple` here (MyInjector-style: fix the adapter, not every hook).
