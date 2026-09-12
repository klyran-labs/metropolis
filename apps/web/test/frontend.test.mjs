import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseEther, hashTypedData, recoverAddress } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  ReasonCode,
  REASON_CODE_MESSAGES,
  AGENTGUARD_EIP712_DOMAIN,
  SPEND_REQUEST_TYPES,
  MONAD_TESTNET_CHAIN_ID,
} from "@agentguard/shared-types";

test("AgentGuard Frontend: Landing page presents enterprise value metrics with zero debug leaks", async () => {
  const source = await readFile(new URL("../src/components/LandingPage.tsx", import.meta.url), "utf8");
  assert.match(source, /AgentGuard/);
  assert.match(source, /Autonomous agent spend control/);
  assert.match(source, /400ms/);
  assert.match(source, /O\(1\)/);
  assert.match(source, /Non-Custodial/);
  // Zero technical debug leaks
  assert.doesNotMatch(source, /9101/);
  assert.doesNotMatch(source, /9002/);
  assert.doesNotMatch(source, /localhost/);
});

test("AgentGuard Domain: Complete machine-readable reason codes and diagnostic descriptions", () => {
  const expectedCodes = [
    { code: ReasonCode.ERR_NONE, name: "ERR_NONE" },
    { code: ReasonCode.ERR_KILL_SWITCH, name: "ERR_KILL_SWITCH" },
    { code: ReasonCode.ERR_MAX_PER_TX, name: "ERR_MAX_PER_TX" },
    { code: ReasonCode.ERR_MAX_PER_WINDOW, name: "ERR_MAX_PER_WINDOW" },
    { code: ReasonCode.ERR_VELOCITY_EXCEEDED, name: "ERR_VELOCITY_EXCEEDED" },
    { code: ReasonCode.ERR_MERCHANT_NOT_ALLOWED, name: "ERR_MERCHANT_NOT_ALLOWED" },
    { code: ReasonCode.ERR_BUDGET_DEPLETED, name: "ERR_BUDGET_DEPLETED" },
    { code: ReasonCode.ERR_EXPIRED, name: "ERR_EXPIRED" },
    { code: ReasonCode.ERR_NONCE_REUSED, name: "ERR_NONCE_REUSED" },
    { code: ReasonCode.ERR_SIGNATURE_INVALID, name: "ERR_SIGNATURE_INVALID" },
  ];

  for (const item of expectedCodes) {
    assert.ok(item.code >= 0, `Reason code ${item.name} must be >= 0`);
    const msg = REASON_CODE_MESSAGES[item.code];
    assert.ok(msg && msg.length > 5, `Reason message for ${item.name} must be defined and meaningful`);
  }
});

test("AgentGuard Frontend: Payment evaluation requires user-entered real intent data", async () => {
  const source = await readFile(new URL("../src/components/dashboard/RogueAgentSimulator.tsx", import.meta.url), "utf8");
  assert.match(source, /Evaluate a real payment intent/);
  assert.match(source, /Merchant address/);
  assert.match(source, /Evaluate onchain/);
  assert.match(source, /createPolicyRejectionResponse/);
  assert.doesNotMatch(source, /0x8888888888888888888888888888888888888888/);
  assert.doesNotMatch(source, /fakeTxHash|Mock|mockSignature/);
});

test("AgentGuard Frontend: PolicyStudio enforces positive limits and valid window constraints", async () => {
  const source = await readFile(new URL("../src/components/dashboard/PolicyStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /Max Spend Per Transaction/);
  assert.match(source, /Max Spend Per Sliding Window/);
  assert.match(source, /Sliding Window Duration/);
  assert.match(source, /Max Transaction Velocity/);
  assert.match(source, /Active Kill Switch/);
  assert.match(source, /windowSeconds <= 0/);
  assert.match(source, /maxVelocity <= 0/);
});

test("AgentGuard Frontend: FleetOverview renders agent table, filters, and O(1) kill-switch controls", async () => {
  const source = await readFile(new URL("../src/components/dashboard/FleetOverview.tsx", import.meta.url), "utf8");
  assert.match(source, /Monitored Agent Wallets/);
  assert.match(source, /Velocity \(Tx \/ Limit\)/);
  assert.match(source, /Reputation/);
  assert.match(source, /Actions/);
  assert.match(source, /Kill Switch/);
  assert.match(source, /Restore/);
  assert.match(source, /Register Agent/);
  assert.match(source, /Lifecycle/);
});

test("AgentGuard Frontend: AuditLedger formats onchain reason codes, export buttons, and explorer links", async () => {
  const source = await readFile(new URL("../src/components/dashboard/AuditLedger.tsx", import.meta.url), "utf8");
  assert.match(source, /Verifiable Policy Audit Trail/);
  assert.match(source, /ERR_\{rec\.decision\.reasonCode\}/);
  assert.match(source, /handleExportJSON/);
  assert.match(source, /handleExportCSV/);
  assert.match(source, /MONAD_EXPLORER_URL/);
});

test("AgentGuard Frontend: DisjointSlotVisualizer renders 32-byte Monad packed storage slot", async () => {
  const source = await readFile(new URL("../src/components/dashboard/DisjointSlotVisualizer.tsx", import.meta.url), "utf8");
  assert.match(source, /computePackedSlotHex/);
  assert.match(source, /spentInWindow/);
  assert.match(source, /windowStart/);
  assert.match(source, /txCountInWindow/);
  assert.match(source, /nonce/);
  assert.match(source, /Single 32-Byte Word/);
});

test("AgentGuard Frontend: AgentOnboardingModal supports templates and address validation", async () => {
  const source = await readFile(new URL("../src/components/dashboard/AgentOnboardingModal.tsx", import.meta.url), "utf8");
  assert.match(source, /Provision New Autonomous Agent/);
  assert.match(source, /AGENT_TEMPLATES/);
  assert.match(source, /Use an existing agent wallet/);
  assert.doesNotMatch(source, /Generate Testnet Keypair/);
  assert.match(source, /Max Per Tx/);
  assert.match(source, /Max Per Window/);
});

test("AgentGuard Frontend: LifecycleStudio renders authoritative operational state", async () => {
  const source = await readFile(new URL("../src/components/dashboard/LifecycleStudio.tsx", import.meta.url), "utf8");
  assert.match(source, /Agent lifecycle/);
  assert.match(source, /Spend state/);
  assert.match(source, /Audit evidence is chain-derived/);
  assert.doesNotMatch(source, /fakeTxHash|Mock|mockSignature|LIFECYCLE_STAGES/);
});

test("AgentGuard Cryptography: EIP-712 SpendRequest signing and signer recovery on Monad (10143)", async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const merchant = "0x8888888888888888888888888888888888888888";

  const spendRequest = {
    agent: account.address,
    merchant,
    amount: parseEther("0.25"),
    category: "0x0000000000000000000000000000000000000000000000000000000000000001",
    timestamp: 1720000000n,
    deadline: 1720003600n,
    nonce: 7n,
  };

  const signature = await account.signTypedData({
    domain: AGENTGUARD_EIP712_DOMAIN,
    types: SPEND_REQUEST_TYPES,
    primaryType: "SpendRequest",
    message: spendRequest,
  });

  const recovered = await recoverAddress({
    hash: hashTypedData({
      domain: AGENTGUARD_EIP712_DOMAIN,
      types: SPEND_REQUEST_TYPES,
      primaryType: "SpendRequest",
      message: spendRequest,
    }),
    signature,
  });

  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());
  assert.equal(AGENTGUARD_EIP712_DOMAIN.chainId, MONAD_TESTNET_CHAIN_ID);
});

test("AgentGuard Zero-Mock Mandate: Zero Math.random in frontend runtime code", async () => {
  const files = [
    "../src/components/dashboard/FleetOverview.tsx",
    "../src/components/dashboard/PolicyStudio.tsx",
    "../src/components/dashboard/RogueAgentSimulator.tsx",
    "../src/components/dashboard/AuditLedger.tsx",
    "../src/components/dashboard/LifecycleStudio.tsx",
    "../src/components/dashboard/AgentOnboardingModal.tsx",
    "../src/components/dashboard/DisjointSlotVisualizer.tsx",
    "../src/components/LandingPage.tsx",
    "../src/hooks/usePolicyContracts.ts",
  ];

  for (const file of files) {
    const content = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(content, /Math\.random\(\)/, `File ${file} must not contain Math.random()`);
  }
});
