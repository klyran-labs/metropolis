/**
 * Plain-language labels for the recurring technical concepts (reason codes, wallet types, event
 * names, trust scores). The words live in the typed message catalog (`messages/en.ts`); this module
 * maps incoming codes and statuses to catalog keys and supplies fallbacks for values it has not seen.
 * Screens call these instead of re-deriving wording, so terminology stays consistent.
 */
import { t, type SimpleKey } from "./messages/index.ts";

const REASON_CODE_KEYS: Record<string, SimpleKey> = {
  ERR_NONE: "decision.approved",
  ERR_KILL_SWITCH: "decision.paused",
  ERR_KILL_SWITCH_ACTIVE: "decision.paused",
  ERR_MAX_PER_TX: "decision.overTransactionLimit",
  ERR_MAX_PER_TX_EXCEEDED: "decision.overTransactionLimit",
  ERR_EXCEEDS_MAX_TX: "decision.overTransactionLimit",
  ERR_AMOUNT_ZERO: "decision.amountZero",
  ERR_MAX_PER_WINDOW: "decision.overPeriodLimit",
  ERR_MAX_PER_WINDOW_EXCEEDED: "decision.overPeriodLimit",
  ERR_VELOCITY_EXCEEDED: "decision.tooFast",
  ERR_MAX_VELOCITY_EXCEEDED: "decision.tooFast",
  ERR_MERCHANT_NOT_ALLOWED: "decision.merchantNotApproved",
  ERR_MERCHANT_NOT_WHITELISTED: "decision.merchantNotApproved",
  ERR_BUDGET_DEPLETED: "decision.budgetUsedUp",
  ERR_BUDGET_POOL_EXHAUSTED: "decision.budgetUsedUp",
  ERR_EXPIRED: "decision.expired",
  ERR_NONCE_REUSED: "decision.alreadyUsed",
  ERR_SIGNATURE_INVALID: "decision.signatureInvalid",
};

/** Plain-language sentence for an onchain/policy reason code, falling back to a generic blocked message. */
export function reasonCodeLabel(code: string | null | undefined): string {
  if (!code) return t("decision.approved");
  const key = Object.prototype.hasOwnProperty.call(REASON_CODE_KEYS, code) ? REASON_CODE_KEYS[code] : undefined;
  return t(key ?? "decision.blockedFallback");
}

/** Whether a reason code represents an approved/clear outcome. */
export function isApprovedReasonCode(code: string | null | undefined): boolean {
  return !code || code === "ERR_NONE";
}

/** Plain label for how an agent's wallet is held. */
export function walletSourceLabel(source: string | null | undefined): string {
  return source === "sovereign" ? t("wallet.secure") : t("wallet.connected");
}

/** Plain label for whether the organization or the agent itself covers network fees. */
export function gasSponsorshipLabel(sponsored: boolean): string {
  return sponsored ? t("fees.covered") : t("fees.agentPays");
}

/** Plain label for an agent's run state. */
export function agentStateLabel(status: string | null | undefined): string {
  return status === "active" ? t("agent.active") : t("agent.paused");
}

/** Plain label for a trust/reputation score in the 0-100 range. */
export function trustScoreLabel(score: number | null | undefined): string {
  if (score == null) return t("trust.none");
  if (score >= 75) return t("trust.high");
  if (score >= 40) return t("trust.medium");
  return t("trust.low");
}

const EVENT_KEYS: Record<string, SimpleKey> = {
  payment_cleared: "event.paymentCleared",
  policy_evaluated: "event.ruleChecked",
  circuit_tripped: "event.agentPaused",
  circuit_reset: "event.agentResumed",
  policy_updated: "event.rulesChanged",
};

/** Plain label for an activity event name such as `payment_cleared`. */
export function eventLabel(eventName: string | null | undefined): string {
  if (!eventName) return t("event.fallback");
  const lower = eventName.toLowerCase();
  if (Object.prototype.hasOwnProperty.call(EVENT_KEYS, lower)) return t(EVENT_KEYS[lower]);
  const spaced = eventName.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
