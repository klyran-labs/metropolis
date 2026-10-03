/**
 * Shared plain-language copy. Every screen should pull labels for these
 * recurring technical/onchain concepts from here instead of re-deriving
 * wording, so terminology stays consistent across tenant and admin screens.
 */

const REASON_CODE_LABELS: Record<string, string> = {
  ERR_NONE: "Approved",
  ERR_KILL_SWITCH: "Blocked — this agent is paused",
  ERR_KILL_SWITCH_ACTIVE: "Blocked — this agent is paused",
  ERR_MAX_PER_TX: "Blocked — over the per-transaction limit",
  ERR_MAX_PER_TX_EXCEEDED: "Blocked — over the per-transaction limit",
  ERR_EXCEEDS_MAX_TX: "Blocked — over the per-transaction limit",
  ERR_AMOUNT_ZERO: "Blocked — the amount was zero",
  ERR_MAX_PER_WINDOW: "Blocked — over the spending limit for this period",
  ERR_MAX_PER_WINDOW_EXCEEDED: "Blocked — over the spending limit for this period",
  ERR_VELOCITY_EXCEEDED: "Blocked — too many payments, too fast",
  ERR_MAX_VELOCITY_EXCEEDED: "Blocked — too many payments, too fast",
  ERR_MERCHANT_NOT_ALLOWED: "Blocked — merchant isn't on the approved list",
  ERR_MERCHANT_NOT_WHITELISTED: "Blocked — merchant isn't on the approved list",
  ERR_BUDGET_DEPLETED: "Blocked — shared budget is used up",
  ERR_BUDGET_POOL_EXHAUSTED: "Blocked — shared budget is used up",
  ERR_EXPIRED: "Blocked — this request expired",
  ERR_NONCE_REUSED: "Blocked — this request was already used",
  ERR_SIGNATURE_INVALID: "Blocked — the signature could not be verified",
};

/** Plain-language sentence for an onchain/policy reason code, falling back to a generic blocked message. */
export function reasonCodeLabel(code: string | null | undefined): string {
  if (!code) return "Approved";
  return REASON_CODE_LABELS[code] ?? (code === "ERR_NONE" ? "Approved" : "Blocked — didn't pass a spending rule");
}

/** Whether a reason code represents an approved/clear outcome. */
export function isApprovedReasonCode(code: string | null | undefined): boolean {
  return !code || code === "ERR_NONE";
}

/** Plain label for how an agent's wallet is held. */
export function walletSourceLabel(source: string | null | undefined): string {
  return source === "sovereign" ? "Secure wallet (hosted for you)" : "Connected wallet";
}

/** Plain label for whether the organization or the agent itself covers network fees. */
export function gasSponsorshipLabel(sponsored: boolean): string {
  return sponsored ? "AgentGuard covers network fees" : "Agent pays its own network fees";
}

/** Plain label for an agent's run state. */
export function agentStateLabel(status: string | null | undefined): string {
  return status === "active" ? "Active" : "Paused";
}

/** Plain label for a trust/reputation score in the 0-100 range. */
export function trustScoreLabel(score: number | null | undefined): string {
  if (score == null) return "Not yet scored";
  if (score >= 75) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}
