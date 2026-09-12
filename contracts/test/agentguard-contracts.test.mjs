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
    this.policies = new Map(); // agent -> PackedPolicy
    this.states = new Map();   // agent -> PackedState
    this.whitelists = new Map(); // `${agent}:${merchant}` -> bool
    this.usedNonces = new Map(); // `${agent}:${nonce}` -> bool
  }

  setPolicy(agent, policy) {
    this.policies.set(agent.toLowerCase(), {
      maxPerTx: BigInt(policy.maxPerTx),
      maxPerWindow: BigInt(policy.maxPerWindow),
      windowSeconds: Number(policy.windowSeconds),
      maxVelocity: Number(policy.maxVelocity),
      killSwitch: Boolean(policy.killSwitch),
      whitelistEnabled: Boolean(policy.whitelistEnabled),
      isConfigured: true,
    });
  }

  setKillSwitch(agent, active) {
    const p = this.policies.get(agent.toLowerCase());
    if (p) {
      p.killSwitch = Boolean(active);
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

    // Kill switch or unconfigured
    if (!policy || !policy.isConfigured || policy.killSwitch) {
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
