// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPolicyEngine } from "../interfaces/IPolicyEngine.sol";
import { TransientReentrancyGuard } from "../libraries/TransientReentrancyGuard.sol";

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

    // Monad-optimized disjoint storage slots: indexed strictly by agent address
    mapping(address => PackedPolicy) private _policies;
    mapping(address => PackedState) private _states;
    mapping(address => mapping(address => bool)) private _merchantWhitelists;
    mapping(address => mapping(uint256 => bool)) private _usedNonces;
    mapping(address => address) public agentAdmin;
    mapping(address => bool) public authorizedCallers;

    error Unauthorized();
    error ZeroAddress();
    error InvalidPolicyParameters();
    error NonceAlreadyUsed(address agent, uint256 nonce);
    error ExpiredRequest(uint256 deadline, uint256 blockTimestamp);

    modifier onlyAgentOrAdmin(address agent) {
        if (msg.sender != agent && msg.sender != agentAdmin[agent] && msg.sender != owner) {
            revert Unauthorized();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setAgentAdmin(address agent, address admin) external {
        if (msg.sender != agent && msg.sender != owner) revert Unauthorized();
        if (admin == address(0)) revert ZeroAddress();
        agentAdmin[agent] = admin;
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

        emit PolicySet(
            agent,
            policy.maxPerTx,
            policy.maxPerWindow,
            policy.windowSeconds,
            policy.maxVelocity,
            policy.whitelistEnabled
        );
    }

    function setKillSwitch(address agent, bool active) external onlyAgentOrAdmin(agent) {
        _policies[agent].killSwitch = active;
        emit KillSwitchUpdated(agent, active);
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
        PackedPolicy memory policy = _policies[req.agent];
        PackedState memory state = _states[req.agent];

        // If not explicitly configured, default to safe zero-allowance with kill switch
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

    function evaluateAndSpend(SpendRequest calldata req) external override nonReentrant returns (PolicyDecision memory decision) {
        // Authorization gate: only the agent itself, its registered admin, or an
        // explicitly authorized caller (the deployed AgentWalletGuard) may consume
        // spend/velocity budget. Without this check, any address could call this
        // function directly with a fabricated but syntactically valid SpendRequest
        // and burn the agent's rolling-window budget without a real payment ever
        // occurring — a griefing/DoS vector against the agent's own traffic.
        if (msg.sender != req.agent && msg.sender != agentAdmin[req.agent] && !authorizedCallers[msg.sender]) {
            revert Unauthorized();
        }

        decision = evaluate(req);

        emit SpendEvaluated(req.agent, req.merchant, req.amount, decision.allowed, decision.reasonCode);

        if (!decision.allowed) {
            return decision;
        }

        // Invariant: Nonce must be strictly consumed
        _usedNonces[req.agent][req.nonce] = true;

        PackedPolicy memory policy = _policies[req.agent];
        PackedState storage state = _states[req.agent];

        uint128 spentInWindow = state.spentInWindow;
        uint32 txCountInWindow = state.txCountInWindow;
        uint32 windowStart = state.windowStart;

        if (windowStart == 0 || block.timestamp >= uint256(windowStart) + uint256(policy.windowSeconds)) {
            spentInWindow = 0;
            txCountInWindow = 0;
            windowStart = uint32(block.timestamp);
        }

        spentInWindow = uint128(uint256(spentInWindow) + req.amount);
        txCountInWindow = txCountInWindow + 1;

        state.spentInWindow = spentInWindow;
        state.txCountInWindow = txCountInWindow;
        state.windowStart = windowStart;
        state.nonce = uint64(req.nonce);

        emit SpendRecorded(req.agent, req.amount, spentInWindow, txCountInWindow);
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

    function getAgentState(address agent) external view override returns (
        uint128 spentInWindow,
        uint32 windowStart,
        uint32 txCountInWindow,
        uint64 nonce
    ) {
        PackedState memory s = _states[agent];
        return (s.spentInWindow, s.windowStart, s.txCountInWindow, s.nonce);
    }
}
