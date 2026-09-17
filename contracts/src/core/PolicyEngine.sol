// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicyEngine} from "../interfaces/IPolicyEngine.sol";
import {TransientReentrancyGuard} from "../libraries/TransientReentrancyGuard.sol";

/**
 * @title PolicyEngine
 * @notice Production Onchain Risk & Policy Evaluation Engine for AgentGuard on Monad.
 * @dev Enforces strict reason codes, zero-bypass limits, O(1) kill switches,
 *      and storage slot disjointness for Monad Parallel EVM concurrency.
 */
contract PolicyEngine is IPolicyEngine, TransientReentrancyGuard {
    address public immutable owner;

    // Packed struct layouts for optimal SLOAD/SSTORE packing on EVM
    struct PackedPolicy {
        uint128 maxPerTx;
        uint128 maxPerWindow;
        uint32 windowSeconds;
        uint32 maxVelocity;
        bool killSwitch;
        bool whitelistEnabled;
        bool isConfigured;
    }

    struct PackedState {
        uint128 spentInWindow;
        uint32 windowStart;
        uint32 txCountInWindow;
        uint64 nonce;
    }

    /// @dev 2-slot layout (down from 3 with bytes32 orgId):
    ///   Slot 0: uint96 orgId (12B) + uint128 totalBudget (16B) + uint32 windowSeconds (4B) = 32B
    ///   Slot 1: uint128 spentBudget (16B) + uint32 windowStart (4B) + bool active (1B) + 11B pad
    ///   Saves 1 warm SLOAD (100 gas) per budget pool check in _evaluate() vs the 3-slot layout.
    struct PackedBudgetPool {
        uint96 orgId;
        uint128 totalBudget;
        uint32 windowSeconds;
        uint128 spentBudget;
        uint32 windowStart;
        bool active;
    }

    // Monad-optimized disjoint storage slots: indexed strictly by agent address
    mapping(address => PackedPolicy) private _policies;
    mapping(address => PackedState) private _states;
    mapping(address => mapping(address => bool)) private _merchantWhitelists;
    mapping(address => mapping(uint256 => bool)) private _usedNonces;
    mapping(address => address) public override agentAdmin;
    mapping(address => bool) public override circuitBroken;
    mapping(address => bool) public authorizedCallers;
    mapping(bytes32 => PackedBudgetPool) private _budgetPools;
    mapping(address => bytes32) public agentBudgetPool;

    error Unauthorized();
    error ZeroAddress();
    error InvalidPolicyParameters();

    modifier onlyAgentOrAdmin(address agent) {
        _checkAgentOrAdmin(agent);
        _;
    }

    function _checkAgentOrAdmin(address agent) internal view {
        if (agentAdmin[agent] != address(0)) {
            if (msg.sender != agentAdmin[agent] && msg.sender != owner) {
                revert Unauthorized();
            }
        } else {
            if (msg.sender != agent && msg.sender != owner) {
                revert Unauthorized();
            }
        }
    }

    constructor() {
        owner = msg.sender;
    }

    function setAgentAdmin(address agent, address admin) external override {
        if (agentAdmin[agent] != address(0)) {
            if (msg.sender != agentAdmin[agent] && msg.sender != owner) revert Unauthorized();
        } else {
            if (msg.sender != agent && msg.sender != owner) revert Unauthorized();
        }
        if (admin == address(0)) revert ZeroAddress();
        agentAdmin[agent] = admin;
        emit AgentAdminUpdated(agent, admin);
    }

    /// @notice Registers (or revokes) a contract permitted to call `evaluateAndSpend`
    ///         on behalf of any agent. Closes the unauthenticated-caller griefing
    ///         vector where anyone could burn an agent's window/velocity budget by
    ///         calling `evaluateAndSpend` directly with a fabricated SpendRequest
    ///         (see docs/GAP_ANALYSIS.md, finding 1.3). Only the protocol owner may
    ///         grant this — in practice, the deployed AgentWalletGuard address.
    function setAuthorizedCaller(address caller, bool allowed) external override {
        if (msg.sender != owner) revert Unauthorized();
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = allowed;
        emit AuthorizedCallerUpdated(caller, allowed);
    }

    function createBudgetPool(bytes32 poolId, uint96 orgId, uint128 totalBudget, uint32 windowSeconds)
        external
        override
    {
        if (msg.sender != owner) revert Unauthorized();
        if (poolId == bytes32(0)) revert InvalidPolicyParameters();
        if (windowSeconds == 0) revert InvalidPolicyParameters();

        _budgetPools[poolId] = PackedBudgetPool({
            orgId: orgId,
            totalBudget: totalBudget,
            spentBudget: 0,
            windowSeconds: windowSeconds,
            windowStart: uint32(block.timestamp),
            active: true
        });

        emit BudgetPoolCreated(poolId, orgId, totalBudget, windowSeconds);
    }

    function assignAgentToPool(address agent, bytes32 poolId) external override onlyAgentOrAdmin(agent) {
        if (agent == address(0)) revert ZeroAddress();
        agentBudgetPool[agent] = poolId;
        emit AgentAssignedToPool(agent, poolId);
    }

    function getBudgetPool(bytes32 poolId) external view override returns (BudgetPool memory) {
        PackedBudgetPool memory p = _budgetPools[poolId];
        return BudgetPool({
            poolId: poolId,
            orgId: p.orgId,
            totalBudget: p.totalBudget,
            spentBudget: p.spentBudget,
            windowSeconds: p.windowSeconds,
            windowStart: p.windowStart,
            active: p.active
        });
    }

    function getAgentPoolId(address agent) external view override returns (bytes32) {
        return agentBudgetPool[agent];
    }

    function batchSetPolicies(address[] calldata agents, SpendPolicy[] calldata policies) external override {
        if (agents.length != policies.length) revert InvalidPolicyParameters();
        for (uint256 i = 0; i < agents.length; i++) {
            address agent = agents[i];
            if (msg.sender != agent && msg.sender != agentAdmin[agent] && msg.sender != owner) revert Unauthorized();
            if (agent == address(0)) revert ZeroAddress();
            SpendPolicy calldata policy = policies[i];
            if (policy.windowSeconds == 0 || policy.maxVelocity == 0) revert InvalidPolicyParameters();

            _policies[agent] = PackedPolicy({
                maxPerTx: policy.maxPerTx,
                maxPerWindow: policy.maxPerWindow,
                windowSeconds: policy.windowSeconds,
                maxVelocity: policy.maxVelocity,
                killSwitch: policy.killSwitch,
                whitelistEnabled: policy.whitelistEnabled,
                isConfigured: true
            });
            circuitBroken[agent] = policy.killSwitch;

            emit PolicySet(
                agent,
                policy.maxPerTx,
                policy.maxPerWindow,
                policy.windowSeconds,
                policy.maxVelocity,
                policy.whitelistEnabled
            );
        }
    }

    function setPolicy(address agent, SpendPolicy calldata policy) external onlyAgentOrAdmin(agent) {
        if (agent == address(0)) revert ZeroAddress();
        if (policy.windowSeconds == 0) revert InvalidPolicyParameters();
        if (policy.maxVelocity == 0) revert InvalidPolicyParameters();

        _policies[agent] = PackedPolicy({
            maxPerTx: policy.maxPerTx,
            maxPerWindow: policy.maxPerWindow,
            windowSeconds: policy.windowSeconds,
            maxVelocity: policy.maxVelocity,
            killSwitch: policy.killSwitch,
            whitelistEnabled: policy.whitelistEnabled,
            isConfigured: true
        });
        circuitBroken[agent] = policy.killSwitch;

        emit PolicySet(
            agent,
            policy.maxPerTx,
            policy.maxPerWindow,
            policy.windowSeconds,
            policy.maxVelocity,
            policy.whitelistEnabled
        );
    }

    /// @notice Backward-compatible kill switch mutator. Synchronizes with ADR-0012 circuitBroken state.
    function setKillSwitch(address agent, bool active) external override {
        if (agent == address(0)) revert ZeroAddress();
        if (active) {
            if (msg.sender != agent && msg.sender != agentAdmin[agent] && msg.sender != owner) revert Unauthorized();
            circuitBroken[agent] = true;
            _policies[agent].killSwitch = true;
            emit KillSwitchUpdated(agent, true);
            emit CircuitBreakerTripped(agent, msg.sender);
        } else {
            if (agentAdmin[agent] != address(0)) {
                if (msg.sender != agentAdmin[agent] && msg.sender != owner) revert Unauthorized();
            } else {
                if (msg.sender != agent && msg.sender != owner) revert Unauthorized();
            }
            circuitBroken[agent] = false;
            _policies[agent].killSwitch = false;
            emit KillSwitchUpdated(agent, false);
            emit CircuitBreakerReset(agent, msg.sender);
        }
    }

    /// @notice ADR-0012: Instantly trips the O(1) financial circuit breaker for an agent.
    function tripCircuitBreaker(address agent) external override {
        if (agent == address(0)) revert ZeroAddress();
        if (msg.sender != agent && msg.sender != agentAdmin[agent] && msg.sender != owner) revert Unauthorized();
        circuitBroken[agent] = true;
        _policies[agent].killSwitch = true;
        emit CircuitBreakerTripped(agent, msg.sender);
        emit KillSwitchUpdated(agent, true);
    }

    /// @notice ADR-0012: Resets the financial circuit breaker for an agent.
    /// Enforces Dual-Role Enterprise Authority: Autonomous Agent (0xAgent) cannot reset its own circuit breaker.
    function resetCircuitBreaker(address agent) external override {
        if (agent == address(0)) revert ZeroAddress();
        if (agentAdmin[agent] != address(0)) {
            if (msg.sender != agentAdmin[agent] && msg.sender != owner) revert Unauthorized();
        } else {
            if (msg.sender != agent && msg.sender != owner) revert Unauthorized();
        }
        circuitBroken[agent] = false;
        _policies[agent].killSwitch = false;
        emit CircuitBreakerReset(agent, msg.sender);
        emit KillSwitchUpdated(agent, false);
    }

    /// @notice ADR-0012: O(1) query whether an agent's financial circuit breaker is active.
    function isCircuitBroken(address agent) external view override returns (bool) {
        return circuitBroken[agent] || _policies[agent].killSwitch;
    }

    function setMerchantWhitelist(address agent, address merchant, bool allowed) external onlyAgentOrAdmin(agent) {
        if (merchant == address(0)) revert ZeroAddress();
        _merchantWhitelists[agent][merchant] = allowed;
        emit MerchantWhitelistUpdated(agent, merchant, allowed);
    }

    function isMerchantWhitelisted(address agent, address merchant) external view returns (bool) {
        return _merchantWhitelists[agent][merchant];
    }

    function isNonceUsed(address agent, uint256 nonce) external view returns (bool) {
        return _usedNonces[agent][nonce];
    }

    function evaluate(SpendRequest calldata req) public view override returns (PolicyDecision memory) {
        return _evaluate(req);
    }

    function _evaluate(SpendRequest calldata req) internal view returns (PolicyDecision memory) {
        PackedPolicy memory policy = _policies[req.agent];
        PackedState memory state = _states[req.agent];

        // O(1) short-circuit: unconfigured or kill-switch active.
        // `policy.killSwitch` is the canonical kill-switch flag — it is always kept in sync with
        // the `circuitBroken` mapping by `tripCircuitBreaker`, `resetCircuitBreaker`, and
        // `setKillSwitch`. Reading `circuitBroken[req.agent]` here would be a redundant SLOAD
        // (100 gas on Monad warm storage) — omit it in the view-only evaluation path.
        if (!policy.isConfigured || policy.killSwitch) {
            return PolicyDecision({
                allowed: false,
                allowedAmount: 0,
                reasonCode: ReasonCode.ERR_KILL_SWITCH,
                evaluatedAtTimestamp: block.timestamp
            });
        }

        // 1. Check deadline
        if (req.deadline > 0 && block.timestamp > req.deadline) {
            return PolicyDecision({
                allowed: false,
                allowedAmount: 0,
                reasonCode: ReasonCode.ERR_EXPIRED,
                evaluatedAtTimestamp: block.timestamp
            });
        }

        // 2. Check nonce
        if (_usedNonces[req.agent][req.nonce]) {
            return PolicyDecision({
                allowed: false,
                allowedAmount: 0,
                reasonCode: ReasonCode.ERR_NONCE_REUSED,
                evaluatedAtTimestamp: block.timestamp
            });
        }

        // 3. Check merchant whitelist
        if (policy.whitelistEnabled && !_merchantWhitelists[req.agent][req.merchant]) {
            return PolicyDecision({
                allowed: false,
                allowedAmount: 0,
                reasonCode: ReasonCode.ERR_MERCHANT_NOT_ALLOWED,
                evaluatedAtTimestamp: block.timestamp
            });
        }

        // 3.5 Check Org / Team Budget Pool
        bytes32 poolId = agentBudgetPool[req.agent];
        if (poolId != bytes32(0)) {
            PackedBudgetPool memory pool = _budgetPools[poolId];
            if (pool.active) {
                uint128 poolSpent = pool.spentBudget;
                if (pool.windowStart == 0 || block.timestamp >= uint256(pool.windowStart) + uint256(pool.windowSeconds))
                {
                    poolSpent = 0;
                }
                if (uint256(poolSpent) + req.amount > pool.totalBudget) {
                    return PolicyDecision({
                        allowed: false,
                        allowedAmount: 0,
                        reasonCode: ReasonCode.ERR_BUDGET_DEPLETED,
                        evaluatedAtTimestamp: block.timestamp
                    });
                }
            }
        }

        // 4. Check maxPerTx
        if (req.amount > policy.maxPerTx) {
            return PolicyDecision({
                allowed: false,
                allowedAmount: 0,
                reasonCode: ReasonCode.ERR_MAX_PER_TX,
                evaluatedAtTimestamp: block.timestamp
            });
        }

        // 5. Calculate sliding window roll-forward
        uint128 spentInWindow = state.spentInWindow;
        uint32 txCountInWindow = state.txCountInWindow;

        if (state.windowStart == 0 || block.timestamp >= uint256(state.windowStart) + uint256(policy.windowSeconds)) {
            // New window started
            spentInWindow = 0;
            txCountInWindow = 0;
        }

        // 6. Check window cumulative spend limit
        if (uint256(spentInWindow) + req.amount > policy.maxPerWindow) {
            return PolicyDecision({
                allowed: false,
                allowedAmount: 0,
                reasonCode: ReasonCode.ERR_MAX_PER_WINDOW,
                evaluatedAtTimestamp: block.timestamp
            });
        }

        // 7. Check velocity rate limit
        if (uint256(txCountInWindow) + 1 > policy.maxVelocity) {
            return PolicyDecision({
                allowed: false,
                allowedAmount: 0,
                reasonCode: ReasonCode.ERR_VELOCITY_EXCEEDED,
                evaluatedAtTimestamp: block.timestamp
            });
        }

        return PolicyDecision({
            allowed: true,
            allowedAmount: req.amount,
            reasonCode: ReasonCode.ERR_NONE,
            evaluatedAtTimestamp: block.timestamp
        });
    }

    function evaluateAndSpend(SpendRequest calldata req)
        external
        override
        nonReentrant
        returns (PolicyDecision memory decision)
    {
        // Authorization gate: only the agent itself, its registered admin, or an
        // explicitly authorized caller (the deployed AgentWalletGuard) may consume
        // spend/velocity budget. Without this check, any address could call this
        // function directly with a fabricated but syntactically valid SpendRequest
        // and burn the agent's rolling-window budget without a real payment ever
        // occurring — a griefing/DoS vector against the agent's own traffic.
        if (msg.sender != req.agent && msg.sender != agentAdmin[req.agent] && !authorizedCallers[msg.sender]) {
            revert Unauthorized();
        }

        decision = _evaluate(req);

        emit SpendEvaluated(req.agent, req.merchant, req.amount, decision.allowed, decision.reasonCode);

        if (!decision.allowed) {
            return decision;
        }

        // Invariant: Nonce must be strictly consumed
        _usedNonces[req.agent][req.nonce] = true;

        PackedPolicy memory policy = _policies[req.agent];
        PackedState memory prevState = _states[req.agent]; // read-only: compute on memory, then single SSTORE

        uint128 spentInWindow = prevState.spentInWindow;
        uint32 txCountInWindow = prevState.txCountInWindow;
        uint32 windowStart = prevState.windowStart;

        if (windowStart == 0 || block.timestamp >= uint256(windowStart) + uint256(policy.windowSeconds)) {
            spentInWindow = 0;
            txCountInWindow = 0;
            windowStart = uint32(block.timestamp);
        }

        spentInWindow = uint128(uint256(spentInWindow) + req.amount);
        txCountInWindow = txCountInWindow + 1;

        // Single SSTORE: PackedState is a perfect 32-byte slot (uint128 + uint32 + uint32 + uint64).
        // Writing all four fields through a `storage` pointer would issue 4 × SSTORE (4 × 100 gas warm).
        // Constructing a `memory` struct and assigning to the mapping slot issues exactly 1 SSTORE.
        // Saves 300 warm gas per spending transaction.
        _states[req.agent] = PackedState({
            spentInWindow: spentInWindow,
            windowStart: windowStart,
            txCountInWindow: txCountInWindow,
            nonce: uint64(req.nonce)
        });

        emit SpendRecorded(req.agent, req.amount, spentInWindow, txCountInWindow);

        bytes32 poolId = agentBudgetPool[req.agent];
        if (poolId != bytes32(0)) {
            PackedBudgetPool storage pool = _budgetPools[poolId];
            if (pool.active) {
                if (pool.windowStart == 0 || block.timestamp >= uint256(pool.windowStart) + uint256(pool.windowSeconds))
                {
                    pool.spentBudget = 0;
                    pool.windowStart = uint32(block.timestamp);
                }
                pool.spentBudget = uint128(uint256(pool.spentBudget) + req.amount);
                emit BudgetPoolSpent(poolId, uint128(req.amount), pool.spentBudget);
            }
        }
    }

    function getAgentPolicy(address agent) external view override returns (SpendPolicy memory) {
        PackedPolicy memory p = _policies[agent];
        return SpendPolicy({
            maxPerTx: p.maxPerTx,
            maxPerWindow: p.maxPerWindow,
            windowSeconds: p.windowSeconds,
            maxVelocity: p.maxVelocity,
            killSwitch: p.killSwitch,
            whitelistEnabled: p.whitelistEnabled
        });
    }

    function getAgentState(address agent)
        external
        view
        override
        returns (uint128 spentInWindow, uint32 windowStart, uint32 txCountInWindow, uint64 nonce)
    {
        PackedState memory s = _states[agent];
        return (s.spentInWindow, s.windowStart, s.txCountInWindow, s.nonce);
    }
}
