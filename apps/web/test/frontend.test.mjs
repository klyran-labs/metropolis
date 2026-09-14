import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = async (file) => readFile(new URL(`../src/${file}`, import.meta.url), "utf8");

test("frontend is a real-data multi-tenant control plane", async () => {
  const [application, api, configuration] = await Promise.all([
    source("application.tsx"),
    source("api.ts"),
    source("configuration.ts"),
  ]);
  assert.match(application, /platformAccess/);
  assert.match(api, /Authorization/);
  assert.match(api, /agents/);
  assert.match(api, /subscription/);
  assert.match(configuration, /local.*testnet.*mainnet/s);
  assert.doesNotMatch(application, /Math\.random\(\)/);
});

test("frontend uses shared design and data primitives", async () => {
  const [design, screens, styles] = await Promise.all([
    source("design-system.tsx"),
    source("screens.tsx"),
    source("globals.css"),
  ]);
  assert.match(design, /Surface/);
  assert.match(screens, /@tanstack\/react-table/);
  assert.match(screens, /@tanstack\/react-virtual/);
  assert.match(screens, /echarts/);
  assert.match(styles, /--primary/);
  assert.match(styles, /48px/);
});

test("frontend has no prohibited developer-facing copy", async () => {
  const files = ["application.tsx", "api.ts", "design-system.tsx", "identity.tsx", "navigation.tsx", "screens.tsx"];
  const contents = await Promise.all(files.map(source));
  const combined = contents.join("\n");
  assert.doesNotMatch(combined, /docker compose|localhost:\d+|raw exception|stack trace/i);
  assert.doesNotMatch(combined, /Math\.random\(\)/);
});
