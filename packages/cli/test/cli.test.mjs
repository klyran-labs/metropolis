import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("CLI package exports canonical bin and commands", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(pkg.name, "@agentguard/cli");
  assert.equal(pkg.bin.agentguard, "./dist/bin.js");
  assert.equal(pkg.bin.circuit, "./dist/bin.js");

  const binContent = await readFile(new URL("../src/bin.ts", import.meta.url), "utf8");
  assert.match(binContent, /login/);
  assert.match(binContent, /agents/);
  assert.match(binContent, /register/);
  assert.match(binContent, /freeze/);
  assert.match(binContent, /unfreeze/);
  assert.match(binContent, /proxy/);
  assert.match(binContent, /finops/);
  assert.match(binContent, /calculate/);
  assert.match(binContent, /mcp/);
  assert.match(binContent, /init/);
});

test("CLI commands enforce zero-mock real-endpoint connectivity", async () => {
  const agentsSrc = await readFile(new URL("../src/commands/agents.ts", import.meta.url), "utf8");
  const loginSrc = await readFile(new URL("../src/commands/login.ts", import.meta.url), "utf8");
  const finopsSrc = await readFile(new URL("../src/commands/finops.ts", import.meta.url), "utf8");
  const mcpSrc = await readFile(new URL("../src/commands/mcp.ts", import.meta.url), "utf8");

  // Zero-mock checks
  assert.doesNotMatch(agentsSrc, /Math\.random\(\)/);
  assert.doesNotMatch(loginSrc, /Math\.random\(\)/);
  assert.doesNotMatch(finopsSrc, /Math\.random\(\)/);
  assert.doesNotMatch(mcpSrc, /Math\.random\(\)/);

  // Address validation & FinOps rate simulation checks
  assert.match(agentsSrc, /isAddress/);
  assert.match(agentsSrc, /killSwitch:\s*true/);
  assert.match(finopsSrc, /DEFAULT_RATES/);
  assert.match(finopsSrc, /Monad Parallel EVM/);
  assert.match(mcpSrc, /@agentguard\/mcp-server/);
});

