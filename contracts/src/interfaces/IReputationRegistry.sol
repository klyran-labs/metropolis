// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IReputationRegistry
 * @notice Pure Domain Interface for AgentGuard's append-only outcome logging and incremental scoring on Monad.
 */
interface IReputationRegistry {
    enum ReputationOutcome {
        SETTLED, // 0
        DISPUTED, // 1
        SLASHED, // 2
        TIMEOUT // 3
    }

    /// @dev Storage layout invariant: 1 slot (32 bytes).
    ///   6 × uint32 = 24 bytes < 32 bytes → packed into a single SLOAD/SSTORE.
    ///   CRITICAL: Do NOT add any field wider than uint64 (8B) without measuring
    ///   the slot impact — even uint256 amount would split this to 2 slots, doubling
    ///   read cost for every getMetrics() and recordOutcome() call.
    struct ReputationMetrics {
        uint32 scoreBps; // 0 to 1,000,000 parts-per-million (100.00%). Named `scoreBps`
        // for historical reasons; NOT a 0-10,000 basis-points scale
        // (see docs/ADR/0004-ewma-reputation-mechanics.md).
        uint32 totalTransactions;
        uint32 settledCount;
        uint32 slashedCount;
        uint32 disputedCount;
        uint32 lastUpdatedTimestamp;
    }

    event OutcomeRecorded(
        address indexed agent,
        address indexed counterparty,
        ReputationOutcome outcome,
        uint256 amount,
        uint32 newScoreBps
    );

    function recordOutcome(address agent, address counterparty, ReputationOutcome outcome, uint256 amount) external;

    function getMetrics(address agent) external view returns (ReputationMetrics memory);
    function getScore(address agent) external view returns (uint32 scoreBps);
    function isTrusted(address agent, uint32 minScoreBps) external view returns (bool);
}
