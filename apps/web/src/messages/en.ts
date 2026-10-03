// The English message catalog: every recurring sentence a person reads that is not tied to one
// screen's layout. Keys are typed, and `{name}` placeholders are checked at compile time by `t()`,
// so a missing or misspelled parameter is a type error rather than a blank in the UI.
//
// Wording rules (enforced by a unit test): plain language only. No protocol or contract names, no
// "kill switch", no standards numbers, no infrastructure terms.
export const en = {
  // Spending decisions
  "decision.approved": "Approved",
  "decision.blockedFallback": "Blocked — didn't pass a spending rule",
  "decision.paused": "Blocked — this agent is paused",
  "decision.overTransactionLimit": "Blocked — over the per-transaction limit",
  "decision.amountZero": "Blocked — the amount was zero",
  "decision.overPeriodLimit": "Blocked — over the spending limit for this period",
  "decision.tooFast": "Blocked — too many payments, too fast",
  "decision.merchantNotApproved": "Blocked — merchant isn't on the approved list",
  "decision.budgetUsedUp": "Blocked — shared budget is used up",
  "decision.expired": "Blocked — this request expired",
  "decision.alreadyUsed": "Blocked — this request was already used",
  "decision.signatureInvalid": "Blocked — the signature could not be verified",

  // Wallets and fees
  "wallet.secure": "Secure wallet (hosted for you)",
  "wallet.connected": "Connected wallet",
  "fees.covered": "AgentGuard covers network fees",
  "fees.agentPays": "Agent pays its own network fees",

  // Agent state and trust
  "agent.active": "Active",
  "agent.paused": "Paused",
  "trust.none": "Not yet scored",
  "trust.high": "High",
  "trust.medium": "Medium",
  "trust.low": "Low",

  // Activity events
  "event.fallback": "Activity",
  "event.paymentCleared": "Payment approved",
  "event.ruleChecked": "Rule check",
  "event.agentPaused": "Agent paused",
  "event.agentResumed": "Agent resumed",
  "event.rulesChanged": "Rules changed",

  // "Test before you publish" explanations
  "dryRun.paused.description": "This agent is paused, so it can't spend right now.",
  "dryRun.paused.remedy": "Turn off the pause switch above before testing a payment.",
  "dryRun.amountZero.description": "Enter an amount greater than zero.",
  "dryRun.amountZero.remedy": "Specify a positive USDC amount.",
  "dryRun.overTransactionLimit.description": "{amount} is over the per-transaction limit ({limit}).",
  "dryRun.overTransactionLimit.remedy": "Lower the amount, or raise the per-transaction limit above.",
  "dryRun.overPeriodLimit.description": "This would go over the spending limit for this period ({limit}).",
  "dryRun.overPeriodLimit.remedy": "Lower the amount, or raise the period limit above.",
  "dryRun.merchantNotApproved.description": "This merchant isn't on the approved list.",
  "dryRun.merchantNotApproved.remedy":
    "Add this merchant in Merchant Directory, or turn off the approved-merchants requirement.",
  "dryRun.allowed.description": "This payment is within limits: up to {limit} per period, to an approved merchant.",
  "dryRun.allowed.remedy": "This would go through right away.",
} as const;

export type MessageKey = keyof typeof en;
export type Catalog = Record<MessageKey, string>;
