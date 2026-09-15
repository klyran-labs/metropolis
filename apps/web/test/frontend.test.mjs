import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const sourceRoot = new URL("../src/", import.meta.url);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(path)));
    } else if (/\.(tsx?|css)$/.test(entry.name)) {
      files.push(path);
    }
  }
  return files;
}

async function combinedSource() {
  const files = await walk(sourceRoot.pathname);
  const contents = await Promise.all(files.map((file) => readFile(file, "utf8")));
  return { files, combined: contents.join("\n") };
}

test("frontend is a real-data multi-tenant control plane", async () => {
  const [application, api, configuration] = await Promise.all([
    readFile(new URL("../src/application.tsx", import.meta.url), "utf8"),
    readFile(new URL("../src/api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/configuration.ts", import.meta.url), "utf8"),
  ]);
  const { combined } = await combinedSource();
  assert.match(combined, /platformAccess/);
  assert.match(api, /Authorization/);
  assert.match(api, /agents/);
  assert.match(api, /subscription/);
  assert.match(configuration, /local.*testnet.*mainnet/s);
  assert.doesNotMatch(application, /Math\.random\(\)/);
});

test("frontend uses shared design and data primitives", async () => {
  const { combined } = await combinedSource();
  assert.match(combined, /Surface/);
  assert.match(combined, /@tanstack\/react-table/);
  assert.match(combined, /@tanstack\/react-virtual/);
  assert.match(combined, /@tanstack\/react-router/);
  assert.match(combined, /echarts/);
  assert.match(combined, /--primary/);
  assert.match(combined, /48px/);
});

test("frontend has no prohibited developer-facing copy", async () => {
  const { combined } = await combinedSource();
  assert.doesNotMatch(combined, /docker compose|localhost:\d+|raw exception|stack trace/i);
  assert.doesNotMatch(combined, /Math\.random\(\)/);
});
