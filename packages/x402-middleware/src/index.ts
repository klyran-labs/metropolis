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
  type SessionCertificate,
  type SessionDelegationPayment,
  type SessionDelegationPayload,
  type CrossChainSpendPermit,
  type CrossChainPermitPayload,
  ReasonCode,
  REASON_CODE_MESSAGES,
  AGENTGUARD_EIP712_DOMAIN,
  SPEND_REQUEST_TYPES,
  MONAD_TESTNET_CHAIN_ID,
  type X402PaymentRequirement,
  type X402ChallengeResponse,
} from "@agentguard/shared-types";
import { hashTypedData, recoverAddress, encodeAbiParameters, parseAbiParameters, keccak256, concat, stringToBytes } from "viem";

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
 * Generates a standard W3C traceparent header (00-<32 hex traceId>-<16 hex spanId>-01)
 * using cryptographically secure random values (zero Math.random).
 */
export function generateW3CTraceparent(): { traceparent: string; traceId: string; spanId: string } {
  const randomHex = (bytes: number): string => {
    const arr = new Uint8Array(bytes);
    if (typeof globalThis !== "undefined" && globalThis.crypto && globalThis.crypto.getRandomValues) {
      globalThis.crypto.getRandomValues(arr);
    } else {
      // Node.js fallback
      const nodeCrypto = require("crypto");
      const buf = nodeCrypto.randomBytes(bytes);
      return buf.toString("hex");
    }
    return Array.from(arr).map(b => b.toString(16).padStart(2, "0")).join("");
  };
  const traceId = randomHex(16);
  const spanId = randomHex(8);
  const traceparent = `00-${traceId}-${spanId}-01`;
  return { traceparent, traceId, spanId };
}

/**
 * Generates an authentic HTTP 402 Payment Required challenge for agent clients
 * with optional W3C trace context propagation.
 */
export function createX402Challenge(req: {
  payTo: Address;
  amountWei: string;
  token: Address;
  serviceId: string;
  category: string;
  description: string;
  traceparent?: string;
  traceId?: string;
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

  const headers: {
    "WWW-Authenticate": string;
    "X-402-Payment-Required": string;
    [key: string]: string;
  } = {
    "WWW-Authenticate": `x402 realm="AgentGuard", challenge="${challengeBase64}"`,
    "X-402-Payment-Required": challengeBase64,
  };

  if (req.traceparent) {
    headers["traceparent"] = req.traceparent;
  }
  if (req.traceId) {
    headers["x-trace-id"] = req.traceId;
  }

  return {
    statusCode: 402,
    headers,
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

/**
 * Encodes an ephemeral session delegation certificate and worker payment into an x402-session header
 */
export function encodeX402SessionAuthorization(payload: SessionDelegationPayload): string {
  const serialized = JSON.stringify({
    certificate: {
      supervisor: payload.certificate.supervisor,
      workerSigner: payload.certificate.workerSigner,
      validAfter: payload.certificate.validAfter.toString(),
      validUntil: payload.certificate.validUntil.toString(),
      subBudgetCap: payload.certificate.subBudgetCap.toString(),
      capabilityMerkleRoot: payload.certificate.capabilityMerkleRoot,
      sessionNonce: payload.certificate.sessionNonce.toString(),
    },
    certificateSignature: payload.certificateSignature,
    payment: {
      merchant: payload.payment.merchant,
      amount: payload.payment.amount.toString(),
      token: payload.payment.token,
      category: payload.payment.category,
      deadline: payload.payment.deadline.toString(),
      nonce: payload.payment.nonce.toString(),
      extraCallData: payload.payment.extraCallData,
    },
    workerSignature: payload.workerSignature,
  });
  return `x402-session ${toBase64(serialized)}`;
}

/**
 * Parses and deserializes an x402-session authorization header
 */
export function parseX402SessionAuthorization(headerValue: string | undefined): SessionDelegationPayload | null {
  if (!headerValue || !headerValue.startsWith("x402-session ")) {
    return null;
  }

  try {
    const rawBase64 = headerValue.slice("x402-session ".length).trim();
    const jsonStr = fromBase64(rawBase64);
    const parsed = JSON.parse(jsonStr);

    return {
      certificate: {
        supervisor: parsed.certificate.supervisor,
        workerSigner: parsed.certificate.workerSigner,
        validAfter: BigInt(parsed.certificate.validAfter),
        validUntil: BigInt(parsed.certificate.validUntil),
        subBudgetCap: BigInt(parsed.certificate.subBudgetCap),
        capabilityMerkleRoot: parsed.certificate.capabilityMerkleRoot,
        sessionNonce: BigInt(parsed.certificate.sessionNonce),
      },
      certificateSignature: parsed.certificateSignature,
      payment: {
        merchant: parsed.payment.merchant,
        amount: BigInt(parsed.payment.amount),
        token: parsed.payment.token,
        category: parsed.payment.category,
        deadline: BigInt(parsed.payment.deadline),
        nonce: BigInt(parsed.payment.nonce),
        extraCallData: parsed.payment.extraCallData,
      },
      workerSignature: parsed.workerSignature,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies supervisor signature for a session certificate on Monad
 */
export async function verifySessionCertificate(
  cert: SessionCertificate,
  signature: `0x${string}`,
  chainId: number = MONAD_TESTNET_CHAIN_ID
): Promise<Address> {
  const encoded = encodeAbiParameters(
    parseAbiParameters("address, address, uint64, uint64, uint128, bytes32, uint256, uint256"),
    [
      cert.supervisor,
      cert.workerSigner,
      cert.validAfter,
      cert.validUntil,
      cert.subBudgetCap,
      cert.capabilityMerkleRoot,
      cert.sessionNonce,
      BigInt(chainId),
    ]
  );
  const messageHash = keccak256(encoded);
  const ethSignedMessageHash = keccak256(
    concat([stringToBytes("\x19Ethereum Signed Message:\n32"), messageHash])
  );
  return await recoverAddress({
    hash: ethSignedMessageHash,
    signature,
  });
}

/**
 * Verifies worker signature for a session delegation payment on Monad
 */
export async function verifySessionWorkerPayment(
  sessionNonce: bigint,
  payment: SessionDelegationPayment,
  signature: `0x${string}`,
  chainId: number = MONAD_TESTNET_CHAIN_ID
): Promise<Address> {
  const encoded = encodeAbiParameters(
    parseAbiParameters("uint256, address, uint256, address, bytes32, uint256, uint256, uint256"),
    [
      sessionNonce,
      payment.merchant,
      payment.amount,
      payment.token,
      payment.category,
      payment.deadline,
      payment.nonce,
      BigInt(chainId),
    ]
  );
  const messageHash = keccak256(encoded);
  const ethSignedMessageHash = keccak256(
    concat([stringToBytes("\x19Ethereum Signed Message:\n32"), messageHash])
  );
  return await recoverAddress({
    hash: ethSignedMessageHash,
    signature,
  });
}

/**
 * Encodes an Omnichain Spend Permit into an x402-omnichain authorization header
 */
export function encodeX402OmnichainAuthorization(payload: CrossChainPermitPayload): string {
  const serialized = JSON.stringify({
    permit: {
      agent: payload.permit.agent,
      targetChainId: payload.permit.targetChainId.toString(),
      targetMerchant: payload.permit.targetMerchant,
      targetToken: payload.permit.targetToken,
      amount: payload.permit.amount.toString(),
      validUntil: payload.permit.validUntil.toString(),
      monadPolicyBlock: payload.permit.monadPolicyBlock.toString(),
      monadPolicyNonce: payload.permit.monadPolicyNonce.toString(),
      capabilityHash: payload.permit.capabilityHash,
    },
    validatorSignature: payload.validatorSignature,
  });
  return `x402-omnichain ${toBase64(serialized)}`;
}

/**
 * Parses and deserializes an x402-omnichain authorization header
 */
export function parseX402OmnichainAuthorization(headerValue: string | undefined): CrossChainPermitPayload | null {
  if (!headerValue || !headerValue.startsWith("x402-omnichain ")) {
    return null;
  }

  try {
    const rawBase64 = headerValue.slice("x402-omnichain ".length).trim();
    const jsonStr = fromBase64(rawBase64);
    const parsed = JSON.parse(jsonStr);

    return {
      permit: {
        agent: parsed.permit.agent,
        targetChainId: BigInt(parsed.permit.targetChainId),
        targetMerchant: parsed.permit.targetMerchant,
        targetToken: parsed.permit.targetToken,
        amount: BigInt(parsed.permit.amount),
        validUntil: BigInt(parsed.permit.validUntil),
        monadPolicyBlock: BigInt(parsed.permit.monadPolicyBlock),
        monadPolicyNonce: BigInt(parsed.permit.monadPolicyNonce),
        capabilityHash: parsed.permit.capabilityHash,
      },
      validatorSignature: parsed.validatorSignature,
    };
  } catch {
    return null;
  }
}

/**
 * Verifies validator signature over a CrossChainSpendPermit
 */
export async function verifyCrossChainPermitSignature(
  permit: CrossChainSpendPermit,
  signature: `0x${string}`
): Promise<Address> {
  const encoded = encodeAbiParameters(
    parseAbiParameters("address, uint256, address, address, uint256, uint256, uint256, uint256, bytes32"),
    [
      permit.agent,
      permit.targetChainId,
      permit.targetMerchant,
      permit.targetToken,
      permit.amount,
      permit.validUntil,
      permit.monadPolicyBlock,
      permit.monadPolicyNonce,
      permit.capabilityHash,
    ]
  );
  const messageHash = keccak256(encoded);
  const ethSignedMessageHash = keccak256(
    concat([stringToBytes("\x19Ethereum Signed Message:\n32"), messageHash])
  );
  return await recoverAddress({
    hash: ethSignedMessageHash,
    signature,
  });
}

