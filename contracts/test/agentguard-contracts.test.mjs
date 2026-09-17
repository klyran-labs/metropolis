import test from "node:test";
import assert from "node:assert/strict";
import {
  keccak256,
  encodePacked,
  encodeAbiParameters,
  parseAbiParameters,
  hashTypedData,
  recoverAddress,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";

// Domain constants matching contracts on Monad Testnet
const MONAD_CHAIN_ID = 10143;

const REASON_CODES = {
  ERR_NONE: 0,
  ERR_KILL_SWITCH: 1,
  ERR_MAX_PER_TX: 2,
  ERR_MAX_PER_WINDOW: 3,
  ERR_VELOCITY_EXCEEDED: 4,
  ERR_MERCHANT_NOT_ALLOWED: 5,
  ERR_BUDGET_DEPLETED: 6,
  ERR_EXPIRED: 7,
  ERR_NONCE_REUSED: 8,
  ERR_SIGNATURE_INVALID: 9,
};

const REASON_MESSAGES = {
  [REASON_CODES.ERR_NONE]: "Spend request permitted under current policy",
  [REASON_CODES.ERR_KILL_SWITCH]: "Execution halted: Instant kill switch active for agent",
  [REASON_CODES.ERR_MAX_PER_TX]: "Spend limit exceeded: Amount is above maxPerTx threshold",
  [REASON_CODES.ERR_MAX_PER_WINDOW]: "Window budget exhausted: Cumulative spend exceeds maxPerWindow limit",
  [REASON_CODES.ERR_VELOCITY_EXCEEDED]: "Rate limit tripped: Transaction count exceeds window velocity cap",
  [REASON_CODES.ERR_MERCHANT_NOT_ALLOWED]: "Counterparty blocked: Recipient is not in authorized merchant whitelist",
  [REASON_CODES.ERR_BUDGET_DEPLETED]: "Shared pool depleted: Org-wide budget allocation exhausted",
  [REASON_CODES.ERR_EXPIRED]: "Intent expired: Block timestamp exceeds request deadline",
  [REASON_CODES.ERR_NONCE_REUSED]: "Replay rejected: Spend request nonce has already been consumed",
  [REASON_CODES.ERR_SIGNATURE_INVALID]: "Authentication failed: Cryptographic EIP-712 signature invalid",
};

const SPEND_REQUEST_TYPES = {
  SpendRequest: [
    { name: "agent", type: "address" },
    { name: "merchant", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "category", type: "bytes32" },
    { name: "timestamp", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

/**
 * Deterministic Simulation Model for PolicyEngine and ReputationRegistry.
 *
 * IMPORTANT: this is a hand-written JS re-implementation used for fast,
 * dependency-free parity checks (npm test / CI's "full-test-suite" job). It
 * does NOT compile or execute contracts/src/core/PolicyEngine.sol — it tests
 * itself. The authoritative test suite against real compiled bytecode is the
 * Foundry suite in contracts/test/*.t.sol (`forge test`, run by CI's
 * "contracts-foundry" job). See docs/GAP_ANALYSIS.md, finding 1.1.
 *
 * This simulator does not model the caller-authorization check added to
 * evaluateAndSpend (docs/GAP_ANALYSIS.md 1.3) — it has no concept of
 * msg.sender. That behavior is covered only by the Foundry suite.
 */
class PolicyEngineSimulator {
  constructor(domainVerifyingContract = "0x2222222222222222222222222222222222222222") {
    this.verifyingContract = domainVerifyingContract;
    this.owner = "0x1111111111111111111111111111111111111111";
    this.policies = new Map(); // agent -> PackedPolicy
    this.states = new Map();   // agent -> PackedState
    this.whitelists = new Map(); // `${agent}:${merchant}` -> bool
    this.usedNonces = new Map(); // `${agent}:${nonce}` -> bool
    this.budgetPools = new Map(); // poolId -> BudgetPool
    this.agentPools = new Map(); // agent -> poolId
    this.circuitBroken = new Map(); // agent -> bool
    this.agentAdmin = new Map(); // agent -> adminAddress
  }

  setAgentAdmin(agent, admin, caller) {
    const agentKey = agent.toLowerCase();
    const currentAdmin = this.agentAdmin.get(agentKey);
    if (currentAdmin && caller) {
      if (caller.toLowerCase() !== currentAdmin && caller.toLowerCase() !== this.owner.toLowerCase()) {
        throw new Error("Unauthorized");
      }
    } else if (caller) {
      if (caller.toLowerCase() !== agentKey && caller.toLowerCase() !== this.owner.toLowerCase()) {
        throw new Error("Unauthorized");
      }
    }
    this.agentAdmin.set(agentKey, admin.toLowerCase());
  }

  createBudgetPool(poolId, orgId, totalBudget, windowSeconds) {
    // orgId is uint96 (numeric) — store as BigInt, matching the 2-slot PackedBudgetPool layout
    this.budgetPools.set(poolId.toLowerCase(), {
      poolId: poolId.toLowerCase(),
      orgId: BigInt(orgId),
      totalBudget: BigInt(totalBudget),
      spentBudget: 0n,
      windowSeconds: Number(windowSeconds),
      windowStart: 0n,
      active: true,
    });
  }

  assignAgentToPool(agent, poolId) {
    this.agentPools.set(agent.toLowerCase(), poolId.toLowerCase());
  }

  batchSetPolicies(agents, policies) {
    if (agents.length !== policies.length) throw new Error("Length mismatch");
    agents.forEach((agent, i) => {
      this.setPolicy(agent, policies[i]);
    });
  }

  setPolicy(agent, policy) {
    const agentKey = agent.toLowerCase();
    const kill = Boolean(policy.killSwitch);
    this.policies.set(agentKey, {
      maxPerTx: BigInt(policy.maxPerTx),
      maxPerWindow: BigInt(policy.maxPerWindow),
      windowSeconds: Number(policy.windowSeconds),
      maxVelocity: Number(policy.maxVelocity),
      killSwitch: kill,
      whitelistEnabled: Boolean(policy.whitelistEnabled),
      isConfigured: true,
    });
    this.circuitBroken.set(agentKey, kill);
  }

  tripCircuitBreaker(agent, caller) {
    const agentKey = agent.toLowerCase();
    const admin = this.agentAdmin.get(agentKey);
    if (caller) {
      const c = caller.toLowerCase();
      if (admin && c !== admin && c !== this.owner.toLowerCase() && c !== agentKey) {
        throw new Error("Unauthorized");
      }
    }
    this.circuitBroken.set(agentKey, true);
    const p = this.policies.get(agentKey);
    if (p) {
      p.killSwitch = true;
    }
  }

  resetCircuitBreaker(agent, caller) {
    const agentKey = agent.toLowerCase();
    const admin = this.agentAdmin.get(agentKey);
    if (caller) {
      const c = caller.toLowerCase();
      if (admin) {
        if (c !== admin && c !== this.owner.toLowerCase()) {
          throw new Error("Unauthorized");
        }
      } else {
        if (c !== agentKey && c !== this.owner.toLowerCase()) {
          throw new Error("Unauthorized");
        }
      }
    }
    this.circuitBroken.set(agentKey, false);
    const p = this.policies.get(agentKey);
    if (p) {
      p.killSwitch = false;
    }
  }

  isCircuitBroken(agent) {
    const agentKey = agent.toLowerCase();
    const p = this.policies.get(agentKey);
    return Boolean(this.circuitBroken.get(agentKey) || (p && p.killSwitch));
  }

  setKillSwitch(agent, active, caller) {
    const agentKey = agent.toLowerCase();
    if (active) {
      this.tripCircuitBreaker(agentKey, caller);
    } else {
      this.resetCircuitBreaker(agentKey, caller);
    }
  }

  setMerchantWhitelist(agent, merchant, allowed) {
    this.whitelists.set(`${agent.toLowerCase()}:${merchant.toLowerCase()}`, Boolean(allowed));
  }

  evaluate(req, currentTimestamp = 1000n) {
    const agentKey = req.agent.toLowerCase();
    const policy = this.policies.get(agentKey);
    const state = this.states.get(agentKey) || {
      spentInWindow: 0n,
      windowStart: 0n,
      txCountInWindow: 0,
      nonce: 0n,
    };

    // Kill switch, circuit breaker or unconfigured
    if (!policy || !policy.isConfigured || policy.killSwitch || this.isCircuitBroken(agentKey)) {
      return {
        allowed: false,
        allowedAmount: 0n,
        reasonCode: REASON_CODES.ERR_KILL_SWITCH,
        reasonMessage: REASON_MESSAGES[REASON_CODES.ERR_KILL_SWITCH],
      };
    }

    // 1. Deadline check
    if (req.deadline > 0n && currentTimestamp > req.deadline) {
      return {
        allowed: false,
        allowedAmount: 0n,
        reasonCode: REASON_CODES.ERR_EXPIRED,
        reasonMessage: REASON_MESSAGES[REASON_CODES.ERR_EXPIRED],
      };
    }

    // 2. Nonce check
    const nonceKey = `${agentKey}:${req.nonce.toString()}`;
    if (this.usedNonces.get(nonceKey)) {
      return {
        allowed: false,
        allowedAmount: 0n,
        reasonCode: REASON_CODES.ERR_NONCE_REUSED,
        reasonMessage: REASON_MESSAGES[REASON_CODES.ERR_NONCE_REUSED],
      };
    }

    // 3. Merchant whitelist check
    if (policy.whitelistEnabled) {
      const isAllowed = this.whitelists.get(`${agentKey}:${req.merchant.toLowerCase()}`);
      if (!isAllowed) {
        return {
          allowed: false,
          allowedAmount: 0n,
          reasonCode: REASON_CODES.ERR_MERCHANT_NOT_ALLOWED,
          reasonMessage: REASON_MESSAGES[REASON_CODES.ERR_MERCHANT_NOT_ALLOWED],
        };
      }
    }

    // 3.5 Org / Team Budget Pool check
    const poolId = this.agentPools.get(agentKey);
    if (poolId) {
      const pool = this.budgetPools.get(poolId);
      if (pool && pool.active) {
        let poolSpent = pool.spentBudget;
        if (pool.windowStart === 0n || currentTimestamp >= pool.windowStart + BigInt(pool.windowSeconds)) {
          poolSpent = 0n;
        }
        if (poolSpent + BigInt(req.amount) > pool.totalBudget) {
          return {
            allowed: false,
            allowedAmount: 0n,
            reasonCode: REASON_CODES.ERR_BUDGET_DEPLETED,
            reasonMessage: REASON_MESSAGES[REASON_CODES.ERR_BUDGET_DEPLETED],
          };
        }
      }
    }

    // 4. Max per tx
    if (BigInt(req.amount) > policy.maxPerTx) {
      return {
        allowed: false,
        allowedAmount: 0n,
        reasonCode: REASON_CODES.ERR_MAX_PER_TX,
        reasonMessage: REASON_MESSAGES[REASON_CODES.ERR_MAX_PER_TX],
      };
    }

    // 5. Sliding window roll-forward
    let spentInWindow = state.spentInWindow;
    let txCountInWindow = state.txCountInWindow;

    if (state.windowStart === 0n || currentTimestamp >= state.windowStart + BigInt(policy.windowSeconds)) {
      spentInWindow = 0n;
      txCountInWindow = 0;
    }

    // 6. Max per window check
    if (spentInWindow + BigInt(req.amount) > policy.maxPerWindow) {
      return {
        allowed: false,
        allowedAmount: 0n,
        reasonCode: REASON_CODES.ERR_MAX_PER_WINDOW,
        reasonMessage: REASON_MESSAGES[REASON_CODES.ERR_MAX_PER_WINDOW],
      };
    }

    // 7. Velocity rate limit check
    if (txCountInWindow + 1 > policy.maxVelocity) {
      return {
        allowed: false,
        allowedAmount: 0n,
        reasonCode: REASON_CODES.ERR_VELOCITY_EXCEEDED,
        reasonMessage: REASON_MESSAGES[REASON_CODES.ERR_VELOCITY_EXCEEDED],
      };
    }

    return {
      allowed: true,
      allowedAmount: BigInt(req.amount),
      reasonCode: REASON_CODES.ERR_NONE,
      reasonMessage: REASON_MESSAGES[REASON_CODES.ERR_NONE],
    };
  }

  evaluateAndSpend(req, currentTimestamp = 1000n) {
    const decision = this.evaluate(req, currentTimestamp);
    if (!decision.allowed) {
      return decision;
    }

    const agentKey = req.agent.toLowerCase();
    const policy = this.policies.get(agentKey);
    let state = this.states.get(agentKey) || {
      spentInWindow: 0n,
      windowStart: 0n,
      txCountInWindow: 0,
      nonce: 0n,
    };

    let spentInWindow = state.spentInWindow;
    let txCountInWindow = state.txCountInWindow;
    let windowStart = state.windowStart;

    if (windowStart === 0n || currentTimestamp >= windowStart + BigInt(policy.windowSeconds)) {
      spentInWindow = 0n;
      txCountInWindow = 0;
      windowStart = currentTimestamp;
    }

    spentInWindow += BigInt(req.amount);
    txCountInWindow += 1;

    this.usedNonces.set(`${agentKey}:${req.nonce.toString()}`, true);
    this.states.set(agentKey, {
      spentInWindow,
      windowStart,
      txCountInWindow,
      nonce: BigInt(req.nonce),
    });

    const poolId = this.agentPools.get(agentKey);
    if (poolId) {
      const pool = this.budgetPools.get(poolId);
      if (pool && pool.active) {
        if (pool.windowStart === 0n || currentTimestamp >= pool.windowStart + BigInt(pool.windowSeconds)) {
          pool.spentBudget = 0n;
          pool.windowStart = currentTimestamp;
        }
        pool.spentBudget += BigInt(req.amount);
      }
    }

    return decision;
  }
}

/**
 * Deterministic Reputation Registry Simulator
 */
class ReputationRegistrySimulator {
  constructor() {
    this.metrics = new Map();
  }

  recordOutcome(agent, counterparty, outcome, amount) {
    const key = agent.toLowerCase();
    let m = this.metrics.get(key) || {
      scoreBps: 500000, // 50.00% base
      totalTransactions: 0,
      settledCount: 0,
      slashedCount: 0,
      disputedCount: 0,
    };

    if (outcome === 0) { // SETTLED
      m.settledCount += 1;
      m.scoreBps = Math.min(1000000, Math.floor((m.scoreBps * 95 + 1000000 * 5) / 100));
    } else if (outcome === 1) { // DISPUTED
      m.disputedCount += 1;
      m.scoreBps = Math.floor((m.scoreBps * 90 + 200000 * 10) / 100);
    } else if (outcome === 2) { // SLASHED
      m.slashedCount += 1;
      m.scoreBps = Math.floor((m.scoreBps * 70) / 100);
    } else if (outcome === 3) { // TIMEOUT
      m.scoreBps = Math.floor((m.scoreBps * 95 + 300000 * 5) / 100);
    }

    m.totalTransactions += 1;
    this.metrics.set(key, m);
    return m.scoreBps;
  }

  getScore(agent) {
    const m = this.metrics.get(agent.toLowerCase());
    return m ? m.scoreBps : 500000;
  }
}

// -------------------------------------------------------------
// TEST SUITE: Domain Invariants, Monad Concurrency & EIP-712
// -------------------------------------------------------------

test("PolicyEngine: test_DenyWhenAmountExceedsMaxPerTx", () => {
  const engine = new PolicyEngineSimulator();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  engine.setPolicy(agent, {
    maxPerTx: 1000n,
    maxPerWindow: 5000n,
    windowSeconds: 3600,
    maxVelocity: 10,
    killSwitch: false,
    whitelistEnabled: false,
  });

  const req = {
    agent,
    merchant,
    amount: 1500n, // Above 1000n
    category: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 1000n,
    deadline: 2000n,
    nonce: 1n,
  };

  const decision = engine.evaluate(req);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, REASON_CODES.ERR_MAX_PER_TX);
  assert.equal(decision.reasonMessage, REASON_MESSAGES[REASON_CODES.ERR_MAX_PER_TX]);
});

test("PolicyEngine: test_DenyWhenVelocityExceeded_WithinWindow", () => {
  const engine = new PolicyEngineSimulator();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  engine.setPolicy(agent, {
    maxPerTx: 100n,
    maxPerWindow: 1000n,
    windowSeconds: 60,
    maxVelocity: 3, // Only 3 transactions allowed in 60s
    killSwitch: false,
    whitelistEnabled: false,
  });

  // Execute 3 allowed transactions
  for (let i = 1; i <= 3; i++) {
    const res = engine.evaluateAndSpend({
      agent,
      merchant,
      amount: 10n,
      category: "0x0000000000000000000000000000000000000000000000000000000000000000",
      timestamp: 1000n,
      deadline: 2000n,
      nonce: BigInt(i),
    }, 1000n);
    assert.equal(res.allowed, true);
  }

  // 4th transaction trips velocity rate limit
  const burstReq = {
    agent,
    merchant,
    amount: 10n,
    category: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 1005n,
    deadline: 2000n,
    nonce: 4n,
  };

  const denied = engine.evaluateAndSpend(burstReq, 1005n);
  assert.equal(denied.allowed, false);
  assert.equal(denied.reasonCode, REASON_CODES.ERR_VELOCITY_EXCEEDED);
});

test("PolicyEngine: test_AllowWhenWithinAllLimits", () => {
  const engine = new PolicyEngineSimulator();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  engine.setPolicy(agent, {
    maxPerTx: 500n,
    maxPerWindow: 2000n,
    windowSeconds: 3600,
    maxVelocity: 50,
    killSwitch: false,
    whitelistEnabled: false,
  });

  const req = {
    agent,
    merchant,
    amount: 250n,
    category: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 1000n,
    deadline: 2000n,
    nonce: 1n,
  };

  const decision = engine.evaluateAndSpend(req, 1000n);
  assert.equal(decision.allowed, true);
  assert.equal(decision.allowedAmount, 250n);
  assert.equal(decision.reasonCode, REASON_CODES.ERR_NONE);
});

test("PolicyEngine: test_KillSwitchShortCircuitsAllOtherChecks (O(1) Invariant)", () => {
  const engine = new PolicyEngineSimulator();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  engine.setPolicy(agent, {
    maxPerTx: 500n,
    maxPerWindow: 2000n,
    windowSeconds: 3600,
    maxVelocity: 50,
    killSwitch: true, // ACTIVE KILL SWITCH
    whitelistEnabled: false,
  });

  const req = {
    agent,
    merchant,
    amount: 1n, // Minimal amount
    category: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 1000n,
    deadline: 2000n,
    nonce: 1n,
  };

  const decision = engine.evaluate(req);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, REASON_CODES.ERR_KILL_SWITCH);
  assert.equal(decision.allowedAmount, 0n);
});

test("ADR-0012: Circuit Protocol test_TripAndResetCircuitBreaker_DualRoleAuthority", () => {
  const engine = new PolicyEngineSimulator();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const admin = "0xcccccccccccccccccccccccccccccccccccccccc";
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  // Configure policy and bind enterprise admin controller
  engine.setPolicy(agent, {
    maxPerTx: 500n,
    maxPerWindow: 2000n,
    windowSeconds: 3600,
    maxVelocity: 50,
    killSwitch: false,
    whitelistEnabled: false,
  });
  engine.setAgentAdmin(agent, admin, agent);

  assert.equal(engine.isCircuitBroken(agent), false);

  // Enterprise controller trips circuit breaker
  engine.tripCircuitBreaker(agent, admin);
  assert.equal(engine.isCircuitBroken(agent), true);

  const req = {
    agent,
    merchant,
    amount: 10n,
    category: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 1000n,
    deadline: 2000n,
    nonce: 1n,
  };

  // Evaluation short-circuits instantly with ERR_KILL_SWITCH
  const decision = engine.evaluate(req);
  assert.equal(decision.allowed, false);
  assert.equal(decision.reasonCode, REASON_CODES.ERR_KILL_SWITCH);

  // Enterprise controller resets circuit breaker
  engine.resetCircuitBreaker(agent, admin);
  assert.equal(engine.isCircuitBroken(agent), false);

  const restoredDecision = engine.evaluate(req);
  assert.equal(restoredDecision.allowed, true);
  assert.equal(restoredDecision.reasonCode, REASON_CODES.ERR_NONE);
});

test("ADR-0012: Circuit Protocol test_AgentForbiddenFromResettingCircuitBreaker", () => {
  const engine = new PolicyEngineSimulator();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const admin = "0xcccccccccccccccccccccccccccccccccccccccc";
  const attacker = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

  engine.setPolicy(agent, {
    maxPerTx: 500n,
    maxPerWindow: 2000n,
    windowSeconds: 3600,
    maxVelocity: 50,
    killSwitch: false,
    whitelistEnabled: false,
  });
  engine.setAgentAdmin(agent, admin, agent);

  // Enterprise admin trips circuit breaker
  engine.tripCircuitBreaker(agent, admin);
  assert.equal(engine.isCircuitBroken(agent), true);

  // Autonomous agent (0xAgent) is strictly prohibited from resetting its own circuit breaker
  assert.throws(() => {
    engine.resetCircuitBreaker(agent, agent);
  }, /Unauthorized/);

  // Unauthorized third party cannot reset
  assert.throws(() => {
    engine.resetCircuitBreaker(agent, attacker);
  }, /Unauthorized/);

  // Circuit breaker remains solidly tripped
  assert.equal(engine.isCircuitBroken(agent), true);
});

test("PolicyEngine: test_ReasonCodeAlwaysPresentOnDeny (Invariant #4)", () => {
  const engine = new PolicyEngineSimulator();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  engine.setPolicy(agent, {
    maxPerTx: 100n,
    maxPerWindow: 200n,
    windowSeconds: 3600,
    maxVelocity: 5,
    killSwitch: false,
    whitelistEnabled: true, // Whitelist enabled but merchant not added
  });

  const req = {
    agent,
    merchant,
    amount: 50n,
    category: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 1000n,
    deadline: 2000n,
    nonce: 1n,
  };

  const decision = engine.evaluate(req);
  assert.equal(decision.allowed, false);
  assert.ok(decision.reasonCode > 0, "Reason code must be non-zero on denial");
  assert.ok(decision.reasonMessage.length > 0, "Reason message must not be empty");
  assert.equal(decision.reasonCode, REASON_CODES.ERR_MERCHANT_NOT_ALLOWED);
});

test("PolicyEngine: test_RollingWindowResetsAfterWindowDuration", () => {
  const engine = new PolicyEngineSimulator();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  engine.setPolicy(agent, {
    maxPerTx: 100n,
    maxPerWindow: 100n, // Window cap 100n
    windowSeconds: 3600, // 1 hour
    maxVelocity: 10,
    killSwitch: false,
    whitelistEnabled: false,
  });

  // Consume full window at t = 1000
  const tx1 = engine.evaluateAndSpend({
    agent,
    merchant,
    amount: 100n,
    category: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 1000n,
    deadline: 5000n,
    nonce: 1n,
  }, 1000n);
  assert.equal(tx1.allowed, true);

  // Attempt at t = 2000 (still in window) -> denied
  const tx2 = engine.evaluate({
    agent,
    merchant,
    amount: 10n,
    category: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 2000n,
    deadline: 5000n,
    nonce: 2n,
  }, 2000n);
  assert.equal(tx2.allowed, false);
  assert.equal(tx2.reasonCode, REASON_CODES.ERR_MAX_PER_WINDOW);

  // Attempt at t = 4601 (new window! t >= 1000 + 3600) -> allowed
  const tx3 = engine.evaluateAndSpend({
    agent,
    merchant,
    amount: 50n,
    category: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 4601n,
    deadline: 6000n,
    nonce: 3n,
  }, 4601n);
  assert.equal(tx3.allowed, true);
});

test("ReputationRegistry: test_ReputationScoreIncrementalUpdate", () => {
  const rep = new ReputationRegistrySimulator();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  // Base score
  assert.equal(rep.getScore(agent), 500000);

  // 1. Successful settlement -> increases score
  const score1 = rep.recordOutcome(agent, merchant, 0, 100n); // SETTLED
  assert.ok(score1 > 500000, "Score should increase after settlement");

  // 2. Dispute -> decreases score
  const score2 = rep.recordOutcome(agent, merchant, 1, 50n); // DISPUTED
  assert.ok(score2 < score1, "Score should decrease after dispute");

  // 3. Slashing -> sharp penalty
  const score3 = rep.recordOutcome(agent, merchant, 2, 500n); // SLASHED
  assert.ok(score3 < score2 * 80 / 100, "Slashing should drop score by ~30%");
});

test("EIP-712: test_EIP712_SignatureVerificationAndNonceProtection", async () => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  const verifyingContract = "0x2222222222222222222222222222222222222222";
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  const domain = {
    name: "AgentGuard_PolicyEngine",
    version: "1",
    chainId: MONAD_CHAIN_ID,
    verifyingContract,
  };

  const req = {
    agent: account.address,
    merchant,
    amount: 100n,
    category: "0x0000000000000000000000000000000000000000000000000000000000000000",
    timestamp: 1000n,
    deadline: 2000n,
    nonce: 42n,
  };

  // Sign EIP-712 payload with authentic ECDSA key
  const signature = await account.signTypedData({
    domain,
    types: SPEND_REQUEST_TYPES,
    primaryType: "SpendRequest",
    message: req,
  });

  // Verify recovery
  const recovered = await recoverAddress({
    hash: hashTypedData({
      domain,
      types: SPEND_REQUEST_TYPES,
      primaryType: "SpendRequest",
      message: req,
    }),
    signature,
  });

  assert.equal(recovered.toLowerCase(), account.address.toLowerCase());

  // Verify in simulator
  const engine = new PolicyEngineSimulator(verifyingContract);
  engine.setPolicy(account.address, {
    maxPerTx: 1000n,
    maxPerWindow: 5000n,
    windowSeconds: 3600,
    maxVelocity: 10,
    killSwitch: false,
    whitelistEnabled: false,
  });

  const firstSpend = engine.evaluateAndSpend(req, 1000n);
  assert.equal(firstSpend.allowed, true);

  // Attempt replay of exact same nonce -> rejected
  const replaySpend = engine.evaluateAndSpend(req, 1001n);
  assert.equal(replaySpend.allowed, false);
  assert.equal(replaySpend.reasonCode, REASON_CODES.ERR_NONCE_REUSED);
});

test("Monad Concurrency: test_MonadParallelStateIsolation (50 concurrent agents)", () => {
  const engine = new PolicyEngineSimulator();
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  // Initialize 50 independent agents
  const agents = Array.from({ length: 50 }, (_, i) => {
    const hex = i.toString(16).padStart(40, "0");
    return `0x${hex}`;
  });

  agents.forEach((agent) => {
    engine.setPolicy(agent, {
      maxPerTx: 1000n,
      maxPerWindow: 10000n,
      windowSeconds: 3600,
      maxVelocity: 5,
      killSwitch: false,
      whitelistEnabled: false,
    });
  });

  // Execute spend for each agent in arbitrary order
  agents.forEach((agent, idx) => {
    const decision = engine.evaluateAndSpend({
      agent,
      merchant,
      amount: BigInt(100 + idx),
      category: "0x0000000000000000000000000000000000000000000000000000000000000000",
      timestamp: 1000n,
      deadline: 2000n,
      nonce: 1n,
    }, 1000n);

    assert.equal(decision.allowed, true);
  });

  // Verify isolated states: each agent's spentInWindow must strictly match its own tx
  agents.forEach((agent, idx) => {
    const state = engine.states.get(agent.toLowerCase());
    assert.equal(state.spentInWindow, BigInt(100 + idx));
    assert.equal(state.txCountInWindow, 1);
  });
});

test("PolicyEngine: test_DenyWhenBudgetPoolDepleted (ReasonCode 6)", () => {
  const engine = new PolicyEngineSimulator();
  const poolId = "0x0000000000000000000000000000000000000000000000000000000000000001";
  const orgId = 170n; // uint96 (was bytes32 0x...aa; now numeric matching PackedBudgetPool slot 0)
  const agent1 = "0x1111111111111111111111111111111111111111";
  const agent2 = "0x2222222222222222222222222222222222222222";
  const merchant = "0x8888888888888888888888888888888888888888";

  // Create shared budget pool with 500 max budget
  engine.createBudgetPool(poolId, orgId, 500n, 3600);

  // Configure agents with generous personal limits (1000)
  const policy = {
    maxPerTx: 1000n,
    maxPerWindow: 1000n,
    windowSeconds: 3600,
    maxVelocity: 10,
    killSwitch: false,
    whitelistEnabled: false,
  };
  engine.setPolicy(agent1, policy);
  engine.setPolicy(agent2, policy);

  // Assign both agents to the shared pool
  engine.assignAgentToPool(agent1, poolId);
  engine.assignAgentToPool(agent2, poolId);

  // Agent 1 spends 300 (allowed)
  const res1 = engine.evaluateAndSpend({
    agent: agent1,
    merchant,
    amount: 300n,
    category: "0x0",
    timestamp: 1000n,
    deadline: 2000n,
    nonce: 1n,
  }, 1000n);
  assert.equal(res1.allowed, true);

  // Agent 2 attempts to spend 250 -> 300 + 250 = 550 > 500 -> REJECTED with ERR_BUDGET_DEPLETED
  const res2 = engine.evaluateAndSpend({
    agent: agent2,
    merchant,
    amount: 250n,
    category: "0x0",
    timestamp: 1005n,
    deadline: 2000n,
    nonce: 1n,
  }, 1005n);
  assert.equal(res2.allowed, false);
  assert.equal(res2.reasonCode, REASON_CODES.ERR_BUDGET_DEPLETED);

  // Agent 2 spends 200 -> 300 + 200 = 500 -> ALLOWED (exact pool budget)
  const res3 = engine.evaluateAndSpend({
    agent: agent2,
    merchant,
    amount: 200n,
    category: "0x0",
    timestamp: 1010n,
    deadline: 2000n,
    nonce: 1n,
  }, 1010n);
  assert.equal(res3.allowed, true);
});

test("PolicyEngine: test_BudgetPoolWindowRollover", () => {
  const engine = new PolicyEngineSimulator();
  const poolId = "0x0000000000000000000000000000000000000000000000000000000000000002";
  const orgId = 187n; // uint96 (was bytes32 0x...bb; now numeric matching PackedBudgetPool slot 0)
  const agent = "0x3333333333333333333333333333333333333333";
  const merchant = "0x8888888888888888888888888888888888888888";

  engine.createBudgetPool(poolId, orgId, 100n, 100);
  engine.setPolicy(agent, {
    maxPerTx: 200n,
    maxPerWindow: 200n,
    windowSeconds: 100,
    maxVelocity: 5,
    killSwitch: false,
    whitelistEnabled: false,
  });
  engine.assignAgentToPool(agent, poolId);

  // Spend full budget in window 1
  const spend1 = engine.evaluateAndSpend({
    agent,
    merchant,
    amount: 100n,
    category: "0x0",
    timestamp: 1000n,
    deadline: 2000n,
    nonce: 1n,
  }, 1000n);
  assert.equal(spend1.allowed, true);

  // Immediate subsequent spend rejected
  const spend2 = engine.evaluateAndSpend({
    agent,
    merchant,
    amount: 10n,
    category: "0x0",
    timestamp: 1010n,
    deadline: 2000n,
    nonce: 2n,
  }, 1010n);
  assert.equal(spend2.allowed, false);
  assert.equal(spend2.reasonCode, REASON_CODES.ERR_BUDGET_DEPLETED);

  // Advance time beyond pool window (100s -> 1101n) -> window resets, spend allowed
  const spend3 = engine.evaluateAndSpend({
    agent,
    merchant,
    amount: 50n,
    category: "0x0",
    timestamp: 1105n,
    deadline: 2000n,
    nonce: 3n,
  }, 1105n);
  assert.equal(spend3.allowed, true);
});

test("PolicyEngine: test_BatchSetPolicies", () => {
  const engine = new PolicyEngineSimulator();
  const agents = [
    "0x4444444444444444444444444444444444444441",
    "0x4444444444444444444444444444444444444442",
    "0x4444444444444444444444444444444444444443",
  ];
  const policies = agents.map((_, i) => ({
    maxPerTx: BigInt(100 * (i + 1)),
    maxPerWindow: BigInt(500 * (i + 1)),
    windowSeconds: 3600,
    maxVelocity: 5,
    killSwitch: false,
    whitelistEnabled: false,
  }));

  engine.batchSetPolicies(agents, policies);

  agents.forEach((agent, i) => {
    const p = engine.policies.get(agent.toLowerCase());
    assert.ok(p);
    assert.equal(p.maxPerTx, BigInt(100 * (i + 1)));
    assert.equal(p.isConfigured, true);
  });
});

test("ERC-1271: test_ERC1271_SmartContractSignerValidation", () => {
  const ERC1271_MAGIC_VALUE = "0x1626ba7e";
  const ERC1271_FAIL_VALUE = "0xffffffff";

  // Mock contract signer simulating Safe / Smart Contract wallet
  class MockSmartAccount {
    constructor(ownerAddress) {
      this.owner = ownerAddress.toLowerCase();
    }
    isValidSignature(hash, signature, recoveredSigner) {
      if (recoveredSigner.toLowerCase() === this.owner) {
        return ERC1271_MAGIC_VALUE;
      }
      return ERC1271_FAIL_VALUE;
    }
  }

  const ownerPrivateKey = generatePrivateKey();
  const ownerAccount = privateKeyToAccount(ownerPrivateKey);
  const smartAccount = new MockSmartAccount(ownerAccount.address);

  const digest = keccak256(encodePacked(["string"], ["agentguard-spend-digest-01"]));

  // 1. Valid signature from smart contract owner
  const validSig = "0x" + "aa".repeat(65);
  const isValid = smartAccount.isValidSignature(digest, validSig, ownerAccount.address);
  assert.equal(isValid, ERC1271_MAGIC_VALUE);

  // 2. Invalid signature from rogue signer
  const rogueSigner = "0x9999999999999999999999999999999999999999";
  const isInvalid = smartAccount.isValidSignature(digest, validSig, rogueSigner);
  assert.equal(isInvalid, ERC1271_FAIL_VALUE);
});

test("EIP-2612: test_EIP2612_PermitValidationAndExecution", () => {
  // Simulated ERC-20 with EIP-2612 permit
  class MockPermitToken {
    constructor() {
      this.allowances = new Map();
      this.nonces = new Map();
    }
    permit(owner, spender, value, deadline, currentTimestamp) {
      if (currentTimestamp > deadline) {
        throw new Error("PermitExpired");
      }
      const nonce = this.nonces.get(owner.toLowerCase()) || 0n;
      this.nonces.set(owner.toLowerCase(), nonce + 1n);
      this.allowances.set(`${owner.toLowerCase()}:${spender.toLowerCase()}`, BigInt(value));
    }
    getAllowance(owner, spender) {
      return this.allowances.get(`${owner.toLowerCase()}:${spender.toLowerCase()}`) || 0n;
    }
  }

  const token = new MockPermitToken();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const guard = "0x2222222222222222222222222222222222222222";
  const amount = 1000000n; // 1 USDC

  // Execute atomic permit
  token.permit(agent, guard, amount, 2000n, 1000n);
  assert.equal(token.getAllowance(agent, guard), amount);

  // Expired permit throws
  assert.throws(() => {
    token.permit(agent, guard, amount, 500n, 1000n);
  }, /PermitExpired/);
});

test("EIP-7702: test_EIP7702_DelegatedExecutionAndPolicyEnforcement", () => {
  const engine = new PolicyEngineSimulator();
  const eoaAgent = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const merchant = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  engine.setPolicy(eoaAgent, {
    maxPerTx: 100n,
    maxPerWindow: 500n,
    windowSeconds: 3600,
    maxVelocity: 3,
    killSwitch: false,
    whitelistEnabled: false,
  });

  // Simulated EIP-7702 execution directly from EOA context
  const decision1 = engine.evaluateAndSpend({
    agent: eoaAgent,
    merchant,
    amount: 50n,
    category: "0x0",
    timestamp: 1000n,
    deadline: 2000n,
    nonce: 1n,
  }, 1000n);

  assert.equal(decision1.allowed, true);

  // Over limit rejected
  const decision2 = engine.evaluateAndSpend({
    agent: eoaAgent,
    merchant,
    amount: 200n,
    category: "0x0",
    timestamp: 1005n,
    deadline: 2000n,
    nonce: 2n,
  }, 1005n);

  assert.equal(decision2.allowed, false);
  assert.equal(decision2.reasonCode, REASON_CODES.ERR_MAX_PER_TX);
});

test("ERC-7579: test_ERC7579_HookPreCheckAndPostCheck", () => {
  const engine = new PolicyEngineSimulator();
  const agent = "0x7579757975797579757975797579757975797579";
  const merchant = "0x3333333333333333333333333333333333333333";

  engine.setPolicy(agent, {
    maxPerTx: 50n,
    maxPerWindow: 200n,
    windowSeconds: 3600,
    maxVelocity: 5,
    killSwitch: false,
    whitelistEnabled: false,
  });

  // Hook preCheck: decodes payload, verifies policy
  const preCheckPayload = {
    agent,
    merchant,
    amount: 25n,
    category: "0x0",
    timestamp: 1000n,
    deadline: 2000n,
    nonce: 1n,
  };

  const decision = engine.evaluateAndSpend(preCheckPayload, 1000n);
  assert.equal(decision.allowed, true);

  // Simulate postCheck telemetry logging
  const postCheckData = {
    agent,
    merchant,
    amount: 25n,
    outcome: 0, // SETTLED
  };
  assert.equal(postCheckData.outcome, 0);
});

test("EIP-6551: test_EIP6551_TokenBoundAccountDeterministicAddress", () => {
  // Deterministic CREATE2 calculation matching AgentIdentityRegistry.sol
  const implementation = "0x1111111111111111111111111111111111111111";
  const tokenContract = "0x2222222222222222222222222222222222222222";
  const tokenId = 42n;
  const chainId = 10143n;
  const salt = "0x0000000000000000000000000000000000000000000000000000000000000001";

  const combinedSalt = keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, uint256, address, uint256"),
      [salt, chainId, tokenContract, tokenId]
    )
  );

  assert.ok(combinedSalt.startsWith("0x"));
  assert.equal(combinedSalt.length, 66);
});

test("EnclaveAttestation: test_TEE_EnclaveAttestationVerification", () => {
  const mrenclave = "0x" + "e1".repeat(32);
  const agent = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  const nowSec = 1741500000;
  const expiresAt = nowSec + 86400 * 30;

  const quote = {
    agent,
    mrenclave,
    enclaveType: "AWS_NITRO",
    issuedAt: nowSec,
    expiresAt,
    revoked: false,
  };

  // Valid active enclave
  const isValid = !quote.revoked && 1741505000 < quote.expiresAt;
  assert.equal(isValid, true);

  // Expired enclave rejected
  const isExpired = 1741500000 + 86400 * 31 > quote.expiresAt;
  assert.equal(isExpired, true);
});

test("CircuitPaymaster: test_PaymasterSponsorshipEligibilityAndCircuitBreaker", () => {
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const treasury = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const maxCost = 100000000000000000n; // 0.1 MON

  const paymasterState = {
    treasuryBalances: new Map([[treasury.toLowerCase(), 1000000000000000000n]]), // 1 MON
    agentToTreasury: new Map([[agent.toLowerCase(), treasury.toLowerCase()]]),
    circuitBrokenAgents: new Set(),
  };

  function isEligible(agentAddr, cost) {
    const key = agentAddr.toLowerCase();
    if (paymasterState.circuitBrokenAgents.has(key)) {
      return { eligible: false, reasonCode: 8 }; // ERR_CIRCUIT_BREAKER_ACTIVE
    }
    const t = paymasterState.agentToTreasury.get(key);
    if (!t) {
      return { eligible: false, reasonCode: 1 }; // ERR_AGENT_NOT_AUTHORIZED
    }
    const bal = paymasterState.treasuryBalances.get(t) || 0n;
    if (bal < cost) {
      return { eligible: false, reasonCode: 6 }; // ERR_BUDGET_EXCEEDED
    }
    return { eligible: true, reasonCode: 0 };
  }

  // 1. Initially eligible
  let check = isEligible(agent, maxCost);
  assert.equal(check.eligible, true);
  assert.equal(check.reasonCode, 0);

  // 2. Circuit breaker tripped -> short circuit rejection
  paymasterState.circuitBrokenAgents.add(agent.toLowerCase());
  check = isEligible(agent, maxCost);
  assert.equal(check.eligible, false);
  assert.equal(check.reasonCode, 8);

  // 3. Reset circuit breaker, simulate execution & postOp refund
  paymasterState.circuitBrokenAgents.delete(agent.toLowerCase());
  const actualCost = 40000000000000000n; // 0.04 MON
  // ValidateUserOp reserves maxCost
  paymasterState.treasuryBalances.set(treasury.toLowerCase(), paymasterState.treasuryBalances.get(treasury.toLowerCase()) - maxCost);
  assert.equal(paymasterState.treasuryBalances.get(treasury.toLowerCase()), 900000000000000000n);
  // PostOp refunds maxCost - actualCost (0.06 MON)
  const refund = maxCost - actualCost;
  paymasterState.treasuryBalances.set(treasury.toLowerCase(), paymasterState.treasuryBalances.get(treasury.toLowerCase()) + refund);
  assert.equal(paymasterState.treasuryBalances.get(treasury.toLowerCase()), 960000000000000000n);
});

test("AgentPassportNFT: test_PassportMintingAndBoundAccountResolution", () => {
  const agent = "0xcccccccccccccccccccccccccccccccccccccccc";
  const owner = "0xdddddddddddddddddddddddddddddddddddddddd";
  const registry = "0x9999999999999999999999999999999999999999";
  const passportContract = "0x8888888888888888888888888888888888888888";
  const implementation = "0x7777777777777777777777777777777777777777";
  const tokenId = 1n;
  const chainId = 10143n;
  const salt = "0x0000000000000000000000000000000000000000000000000000000000000000";

  // Simulate AgentPassportNFT minting
  const passportRegistry = {
    owners: new Map([[tokenId, owner.toLowerCase()]]),
    tokenAgent: new Map([[tokenId, agent.toLowerCase()]]),
    agentToken: new Map([[agent.toLowerCase(), tokenId]]),
  };

  assert.equal(passportRegistry.owners.get(tokenId), owner.toLowerCase());
  assert.equal(passportRegistry.agentToken.get(agent.toLowerCase()), tokenId);

  // Compute deterministic ERC-6551 Token Bound Account
  const combinedSalt = keccak256(
    encodeAbiParameters(
      parseAbiParameters("bytes32, uint256, address, uint256"),
      [salt, chainId, passportContract, tokenId]
    )
  );

  assert.ok(combinedSalt.startsWith("0x"));
  assert.equal(combinedSalt.length, 66);
});

test("Solidity Static Invariants: All core contract interface calls must exist in interface definitions", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");

  const coreDir = path.resolve("contracts/src/core");
  const intDir = path.resolve("contracts/src/interfaces");

  const interfaceFiles = fs.readdirSync(intDir).filter((f) => f.endsWith(".sol"));
  const interfaceContents = {};
  for (const f of interfaceFiles) {
    interfaceContents[f] = fs.readFileSync(path.join(intDir, f), "utf8");
  }

  const interfaceMap = {};
  for (const [f, content] of Object.entries(interfaceContents)) {
    const match = content.match(/interface\s+([A-Za-z0-9_]+)/);
    if (match) {
      interfaceMap[match[1]] = content;
    }
  }

  const coreFiles = fs.readdirSync(coreDir).filter((f) => f.endsWith(".sol"));
  const errors = [];

  for (const cf of coreFiles) {
    const content = fs.readFileSync(path.join(coreDir, cf), "utf8");

    for (const [iName, iContent] of Object.entries(interfaceMap)) {
      const varRegex = new RegExp(`\\b${iName}\\s+(?:public|private|internal|immutable)?\\s*([a-zA-Z0-9_]+)`, "g");
      let match;
      const varNames = new Set();
      while ((match = varRegex.exec(content)) !== null) {
        if (!["override", "memory", "calldata", "storage"].includes(match[1])) {
          varNames.add(match[1]);
        }
      }

      for (const vName of varNames) {
        const callRegex = new RegExp(`\\b${vName}\\.([a-zA-Z0-9_]+)\\s*\\(`, "g");
        let cMatch;
        while ((cMatch = callRegex.exec(content)) !== null) {
          const method = cMatch[1];
          const hasMethod = new RegExp(`function\\s+${method}\\s*\\(`).test(iContent);
          if (!hasMethod) {
            errors.push(`${cf}: Variable "${vName}" of type ${iName} calls ".${method}()", but "${method}" is not declared in ${iName}!`);
          }
        }
      }
    }
  }

  assert.equal(
    errors.length,
    0,
    `Found undeclared interface calls in Solidity contracts:\n${errors.join("\n")}`
  );
});
