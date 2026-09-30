import test from "node:test";
import assert from "node:assert/strict";
import {
  createX402Challenge,
  encodeX402Authorization,
  parseX402Authorization,
  verifySpendRequestSignature,
  createPolicyRejectionResponse,
  encodeX402SessionAuthorization,
  parseX402SessionAuthorization,
  encodeX402OmnichainAuthorization,
  parseX402OmnichainAuthorization,
} from "../dist/index.js";
import { ReasonCode } from "@agentguard/shared-types";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { hashTypedData } from "viem";

test("x402: challenge generation formats valid HTTP 402 headers", () => {
  const challenge = createX402Challenge({
    payTo: "0x1111111111111111111111111111111111111111",
    amountWei: "5000000",
    token: "0x5555555555555555555555555555555555555555",
    serviceId: "monad-inference-v1",
    category: "AI_INFERENCE",
    description: "DeepSeek-R1 Token Generation",
  });

  assert.equal(challenge.statusCode, 402);
  assert.ok(challenge.headers["WWW-Authenticate"].includes("x402"));
  assert.ok(challenge.headers["X-402-Payment-Required"].length > 10);
  assert.equal(challenge.body.challenge.payTo, "0x1111111111111111111111111111111111111111");
  assert.equal(challenge.body.challenge.chainId, 10143);
});

test("x402: encode and parse roundtrip preserves bigints and addresses", () => {
  const agent = "0x2222222222222222222222222222222222222222";
  const merchant = "0x3333333333333333333333333333333333333333";

  const originalPayload = {
    request: {
      agent,
      merchant,
      amount: 1500000000000000000n, // 1.5 MON
      category: "0x0000000000000000000000000000000000000000000000000000000000000001",
      timestamp: 1720000000n,
      deadline: 1720003600n,
      nonce: 42n,
    },
    signature: "0x1234567890abcdef",
  };

  const header = encodeX402Authorization(originalPayload);
  assert.ok(header.startsWith("x402 "));

  const parsed = parseX402Authorization(header);
  assert.notEqual(parsed, null);
  assert.equal(parsed.request.agent, originalPayload.request.agent);
  assert.equal(parsed.request.amount, originalPayload.request.amount);
  assert.equal(parsed.request.nonce, originalPayload.request.nonce);
  assert.equal(parsed.signature, originalPayload.signature);
});

test("x402: policy rejection maps onchain reason code to diagnostic HTTP 403", () => {
  const agent = "0x4444444444444444444444444444444444444444";
  const rejection = createPolicyRejectionResponse(ReasonCode.ERR_VELOCITY_EXCEEDED, agent);

  assert.equal(rejection.statusCode, 403);
  assert.equal(rejection.headers["X-AgentGuard-Decision"], "DENIED");
  assert.equal(rejection.headers["X-AgentGuard-Reason-Code"], "4");
  assert.equal(rejection.body.reasonCode, ReasonCode.ERR_VELOCITY_EXCEEDED);
  assert.ok(rejection.body.reasonMessage.includes("Rate limit tripped"));
  assert.ok(rejection.body.remediation.includes("Throttle request rate"));

  const budgetRejection = createPolicyRejectionResponse(ReasonCode.ERR_BUDGET_DEPLETED, agent);
  assert.equal(budgetRejection.body.reasonCode, ReasonCode.ERR_BUDGET_DEPLETED);
  assert.ok(budgetRejection.body.remediation.includes("Replenish the assigned organizational budget pool"));
});

test("x402-session: encode and parse roundtrip preserves hierarchical session parameters", () => {
  const supervisor = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const workerSigner = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const merchant = "0xcccccccccccccccccccccccccccccccccccccccc";

  const sessionPayload = {
    certificate: {
      supervisor,
      workerSigner,
      validAfter: 1720000000n,
      validUntil: 1720003600n,
      subBudgetCap: 50000000n, // 50 USDC
      capabilityMerkleRoot: "0x0000000000000000000000000000000000000000000000000000000000000000",
      sessionNonce: 7702n,
    },
    certificateSignature: "0xdeadbeef1111",
    payment: {
      merchant,
      amount: 10000000n,
      token: "0xdddddddddddddddddddddddddddddddddddddddd",
      category: "0x0000000000000000000000000000000000000000000000000000000000000000",
      deadline: 1720003000n,
      nonce: 1n,
      extraCallData: "0x",
    },
    workerSignature: "0xfeedbeef2222",
  };

  const header = encodeX402SessionAuthorization(sessionPayload);
  assert.ok(header.startsWith("x402-session "));

  const parsed = parseX402SessionAuthorization(header);
  assert.notEqual(parsed, null);
  assert.equal(parsed.certificate.supervisor, supervisor);
  assert.equal(parsed.certificate.workerSigner, workerSigner);
  assert.equal(parsed.certificate.subBudgetCap, 50000000n);
  assert.equal(parsed.certificate.sessionNonce, 7702n);
  assert.equal(parsed.payment.amount, 10000000n);
  assert.equal(parsed.workerSignature, "0xfeedbeef2222");
});

test("x402-omnichain: encode and parse roundtrip preserves remote chain execution permit", () => {
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const targetMerchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const targetToken = "0xcccccccccccccccccccccccccccccccccccccccc";

  const permitPayload = {
    permit: {
      agent,
      targetChainId: 8453n, // Base Mainnet
      targetMerchant,
      targetToken,
      amount: 75000000n, // 75 USDC
      validUntil: 1720003600n,
      monadPolicyBlock: 120500n,
      monadPolicyNonce: 99n,
      capabilityHash: "0x0000000000000000000000000000000000000000000000000000000000000000",
    },
    validatorSignature: "0x1234567890abcdef1234567890abcdef",
  };

  const header = encodeX402OmnichainAuthorization(permitPayload);
  assert.ok(header.startsWith("x402-omnichain "));

  const parsed = parseX402OmnichainAuthorization(header);
  assert.notEqual(parsed, null);
  assert.equal(parsed.permit.agent, agent);
  assert.equal(parsed.permit.targetChainId, 8453n);
  assert.equal(parsed.permit.amount, 75000000n);
  assert.equal(parsed.permit.monadPolicyBlock, 120500n);
  assert.equal(parsed.validatorSignature, "0x1234567890abcdef1234567890abcdef");
});


