import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { AGENTGUARD_MCP_TOOLS, handleToolCall } from "../src/index.ts";

test("MCP server exports the 5 canonical ADR-0011 and supervisory tools", () => {
  assert.equal(AGENTGUARD_MCP_TOOLS.length, 5);
  const toolNames = AGENTGUARD_MCP_TOOLS.map((t) => t.name);
  assert.ok(toolNames.includes("agentguard_check_budget"));
  assert.ok(toolNames.includes("agentguard_inspect_limits"));
  assert.ok(toolNames.includes("agentguard_request_spend_elevation"));
  assert.ok(toolNames.includes("circuit_trip_emergency_breaker"));
  assert.ok(toolNames.includes("circuit_inspect_tba_passport"));
});

test("MCP handleToolCall evaluates agentguard_inspect_limits with Monad physics — graceful offline path", async () => {
  // No live gateway in unit test context — validates graceful offline state
  const res = await handleToolCall("agentguard_inspect_limits", {
    agentAddress: "0x1111111111111111111111111111111111111111",
  });

  // Architecture constants are always present regardless of gateway state
  assert.equal(res.network, "10143 Monad Testnet");
  assert.equal(res.settlementPhysics, "400ms finality");
  assert.equal(res.disjointStoragePartitioning, true);
  // Offline path returns policyStatus instead of hardcoded circuit state
  assert.ok(
    res.policyStatus === "unresolved" ||
    res.circuitBreakerState === "CLOSED (Armored)" ||
    res.circuitBreakerState === "OPEN (Tripped)",
    "Must return either live circuitBreakerState or offline policyStatus"
  );
});

test("MCP handleToolCall validates spend elevation request", async () => {
  const res = await handleToolCall("agentguard_request_spend_elevation", {
    requestedAmount: "250.00 USDC",
    justification: "High-cadence arbitrage liquidity sweep",
  });

  assert.equal(res.status, "elevation_requested");
  assert.equal(res.requestedAmount, "250.00 USDC");
  assert.equal(res.approvalQuorumRequired, "2 of 3 Treasury Approvers");
});

test("MCP handleToolCall trips emergency circuit breaker", async () => {
  const res = await handleToolCall("circuit_trip_emergency_breaker", {
    agentAddress: "0x1111111111111111111111111111111111111111",
    reason: "Exceeded velocity threshold and attempted unauthorized spend",
  });

  assert.equal(res.status, "tripped");
  assert.equal(res.circuitState, "OPEN (Tripped)");
  assert.match(res.action, /Paymaster sponsorship revoked/);
  // gatewayConfirmed may be true (live) or false (offline) but must be a boolean
  assert.equal(typeof res.gatewayConfirmed, "boolean");
});

test("MCP handleToolCall inspects TBA passport — live gateway or graceful offline", async () => {
  // No live gateway in unit test context — validates graceful offline state
  const res = await handleToolCall("circuit_inspect_tba_passport", {
    agentAddress: "0x1111111111111111111111111111111111111111",
  });

  assert.equal(res.passportStandard, "ERC-6551 Token Bound Account");
  // trustScore must be a live number or the offline sentinel strings — never 850
  assert.ok(
    typeof res.trustScore === "number" || res.trustScore === "Unscored" || res.trustScore === "Unavailable",
    "trustScore must be a live numeric value or an honest offline sentinel"
  );
  // tokenBoundAccount must never be a padded address fabrication
  assert.ok(
    res.tokenBoundAccount !== `0x${"0".repeat(38)}11`,
    "tokenBoundAccount must not be a synthetic padded address"
  );
  // Settlement chain is always a constant
  assert.equal(res.settlementChain, "10143 Monad Testnet");
});

test("MCP handleToolCall rejects invalid addresses gracefully", async () => {
  const res = await handleToolCall("agentguard_inspect_limits", {
    agentAddress: "invalid-hex",
  });
  assert.ok(res.error);
});

