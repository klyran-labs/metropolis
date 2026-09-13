/**
 * @agentguard/x402-middleware
 * Standard x402 / AP2 Payment Protocol and Policy Enforcement Layer for AgentGuard on Monad.
 */

import {
  type Address,
  type Hash,
  type SpendRequest,
  type SpendPolicy,
  type PolicyDecision,
  ReasonCode,
  REASON_CODE_MESSAGES,
  AGENTGUARD_EIP712_DOMAIN,
  SPEND_REQUEST_TYPES,
  MONAD_TESTNET_CHAIN_ID,
  type X402PaymentRequirement,
  type X402ChallengeResponse,
} from "@agentguard/shared-types";
import { hashTypedData, recoverAddress } from "viem";

function toBase64(str: string): string {
  if (typeof globalThis !== "undefined" && (globalThis as any).Buffer) {
    return (globalThis as any).Buffer.from(str, "utf-8").toString("base64");
  }
  return btoa(unescape(encodeURIComponent(str)));
}

function fromBase64(b64: string): string {
  if (typeof globalThis !== "undefined" && (globalThis as any).Buffer) {
    return (globalThis as any).Buffer.from(b64, "base64").toString("utf-8");
  }
  return decodeURIComponent(escape(atob(b64)));
}

export interface X402AuthorizationPayload {
  request: SpendRequest;
  signature: `0x${string}`;
}

/**
 * Generates an authentic HTTP 402 Payment Required challenge for agent clients
 */
export function createX402Challenge(req: {
  payTo: Address;
  amountWei: string;
  token: Address;
  serviceId: string;
  category: string;
  description: string;
}): X402ChallengeResponse {
  const requirement: X402PaymentRequirement = {
    payTo: req.payTo,
    amount: req.amountWei,
    token: req.token,
    chainId: MONAD_TESTNET_CHAIN_ID,
    serviceId: req.serviceId,
    category: req.category,
    description: req.description,
  };

  const challengeJson = JSON.stringify(requirement);
  const challengeBase64 = toBase64(challengeJson);

  return {
    statusCode: 402,
    headers: {
      "WWW-Authenticate": `x402 realm="AgentGuard", challenge="${challengeBase64}"`,
      "X-402-Payment-Required": challengeBase64,
    },
    body: {
      error: "Payment Required",
      challenge: requirement,
      supportedPolicies: ["SpendLimit", "VelocityCap", "MerchantWhitelist", "KillSwitch"],
    },
  };
}

/**
 * Encodes an agent's EIP-712 signed spend request into the x402 authorization header
 */
export function encodeX402Authorization(payload: X402AuthorizationPayload): string {
  const serialized = JSON.stringify({
    request: {
      ...payload.request,
      amount: payload.request.amount.toString(),
      timestamp: payload.request.timestamp.toString(),
      deadline: payload.request.deadline.toString(),
      nonce: payload.request.nonce.toString(),
    },
    signature: payload.signature,
  });
  return `x402 ${toBase64(serialized)}`;
}

/**
 * Parses and deserializes the x402 authorization header from an agent request
 */
export function parseX402Authorization(headerValue: string | undefined): X402AuthorizationPayload | null {
  if (!headerValue || !headerValue.startsWith("x402 ")) {
    return null;
  }

  try {
    const rawBase64 = headerValue.slice(5).trim();
    const jsonStr = fromBase64(rawBase64);
    const parsed = JSON.parse(jsonStr);

    return {
      request: {
        agent: parsed.request.agent,
        merchant: parsed.request.merchant,
        amount: BigInt(parsed.request.amount),
        category: parsed.request.category,
        timestamp: BigInt(parsed.request.timestamp),
        deadline: BigInt(parsed.request.deadline),
        nonce: BigInt(parsed.request.nonce),
      },
      signature: parsed.signature,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies EIP-712 cryptographic signature of the SpendRequest on Monad
 */
export async function verifySpendRequestSignature(
  payload: X402AuthorizationPayload,
  verifyingContract: Address
): Promise<boolean> {
  try {
    const domain = {
      ...AGENTGUARD_EIP712_DOMAIN,
      verifyingContract,
    };

    const hash = hashTypedData({
      domain,
      types: SPEND_REQUEST_TYPES,
      primaryType: "SpendRequest",
      message: payload.request,
    });

    const recovered = await recoverAddress({
      hash,
      signature: payload.signature,
    });

    return recovered.toLowerCase() === payload.request.agent.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Translates an onchain ReasonCode into an enterprise machine-readable HTTP error response
 */
export function createPolicyRejectionResponse(
  reasonCode: ReasonCode,
  agent: Address,
  additionalDetails?: Record<string, unknown>
) {
  return {
    statusCode: 403,
    headers: {
      "Content-Type": "application/json",
      "X-AgentGuard-Decision": "DENIED",
      "X-AgentGuard-Reason-Code": reasonCode.toString(),
    },
    body: {
      error: "Policy Violation",
      reasonCode,
      reasonMessage: REASON_CODE_MESSAGES[reasonCode] || "Transaction blocked by spend policy",
      agent,
      settlementChain: "Monad Testnet (10143)",
      remediation: getRemediationAction(reasonCode),
      details: additionalDetails || null,
    },
  };
}

function getRemediationAction(reasonCode: ReasonCode): string {
  switch (reasonCode) {
    case ReasonCode.ERR_KILL_SWITCH:
      return "Contact organization administrator to lift emergency kill switch on this agent wallet.";
    case ReasonCode.ERR_MAX_PER_TX:
      return "Split payment into smaller batches or request an authorized maxPerTx policy increase.";
    case ReasonCode.ERR_MAX_PER_WINDOW:
      return "Wait for current sliding window to roll over or increase maxPerWindow budget allocation.";
    case ReasonCode.ERR_VELOCITY_EXCEEDED:
      return "Throttle request rate. Maximum transaction velocity has been exceeded for this window.";
    case ReasonCode.ERR_MERCHANT_NOT_ALLOWED:
      return "Add counterparty address to the agent's authorized merchant whitelist.";
    case ReasonCode.ERR_BUDGET_DEPLETED:
      return "Replenish the assigned organizational budget pool or reassign the agent to an active pool with available balance.";
    case ReasonCode.ERR_EXPIRED:
      return "Regenerate spend request with a fresh block timestamp and forward deadline.";
    case ReasonCode.ERR_NONCE_REUSED:
      return "Increment spend request nonce to prevent onchain replay rejection.";
    case ReasonCode.ERR_SIGNATURE_INVALID:
      return "Verify agent private key signing matches the EIP-712 domain separator on Monad (10143).";
    default:
      return "Review policy parameters on the AgentGuard enterprise console.";
  }
}
