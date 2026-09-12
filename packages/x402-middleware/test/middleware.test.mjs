import test from "node:test";
import assert from "node:assert/strict";
import {
  createX402Challenge,
  encodeX402Authorization,
  parseX402Authorization,
  verifySpendRequestSignature,
  createPolicyRejectionResponse,
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
});
