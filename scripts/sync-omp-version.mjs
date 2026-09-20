#!/usr/bin/env node
/**
 * Bump @oh-my-pi/pi-ai and @oh-my-pi/pi-catalog in package.json to latest npm.
 * Commit message convention: chore(deps): bump @oh-my-pi/pi-ai
 *
 * Usage: node scripts/sync-omp-version.mjs [--write]
 * Default is dry-run (prints versions). Pass --write to edit package.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = join(root, "package.json");
const write = process.argv.includes("--write");

function latest(name) {
  return execSync(`npm view ${name} version`, { encoding: "utf8" }).trim();
}

const ai = latest("@oh-my-pi/pi-ai");
const catalog = latest("@oh-my-pi/pi-catalog");
console.log(`latest @oh-my-pi/pi-ai=${ai} @oh-my-pi/pi-catalog=${catalog}`);

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const deps = pkg.dependencies ?? {};
const nextAi = `^${ai}`;
const nextCatalog = `^${catalog}`;
console.log(`current pi-ai=${deps["@oh-my-pi/pi-ai"]} → ${nextAi}`);
console.log(`current pi-catalog=${deps["@oh-my-pi/pi-catalog"]} → ${nextCatalog}`);

if (!write) {
  console.log("dry-run; re-run with --write to apply");
  console.log('suggested commit: chore(deps): bump @oh-my-pi/pi-ai');
  process.exit(0);
}

pkg.dependencies = {
  ...deps,
  "@oh-my-pi/pi-ai": nextAi,
  "@oh-my-pi/pi-catalog": nextCatalog,
};
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
console.log("wrote", pkgPath);
console.log("next: bun install && git commit -m 'chore(deps): bump @oh-my-pi/pi-ai'");
