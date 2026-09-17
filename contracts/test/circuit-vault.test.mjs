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

const MONAD_CHAIN_ID = 10143;

const CIRCUIT_VAULT_REASON_CODES = {
  ERR_NONE: 0,
  ERR_CIRCUIT_BREAKER_ACTIVE: 1,
  ERR_INSUFFICIENT_VAULT_BALANCE: 2,
  ERR_BUCKET_CLOSED: 3,
  ERR_BUCKET_EXPIRED: 4,
  ERR_ALLOCATION_EXCEEDED: 5,
  ERR_SPEND_NOT_MONOTONIC: 6,
  ERR_CHALLENGE_ACTIVE: 7,
  ERR_CHALLENGE_NOT_EXPIRED: 8,
  ERR_NO_ACTIVE_CHALLENGE: 9,
  ERR_VOUCHER_SIGNATURE_INVALID: 10,
  ERR_UNAUTHORIZED: 11,
  ERR_COOLDOWN_ACTIVE: 12,
  ERR_ZERO_AMOUNT: 13,
};

/**
 * Deterministic In-Memory Model for CircuitVault.sol (ADR-0013)
 * Models Double-Partitioned Storage Slots, Split-State Dispute Challenges,
 * Monotonic Spend Floors, and Sharded Relayer Compensation.
 */
class CircuitVaultSimulator {
  constructor(verifyingContract = "0x3333333333333333333333333333333333333333") {
    this.verifyingContract = verifyingContract;
    this.vaultBalances = new Map(); // agent -> bigint
    this.allocations = new Map();   // `${agent}:${provider}:${epoch}` -> Bucket
    this.agentChallenges = new Map(); // `${agent}:${sessionId}` -> Challenge
    this.merchantSettlements = new Map(); // `${provider}:${sessionId}` -> bigint
    this.relayerCredits = new Map(); // `${relayer}:${shardId}` -> bigint
    this.withdrawalRequests = new Map(); // agent -> WithdrawalRequest
    this.circuitBrokenAgents = new Set();
    this.agentAdmins = new Map();
    this.currentBlockNumber = 1000n;
    this.currentTimestamp = 10000n;
  }

  setCircuitBroken(agent, broken) {
    if (broken) {
      this.circuitBrokenAgents.add(agent.toLowerCase());
    } else {
      this.circuitBrokenAgents.delete(agent.toLowerCase());
    }
  }

  setAgentAdmin(agent, admin) {
    this.agentAdmins.set(agent.toLowerCase(), admin.toLowerCase());
  }

  deposit(agent, amount) {
    const amt = BigInt(amount);
    if (amt <= 0n) throw new Error("ERR_ZERO_AMOUNT");
    const key = agent.toLowerCase();
    const current = this.vaultBalances.get(key) || 0n;
    this.vaultBalances.set(key, current + amt);
    return amt;
  }

  getVaultBalance(agent) {
    return this.vaultBalances.get(agent.toLowerCase()) || 0n;
  }

  requestWithdrawal(agent, amount, caller) {
    const amt = BigInt(amount);
    const key = agent.toLowerCase();
    const bal = this.getVaultBalance(agent);
    if (amt <= 0n) throw new Error("ERR_ZERO_AMOUNT");
    if (bal < amt) throw new Error("ERR_INSUFFICIENT_VAULT_BALANCE");

    const existing = this.withdrawalRequests.get(key);
    if (existing && existing.active) throw new Error("ERR_COOLDOWN_ACTIVE");

    this.withdrawalRequests.set(key, {
      amount: amt,
      unlockTimestamp: this.currentTimestamp + 1800n,
      active: true,
    });
  }

  finalizeWithdrawal(agent, recipient, caller) {
    const key = agent.toLowerCase();
    const req = this.withdrawalRequests.get(key);
    if (!req || !req.active) throw new Error("ERR_NO_ACTIVE_CHALLENGE");
    if (this.currentTimestamp < req.unlockTimestamp) throw new Error("ERR_COOLDOWN_ACTIVE");

    const bal = this.getVaultBalance(agent);
    if (bal < req.amount) throw new Error("ERR_INSUFFICIENT_VAULT_BALANCE");

    this.vaultBalances.set(key, bal - req.amount);
    req.active = false;
    return req.amount;
  }

  allocateEpochBucket(agent, provider, epoch, amount, duration, caller) {
    const agentKey = agent.toLowerCase();
    if (this.circuitBrokenAgents.has(agentKey)) {
      throw new Error("ERR_CIRCUIT_BREAKER_ACTIVE");
    }
    const amt = BigInt(amount);
    if (amt <= 0n) throw new Error("ERR_ZERO_AMOUNT");

    const bal = this.getVaultBalance(agent);
    if (bal < amt) throw new Error("ERR_INSUFFICIENT_VAULT_BALANCE");

    const bucketKey = `${agentKey}:${provider.toLowerCase()}:${epoch}`;
    let bucket = this.allocations.get(bucketKey);
    if (bucket && bucket.isClosed) throw new Error("ERR_BUCKET_CLOSED");

    this.vaultBalances.set(agentKey, bal - amt);

    if (!bucket) {
      bucket = {
        allocatedCap: amt,
        cumulativeSettled: 0n,
        epochStart: Number(this.currentTimestamp),
        epochDuration: Number(duration),
        isClosed: false,
      };
    } else {
      bucket.allocatedCap += amt;
    }
    this.allocations.set(bucketKey, bucket);
  }

  getEpochBucket(agent, provider, epoch) {
    const bucketKey = `${agent.toLowerCase()}:${provider.toLowerCase()}:${epoch}`;
    return this.allocations.get(bucketKey) || {
      allocatedCap: 0n,
      cumulativeSettled: 0n,
      epochStart: 0,
      epochDuration: 0,
      isClosed: false,
    };
  }

  settleVoucherDelta(agent, provider, epoch, cumulativeSpent, signatureValid = true) {
    const agentKey = agent.toLowerCase();
    if (this.circuitBrokenAgents.has(agentKey)) throw new Error("ERR_CIRCUIT_BREAKER_ACTIVE");

    const bucketKey = `${agentKey}:${provider.toLowerCase()}:${epoch}`;
    const bucket = this.allocations.get(bucketKey);
    if (!bucket || bucket.isClosed) throw new Error("ERR_BUCKET_CLOSED");

    const spent = BigInt(cumulativeSpent);
    if (spent > bucket.allocatedCap) throw new Error("ERR_ALLOCATION_EXCEEDED");
    if (spent <= bucket.cumulativeSettled) throw new Error("ERR_SPEND_NOT_MONOTONIC");
    if (!signatureValid) throw new Error("ERR_VOUCHER_SIGNATURE_INVALID");

    const delta = spent - bucket.cumulativeSettled;
    bucket.cumulativeSettled = spent;
    return delta;
  }

  terminalClose(agent, provider, epoch, cumulativeSpent, signatureValid = true) {
    const agentKey = agent.toLowerCase();
    const bucketKey = `${agentKey}:${provider.toLowerCase()}:${epoch}`;
    const bucket = this.allocations.get(bucketKey);
    if (!bucket || bucket.isClosed) throw new Error("ERR_BUCKET_CLOSED");

    let delta = 0n;
    const spent = BigInt(cumulativeSpent);
    if (spent > 0n && spent > bucket.cumulativeSettled) {
      if (spent > bucket.allocatedCap) throw new Error("ERR_ALLOCATION_EXCEEDED");
      if (!signatureValid) throw new Error("ERR_VOUCHER_SIGNATURE_INVALID");
      delta = spent - bucket.cumulativeSettled;
      bucket.cumulativeSettled = spent;
    }

    bucket.isClosed = true;
    const refundedFloat = bucket.allocatedCap - bucket.cumulativeSettled;
    if (refundedFloat > 0n) {
      const bal = this.getVaultBalance(agent);
      this.vaultBalances.set(agentKey, bal + refundedFloat);
    }
    return { delta, refundedFloat };
  }

  requestUnilateralClose(agent, provider, epoch, sessionId, claimedSpent) {
    const agentKey = agent.toLowerCase();
    const sessionKey = `${agentKey}:${sessionId.toLowerCase()}`;
    const existing = this.agentChallenges.get(sessionKey);
    if (existing && existing.active) throw new Error("ERR_CHALLENGE_ACTIVE");

    this.agentChallenges.set(sessionKey, {
      challengeBlock: this.currentBlockNumber,
      proposedSettlement: BigInt(claimedSpent),
      active: true,
    });
  }

  submitMerchantVoucher(provider, sessionId, voucherAmount) {
    const provKey = `${provider.toLowerCase()}:${sessionId.toLowerCase()}`;
    const amt = BigInt(voucherAmount);
    const existing = this.merchantSettlements.get(provKey) || 0n;
    if (amt <= existing) throw new Error("ERR_SPEND_NOT_MONOTONIC");
    this.merchantSettlements.set(provKey, amt);
  }

  finalizeUnilateralClose(agent, provider, epoch, sessionId) {
    const agentKey = agent.toLowerCase();
    const sessionKey = `${agentKey}:${sessionId.toLowerCase()}`;
    const ch = this.agentChallenges.get(sessionKey);
    if (!ch || !ch.active) throw new Error("ERR_NO_ACTIVE_CHALLENGE");
    if (this.currentBlockNumber < ch.challengeBlock + 200n) {
      throw new Error("ERR_CHALLENGE_NOT_EXPIRED");
    }

    const bucketKey = `${agentKey}:${provider.toLowerCase()}:${epoch}`;
    const bucket = this.allocations.get(bucketKey);
    if (!bucket || bucket.isClosed) throw new Error("ERR_BUCKET_CLOSED");

    const provKey = `${provider.toLowerCase()}:${sessionId.toLowerCase()}`;
    const merchantClaim = this.merchantSettlements.get(provKey) || 0n;
    let finalSpent = merchantClaim > ch.proposedSettlement ? merchantClaim : ch.proposedSettlement;
    if (finalSpent > bucket.allocatedCap) finalSpent = bucket.allocatedCap;

    let providerPayout = 0n;
    if (finalSpent > bucket.cumulativeSettled) {
      providerPayout = finalSpent - bucket.cumulativeSettled;
      bucket.cumulativeSettled = finalSpent;
    }

    bucket.isClosed = true;
    ch.active = false;

    const agentRefund = bucket.allocatedCap - bucket.cumulativeSettled;
    if (agentRefund > 0n) {
      const bal = this.getVaultBalance(agent);
      this.vaultBalances.set(agentKey, bal + agentRefund);
    }
    return { providerPayout, agentRefund };
  }

  rolloverEpochBucket(agent, provider, oldEpoch, oldCumulativeSpent, oldSignature, newEpoch, newAmount, newDuration) {
    let delta = 0n;
    let refundedFloat = 0n;
    const agentKey = agent.toLowerCase();
    const oldBucketKey = `${agentKey}:${provider.toLowerCase()}:${oldEpoch}`;
    const oldBucket = this.allocations.get(oldBucketKey);

    if (oldBucket && !oldBucket.isClosed) {
      const spent = BigInt(oldCumulativeSpent);
      if (spent > oldBucket.allocatedCap) throw new Error("ERR_ALLOCATION_EXCEEDED");
      if (spent > oldBucket.cumulativeSettled) {
        delta = spent - oldBucket.cumulativeSettled;
        oldBucket.cumulativeSettled = spent;
      }
      oldBucket.isClosed = true;
      refundedFloat = oldBucket.allocatedCap - oldBucket.cumulativeSettled;
      if (refundedFloat > 0n) {
        const bal = this.getVaultBalance(agent);
        this.vaultBalances.set(agentKey, bal + refundedFloat);
      }
    }

    this.allocateEpochBucket(agent, provider, newEpoch, newAmount, newDuration);
    return { delta, refundedFloat };
  }

  creditRelayerFee(relayer, shardId, amount) {
    const key = `${relayer.toLowerCase()}:${shardId}`;
    const curr = this.relayerCredits.get(key) || 0n;
    this.relayerCredits.set(key, curr + BigInt(amount));
  }

  claimRelayerCredits(relayer, shardIds) {
    let total = 0n;
    for (const s of shardIds) {
      const key = `${relayer.toLowerCase()}:${s}`;
      const c = this.relayerCredits.get(key) || 0n;
      if (c > 0n) {
        total += c;
        this.relayerCredits.set(key, 0n);
      }
    }
    return total;
  }
}

// ═══════════════════════════════════════════════════════════════════
// ADR-0013 DETERMINISTIC TEST SUITE
// ═══════════════════════════════════════════════════════════════════

test("CircuitVault: test_Deposit_BalanceDeltaTracking", () => {
  const vault = new CircuitVaultSimulator();
  const agent = "0x1111111111111111111111111111111111111111";

  const deposited = vault.deposit(agent, 5000n);
  assert.equal(deposited, 5000n);
  assert.equal(vault.getVaultBalance(agent), 5000n);
});

test("CircuitVault: test_DoublePartitioned_Allocation_ByDifferentAgents", () => {
  const vault = new CircuitVaultSimulator();
  const agent1 = "0x1111111111111111111111111111111111111111";
  const agent2 = "0x2222222222222222222222222222222222222222";
  const provider = "0x9999999999999999999999999999999999999999";

  vault.deposit(agent1, 10000n);
  vault.deposit(agent2, 5000n);

  // Both agents allocate credit to the exact same provider in the same epoch
  vault.allocateEpochBucket(agent1, provider, 1n, 6000n, 3600);
  vault.allocateEpochBucket(agent2, provider, 1n, 3000n, 3600);

  const b1 = vault.getEpochBucket(agent1, provider, 1n);
  const b2 = vault.getEpochBucket(agent2, provider, 1n);

  // Assert disjoint storage slots maintained with zero cross-talk
  assert.equal(b1.allocatedCap, 6000n);
  assert.equal(b2.allocatedCap, 3000n);
  assert.equal(vault.getVaultBalance(agent1), 4000n);
  assert.equal(vault.getVaultBalance(agent2), 2000n);
});

test("CircuitVault: test_SettleVoucherDelta_MonotonicSpendFloors", () => {
  const vault = new CircuitVaultSimulator();
  const agent = "0x1111111111111111111111111111111111111111";
  const provider = "0x9999999999999999999999999999999999999999";

  vault.deposit(agent, 10000n);
  vault.allocateEpochBucket(agent, provider, 1n, 4000n, 3600);

  // First incremental settlement: cumulative spent 1200
  const delta1 = vault.settleVoucherDelta(agent, provider, 1n, 1200n);
  assert.equal(delta1, 1200n);

  // Second incremental settlement: cumulative spent 2500 (delta = 1300)
  const delta2 = vault.settleVoucherDelta(agent, provider, 1n, 2500n);
  assert.equal(delta2, 1300n);

  // Attempting non-monotonic spend (2200 <= 2500) must revert
  assert.throws(() => {
    vault.settleVoucherDelta(agent, provider, 1n, 2200n);
  }, /ERR_SPEND_NOT_MONOTONIC/);

  // Exceeding allocation cap (4500 > 4000) must revert
  assert.throws(() => {
    vault.settleVoucherDelta(agent, provider, 1n, 4500n);
  }, /ERR_ALLOCATION_EXCEEDED/);
});

test("CircuitVault: test_TerminalClose_RefundsUnspentFloat", () => {
  const vault = new CircuitVaultSimulator();
  const agent = "0x1111111111111111111111111111111111111111";
  const provider = "0x9999999999999999999999999999999999999999";

  vault.deposit(agent, 10000n);
  vault.allocateEpochBucket(agent, provider, 1n, 4000n, 3600);
  assert.equal(vault.getVaultBalance(agent), 6000n);

  // Terminal close after spending 1500n -> 2500n refunded back to treasury
  const { delta, refundedFloat } = vault.terminalClose(agent, provider, 1n, 1500n);
  assert.equal(delta, 1500n);
  assert.equal(refundedFloat, 2500n);
  assert.equal(vault.getVaultBalance(agent), 8500n); // 6000 + 2500

  const bucket = vault.getEpochBucket(agent, provider, 1n);
  assert.equal(bucket.isClosed, true);

  // Further settlement on closed bucket is blocked
  assert.throws(() => {
    vault.settleVoucherDelta(agent, provider, 1n, 2000n);
  }, /ERR_BUCKET_CLOSED/);
});

test("CircuitVault: test_SplitStateDispute_ChallengeAndResolution", () => {
  const vault = new CircuitVaultSimulator();
  const agent = "0x1111111111111111111111111111111111111111";
  const provider = "0x9999999999999999999999999999999999999999";
  const sessionId = "0xabcdef0000000000000000000000000000000000000000000000000000000001";

  vault.deposit(agent, 10000n);
  vault.allocateEpochBucket(agent, provider, 1n, 5000n, 3600);

  // Agent requests unilateral close claiming 1000 spent
  vault.requestUnilateralClose(agent, provider, 1n, sessionId, 1000n);

  // Merchant submits highest voucher for 1800 spent
  vault.submitMerchantVoucher(provider, sessionId, 1800n);

  // Premature finalization blocked before 200 blocks
  assert.throws(() => {
    vault.finalizeUnilateralClose(agent, provider, 1n, sessionId);
  }, /ERR_CHALLENGE_NOT_EXPIRED/);

  // Advance clock past 200 blocks
  vault.currentBlockNumber += 205n;

  // Finalize: merchant gets max(1000, 1800) = 1800, agent refunded 3200 float
  const { providerPayout, agentRefund } = vault.finalizeUnilateralClose(agent, provider, 1n, sessionId);
  assert.equal(providerPayout, 1800n);
  assert.equal(agentRefund, 3200n);
  assert.equal(vault.getVaultBalance(agent), 8200n); // 5000 unallocated + 3200 refund
});

test("CircuitVault: test_CircuitBreakerShortCircuitsAllocationAndSettlement", () => {
  const vault = new CircuitVaultSimulator();
  const agent = "0x1111111111111111111111111111111111111111";
  const provider = "0x9999999999999999999999999999999999999999";

  vault.deposit(agent, 10000n);
  vault.setCircuitBroken(agent, true);

  // Allocation blocked
  assert.throws(() => {
    vault.allocateEpochBucket(agent, provider, 1n, 2000n, 3600);
  }, /ERR_CIRCUIT_BREAKER_ACTIVE/);

  vault.setCircuitBroken(agent, false);
  vault.allocateEpochBucket(agent, provider, 1n, 2000n, 3600);

  // Break circuit again
  vault.setCircuitBroken(agent, true);

  // Settle delta blocked
  assert.throws(() => {
    vault.settleVoucherDelta(agent, provider, 1n, 500n);
  }, /ERR_CIRCUIT_BREAKER_ACTIVE/);
});

test("CircuitVault: test_WithdrawalCooldownEnforcement", () => {
  const vault = new CircuitVaultSimulator();
  const agent = "0x1111111111111111111111111111111111111111";

  vault.deposit(agent, 5000n);
  vault.requestWithdrawal(agent, 2000n);

  // Immediate finalization rejected
  assert.throws(() => {
    vault.finalizeWithdrawal(agent, agent);
  }, /ERR_COOLDOWN_ACTIVE/);

  // Advance 31 minutes
  vault.currentTimestamp += 1805n;

  const finalized = vault.finalizeWithdrawal(agent, agent);
  assert.equal(finalized, 2000n);
  assert.equal(vault.getVaultBalance(agent), 3000n);
});

test("CircuitVault: test_ShardedRelayerCompensationAndBatchClaim", () => {
  const vault = new CircuitVaultSimulator();
  const relayer = "0x7777777777777777777777777777777777777777";

  vault.creditRelayerFee(relayer, 1n, 15n);
  vault.creditRelayerFee(relayer, 2n, 40n);
  vault.creditRelayerFee(relayer, 3n, 25n);

  const claimed = vault.claimRelayerCredits(relayer, [1n, 2n, 3n]);
  assert.equal(claimed, 80n);

  // Claiming again yields 0 (lazy settlement consumed)
  const claimedAgain = vault.claimRelayerCredits(relayer, [1n, 2n, 3n]);
  assert.equal(claimedAgain, 0n);
});

test("CircuitVault: test_AtomicEpochRollover_SettlesOldAndAllocatesNew", () => {
  const vault = new CircuitVaultSimulator();
  const agent = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  const provider = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

  // 1. Initial deposit of 10,000 units
  vault.deposit(agent, 10000n);

  // 2. Allocate 4,000 units to Epoch 1
  vault.allocateEpochBucket(agent, provider, 1n, 4000n, 3600);
  assert.equal(vault.getVaultBalance(agent), 6000n);

  // 3. Agent spends 2,500 units in Epoch 1 (leaving 1,500 unspent float)
  // Run atomic rollover: settles 2,500 to provider, refunds 1,500 float, allocates 5,000 to Epoch 2
  const { delta, refundedFloat } = vault.rolloverEpochBucket(
    agent,
    provider,
    1n,      // oldEpoch
    2500n,   // oldCumulativeSpent
    "0x",    // oldSignature
    2n,      // newEpoch
    5000n,   // newAmount
    3600     // newDuration
  );

  assert.equal(delta, 2500n);
  assert.equal(refundedFloat, 1500n);

  // Old bucket is closed
  const oldBucket = vault.getEpochBucket(agent, provider, 1n);
  assert.equal(oldBucket.isClosed, true);
  assert.equal(oldBucket.cumulativeSettled, 2500n);

  // New bucket is active with 5,000 cap
  const newBucket = vault.getEpochBucket(agent, provider, 2n);
  assert.equal(newBucket.isClosed, false);
  assert.equal(newBucket.allocatedCap, 5000n);

  // Balance arithmetic: 6000 initial remaining + 1500 refunded float - 5000 new allocation = 2500
  assert.equal(vault.getVaultBalance(agent), 2500n);
});

