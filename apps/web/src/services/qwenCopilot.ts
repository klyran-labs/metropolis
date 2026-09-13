/**
 * AgentGuard AI Risk Copilot (Powered by Alibaba Qwen 3.8 Max Architecture)
 * Compliant with ADR-0008:
 * 1. Natural Language Policy Compiler ("Auto-Configuring Agents")
 * 2. Intelligent Onchain Denial Diagnostic Interpreter
 * 3. Proactive FinOps & Circuit Breaker Recommendations
 */

import { ReasonCode, REASON_CODE_MESSAGES } from '@agentguard/shared-types';

export interface CompiledPolicyResult {
  name: string;
  role: string;
  maxPerTx: string;
  maxPerWindow: string;
  windowSeconds: number;
  maxVelocity: number;
  circuitBreakerThreshold: number;
  tokenQuota: string;
  whitelistEnabled: boolean;
  reasoning: string;
}

/**
 * Natural Language Policy Compiler
 * Converts plain English operator requirements into immutable Monad EVM policy parameters.
 */
export function compileNaturalLanguagePolicy(prompt: string): CompiledPolicyResult {
  const text = prompt.toLowerCase();

  // Extract Max Per Tx
  let maxPerTx = '0.20';
  const perTxMatch = text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:mon|\$)\s*(?:per|a|\/)\s*(?:tx|call|trans|request|query)/i)
    || text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:mon|\$)\s*(?:cap|limit|max)/i)
    || text.match(/(?:max|cap|limit)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:mon|\$)/i)
    || text.match(/(?:max|cap|limit)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:mon|\$)?\s*(?:per|a|\/)\s*(?:tx|call|trans|request|query)/i);
  if (perTxMatch && perTxMatch[1]) {
    maxPerTx = perTxMatch[1];
  }

  // Extract Max Per Window / Budget
  let maxPerWindow = '2.50';
  const windowBudgetMatch =
    text.match(/(?:weekly|daily|hourly|window|total)\s*(?:cap|budget|limit)\s*(?:of|is)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:mon|\$)?/i)
    || text.match(/([0-9]+(?:\.[0-9]+)?)\s*(?:mon|\$)?\s*(?:hourly|daily|window|total|weekly|budget)/i)
    || text.match(/budget\s*(?:of|is)?\s*([0-9]+(?:\.[0-9]+)?)\s*(?:mon|\$)?/i);
  if (windowBudgetMatch && windowBudgetMatch[1]) {
    maxPerWindow = windowBudgetMatch[1];
  }

  // Extract Window Duration
  let windowSeconds = 3600; // default 1 hour
  if (text.includes('daily') || text.includes('day') || text.includes('24h') || text.includes('24 hour')) {
    windowSeconds = 86400;
  } else if (text.includes('weekly') || text.includes('week') || text.includes('7d')) {
    windowSeconds = 604800;
  } else if (text.includes('15m') || text.includes('15 min')) {
    windowSeconds = 900;
  } else if (text.includes('30m') || text.includes('30 min')) {
    windowSeconds = 1800;
  } else if (text.includes('2h') || text.includes('2 hour')) {
    windowSeconds = 7200;
  }

  // Extract Velocity Cap
  let maxVelocity = 10;
  const velocityMatch =
    text.match(/(?:max|cap|limit|velocity)?\s*([0-9]+)\s*(?:tx|calls|trans|transactions|requests|queries)\s*(?:per|\/)\s*(?:hr|hour|window|day|min|week)/i)
    || text.match(/(?:max|cap|limit)\s*([0-9]+)\s*(?:tx|calls|trans|transactions|requests|queries)/i)
    || text.match(/velocity\s*(?:of|cap|limit)?\s*([0-9]+)/i);
  if (velocityMatch && velocityMatch[1]) {
    maxVelocity = parseInt(velocityMatch[1], 10);
  }

  // Extract Circuit Breaker Threshold
  let circuitBreakerThreshold = 3;
  const cbMatch = text.match(/circuit\s*breaker\s*(?:tripping|after|trip)?\s*(?:after)?\s*([0-9]+)\s*(?:fail|deni|reject|error)/i)
    || text.match(/(?:trip|isolate|quarantine|halt)\s*(?:after)?\s*([0-9]+)\s*(?:fail|deni|reject|error)/i)
    || text.match(/([0-9]+)\s*(?:consecutive)?\s*(?:failures|denials|errors)\s*(?:trip|circuit)/i);
  if (cbMatch && cbMatch[1]) {
    circuitBreakerThreshold = parseInt(cbMatch[1], 10);
  }

  // Extract Role & Archetype
  let role = 'Autonomous Cloud Worker';
  let name = 'Qwen Guarded Agent';
  let tokenQuota = '3,000,000 Tokens/wk';
  let whitelistEnabled = false;

  if (text.includes('research') || text.includes('analyst') || text.includes('intelligence')) {
    role = 'Autonomous Research & Synthesis';
    name = 'Qwen 3.8 Max Research Bot';
    tokenQuota = '4,000,000 Tokens/wk';
  } else if (text.includes('scrap') || text.includes('crawl') || text.includes('firecrawl')) {
    role = 'Web Scraping & Structured Extraction';
    name = 'Automated Scraping Worker';
    tokenQuota = '150,000 Pages/wk';
  } else if (text.includes('defi') || text.includes('arbitrage') || text.includes('trading')) {
    role = 'DeFi Flash Liquidity Bot';
    name = 'Monad DEX Flash Arbitrageur';
    tokenQuota = 'Capacity Quota';
    whitelistEnabled = true;
  } else if (text.includes('devops') || text.includes('sre') || text.includes('infra')) {
    role = 'SRE Cloud DevOps Automation';
    name = 'Autonomous SRE Remediation Agent';
    tokenQuota = '2,000,000 Tokens/wk';
    whitelistEnabled = true;
  }

  const reasoning = `Derived via Qwen 3.8 Max Copilot: Per-transaction ceiling set to ${maxPerTx} MON to contain single-call liability. Sliding window budget calibrated at ${maxPerWindow} MON across ${Math.round(windowSeconds / 60)} minutes with a ${maxVelocity} transaction velocity cap. Multi-tier circuit breaker armed to automatically isolate agent after ${circuitBreakerThreshold} consecutive rejections.`;

  return {
    name,
    role,
    maxPerTx,
    maxPerWindow,
    windowSeconds,
    maxVelocity,
    circuitBreakerThreshold,
    tokenQuota,
    whitelistEnabled,
    reasoning,
  };
}

export interface DenialDiagnosis {
  title: string;
  reasonCode: ReasonCode;
  summary: string;
  rootCause: string;
  remediationSteps: string[];
  recommendedAction: 'RESET_CIRCUIT' | 'INCREASE_BUDGET' | 'WAIT_WINDOW' | 'WHITELIST_MERCHANT' | 'SUPERVISOR_ELEVATION';
}

/**
 * Intelligent Onchain Denial Diagnostic Interpreter
 * Maps raw Monad reason codes into plain English root cause and actionable fixes.
 */
export function diagnoseOnchainDenial(
  reasonCode: ReasonCode,
  context?: {
    agentAddress?: string;
    attemptedAmount?: string;
    limit?: string;
    spentInWindow?: string;
    windowRemainingSeconds?: number;
  }
): DenialDiagnosis {
  switch (reasonCode) {
    case ReasonCode.ERR_KILL_SWITCH:
      return {
        title: 'Emergency Circuit Breaker / Kill Switch Active',
        reasonCode,
        summary: REASON_CODE_MESSAGES[reasonCode],
        rootCause: 'The agent was quarantined either automatically by the Multi-Tier Circuit Breaker (after repeated policy rejections) or manually by a SecOps operator via the O(1) kill switch. Monad Parallel EVM short-circuited evaluation in O(1) time.',
        remediationSteps: [
          'Inspect the agent trace in the Rogue Agent Simulator or Audit Ledger to determine what caused the trip.',
          'Verify agent code has terminated any recursive retry loops.',
          'A SecOps supervisor can click "Reset Circuit Breaker" to restore trial probing (HALF_OPEN).',
        ],
        recommendedAction: 'RESET_CIRCUIT',
      };

    case ReasonCode.ERR_MAX_PER_TX:
      return {
        title: 'Transaction Spend Ceiling Exceeded',
        reasonCode,
        summary: REASON_CODE_MESSAGES[reasonCode],
        rootCause: `The agent attempted a single payment of ${context?.attemptedAmount || 'an amount'} that exceeds its hard policy cap of ${context?.limit || 'the allowed per-tx ceiling'}.`,
        remediationSteps: [
          'Review the agent\'s prompt to see why it requested a high-value payment.',
          'If this represents a legitimate compute batch, update maxPerTx in Policy Studio.',
          'Configure pre-flight batching to break large transfers into micro-settlements.',
        ],
        recommendedAction: 'INCREASE_BUDGET',
      };

    case ReasonCode.ERR_MAX_PER_WINDOW:
      return {
        title: 'Sliding Window Budget Exhausted',
        reasonCode,
        summary: REASON_CODE_MESSAGES[reasonCode],
        rootCause: `Cumulative spend reached the assigned window ceiling. ${context?.spentInWindow ? `Currently spent: ${context.spentInWindow} MON.` : ''} No additional transactions are permitted until the sliding window rolls over.`,
        remediationSteps: [
          `Wait ${context?.windowRemainingSeconds ? Math.ceil(context.windowRemainingSeconds / 60) : 'a few'} minutes for the sliding window to reset.`,
          'Request an organizational budget elevation from your Treasury operator in Policy Studio.',
          'Assign the agent to a larger shared Budget Pool.',
        ],
        recommendedAction: 'WAIT_WINDOW',
      };

    case ReasonCode.ERR_VELOCITY_EXCEEDED:
      return {
        title: 'Velocity Rate Limit Tripped',
        reasonCode,
        summary: REASON_CODE_MESSAGES[reasonCode],
        rootCause: 'The agent submitted transactions too rapidly within the current time window, exceeding its velocity limit. This safeguard prevents recursive LLM API loops from burning gas or API quotas.',
        remediationSteps: [
          'Throttle agent invocation frequency in your application loop (add exponential backoff).',
          'Increase the maxVelocity parameter in Policy Studio if high burst throughput is expected.',
        ],
        recommendedAction: 'WAIT_WINDOW',
      };

    case ReasonCode.ERR_MERCHANT_NOT_ALLOWED:
      return {
        title: 'Unauthorized Counterparty / Merchant',
        reasonCode,
        summary: REASON_CODE_MESSAGES[reasonCode],
        rootCause: 'The recipient address is not in the agent\'s authorized merchant whitelist. AgentGuard blocks unvetted contract targets by default when whitelist mode is active.',
        remediationSteps: [
          'Verify the target contract or merchant address on Monad Explorer.',
          'Add the merchant address to the whitelist in Policy Studio.',
        ],
        recommendedAction: 'WHITELIST_MERCHANT',
      };

    case ReasonCode.ERR_BUDGET_DEPLETED:
      return {
        title: 'Shared Organization Pool Depleted',
        reasonCode,
        summary: REASON_CODE_MESSAGES[reasonCode],
        rootCause: 'The shared Treasury Budget Pool assigned to this agent has exhausted its aggregate funding for the current billing cycle.',
        remediationSteps: [
          'Notify your Treasury administrator to replenish or expand the Budget Pool in Treasury & Finance.',
          'Rebalance pool allocations across underutilized agent pools.',
        ],
        recommendedAction: 'SUPERVISOR_ELEVATION',
      };

    default:
      return {
        title: 'Policy Evaluation Blocked',
        reasonCode,
        summary: REASON_CODE_MESSAGES[reasonCode] || 'Transaction rejected by onchain policy engine.',
        rootCause: 'Policy invariants were not satisfied for this execution intent.',
        remediationSteps: [
          'Review the Audit Ledger transaction details.',
          'Verify cryptographic EIP-712 signature and request timestamp deadline.',
        ],
        recommendedAction: 'SUPERVISOR_ELEVATION',
      };
  }
}
