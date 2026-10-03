#!/usr/bin/env node
/**
 * Bundle budget gate. Measures what a first visit must download (entry script, its
 * modulepreload graph, and CSS) after gzip, per web target, and fails when a budget is
 * exceeded. Run after `npm run build:all --workspace=@agentguard/web`.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Budgets in KiB. Initial JS includes the sign-in SDK that every route needs.
const BUDGETS = {
  tenant: { initialJsGzip: 920, cssGzip: 30, largestChunkRaw: 550 },
  admin: { initialJsGzip: 920, cssGzip: 30, largestChunkRaw: 550 },
};

const kib = (bytes) => bytes / 1024;
let failed = false;

for (const [target, budget] of Object.entries(BUDGETS)) {
  const dir = join(root, "apps/web/dist", target);
  const indexPath = join(dir, "index.html");
  if (!existsSync(indexPath)) {
    console.log(`- ${target}: no build found at apps/web/dist/${target}, skipping`);
    continue;
  }
  const html = readFileSync(indexPath, "utf8");
  const refs = new Set(
    [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]),
  );
  let jsGzip = 0;
  let cssGzip = 0;
  let largest = { file: "", size: 0 };
  for (const ref of refs) {
    const file = join(dir, ref);
    if (!existsSync(file)) continue;
    const bytes = readFileSync(file);
    const gz = gzipSync(bytes).length;
    if (ref.endsWith(".css")) cssGzip += gz;
    else jsGzip += gz;
    if (ref.endsWith(".js") && bytes.length > largest.size) largest = { file: ref, size: bytes.length };
  }
  const checks = [
    ["initial JS (gzip)", kib(jsGzip), budget.initialJsGzip],
    ["CSS (gzip)", kib(cssGzip), budget.cssGzip],
    ["largest initial chunk (raw)", kib(largest.size), budget.largestChunkRaw],
  ];
  for (const [label, actual, limit] of checks) {
    const ok = actual <= limit;
    if (!ok) failed = true;
    console.log(`${ok ? "OK  " : "FAIL"} ${target}: ${label} ${actual.toFixed(0)} KiB / ${limit} KiB`);
  }
}

if (failed) {
  console.error("Bundle budget exceeded. Lazy-load the new code or raise the budget with a justification.");
  process.exit(1);
}
console.log("Bundle budget passed.");
