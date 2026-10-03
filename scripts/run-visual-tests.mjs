#!/usr/bin/env node
// Runs the screenshot comparison inside the pinned Playwright image on linux/amd64, the same image
// and architecture CI uses, so a baseline made on any developer machine matches what CI renders.
//
//   npm run test:visual           compare against the committed baselines
//   npm run test:visual:update    regenerate baselines (review the images before committing)
//
// The repository is mounted into the container; node_modules live in named Docker volumes so the
// host's platform-specific binaries are never mixed with the container's.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const version = JSON.parse(readFileSync(resolve(root, "node_modules/@playwright/test/package.json"), "utf8")).version;
const image = `mcr.microsoft.com/playwright:v${version}-noble`;
const update = process.argv.includes("--update");
const extra = process.argv.slice(2).filter((argument) => argument !== "--update");

const inside = [
  "set -e",
  // Install once per volume; later runs reuse it.
  "[ -f node_modules/.ag-installed ] || (npm ci --ignore-scripts --no-audit --no-fund && touch node_modules/.ag-installed)",
  "npm run build --workspace=@agentguard/shared-types >/dev/null",
  "npm run build --workspace=@agentguard/x402-middleware >/dev/null",
  "cd apps/web",
  `CI=1 E2E_VISUAL=1 npx playwright test --project=visual ${update ? "--update-snapshots" : ""} ${extra.join(" ")}`,
].join(" && ");

const result = spawnSync(
  "docker",
  [
    "run", "--rm", "--platform", "linux/amd64", "--ipc=host",
    "-v", `${root}:/work`,
    "-v", "agentguard-visual-node-modules:/work/node_modules",
    "-v", "agentguard-visual-web-node-modules:/work/apps/web/node_modules",
    "-w", "/work",
    image, "bash", "-c", inside,
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
