// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IPolicyEngine
 * @notice Pure Domain Interface for AgentGuard's programmable risk and spend governance on Monad.
 * @dev Enforces strict reason codes, O(1) kill switches, sliding velocity windows, and Monad parallel storage partitioning.
 */
interface IPolicyEngine {
    enum ReasonCode {
        ERR_NONE,                  // 0
        ERR_KILL_SWITCH,           // 1
        ERR_MAX_PER_TX,            // 2
        ERR_MAX_PER_WINDOW,        // 3
        ERR_VELOCITY_EXCEEDED,     // 4
        ERR_MERCHANT_NOT_ALLOWED,  // 5
        ERR_BUDGET_DEPLETED,       // 6
        ERR_EXPIRED,               // 7
        ERR_NONCE_REUSED,          // 8
        ERR_SIGNATURE_INVALID      // 9
    }

    struct SpendPolicy {
        uint128 maxPerTx;
        uint128 maxPerWindow;
        uint32 windowSeconds;
        uint32 maxVelocity;
        bool killSwitch;
        bool whitelistEnabled;
    }

    struct SpendRequest {
        address agent;
        address merchant;
        uint256 amount;
        bytes32 category;
        uint256 timestamp;
        uint256 deadline;
        uint256 nonce;
    }

    struct BudgetPool {
        bytes32 poolId;
        bytes32 orgId;
        uint128 totalBudget;
        uint128 spentBudget;
        uint32 windowSeconds;
        uint32 windowStart;
        bool active;
    }

    struct PolicyDecision {
        bool allowed;
        uint256 allowedAmount;
        ReasonCode reasonCode;
        uint256 evaluatedAtTimestamp;
    }

    event PolicySet(
        address indexed agent,
        uint128 maxPerTx,
        uint128 maxPerWindow,
        uint32 windowSeconds,
        uint32 maxVelocity,
        bool whitelistEnabled
    );

    event KillSwitchUpdated(address indexed agent, bool active);
    event AuthorizedCallerUpdated(address indexed caller, bool allowed);
    event MerchantWhitelistUpdated(address indexed agent, address indexed merchant, bool allowed);
    event SpendEvaluated(address indexed agent, address indexed merchant, uint256 amount, bool allowed, ReasonCode reasonCode);
    event SpendRecorded(address indexed agent, uint256 amount, uint128 totalSpentInWindow, uint32 txCountInWindow);
    event BudgetPoolCreated(bytes32 indexed poolId, bytes32 indexed orgId, uint128 totalBudget, uint32 windowSeconds);
    event AgentAssignedToPool(address indexed agent, bytes32 indexed poolId);
    event BudgetPoolSpent(bytes32 indexed poolId, uint128 amount, uint128 totalSpent);

    function setPolicy(address agent, SpendPolicy calldata policy) external;
    function batchSetPolicies(address[] calldata agents, SpendPolicy[] calldata policies) external;
    function createBudgetPool(bytes32 poolId, bytes32 orgId, uint128 totalBudget, uint32 windowSeconds) external;
    function assignAgentToPool(address agent, bytes32 poolId) external;
    function setKillSwitch(address agent, bool active) external;
    function setAuthorizedCaller(address caller, bool allowed) external;
    function setMerchantWhitelist(address agent, address merchant, bool allowed) external;
    function evaluate(SpendRequest calldata req) external view returns (PolicyDecision memory);
    function evaluateAndSpend(SpendRequest calldata req) external returns (PolicyDecision memory);
    function getAgentPolicy(address agent) external view returns (SpendPolicy memory);
    function getAgentState(address agent) external view returns (uint128 spentInWindow, uint32 windowStart, uint32 txCountInWindow, uint64 nonce);
    function getBudgetPool(bytes32 poolId) external view returns (BudgetPool memory);
    function getAgentPoolId(address agent) external view returns (bytes32);
}
