// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IReputationRegistry} from "../interfaces/IReputationRegistry.sol";

/**
 * @title ReputationRegistry
 * @notice Append-Only Trust & Outcome Ledger with Incremental O(1) Scoring for Monad.
 * @dev Recomputes rolling score incrementally on every transaction without expensive unbounded loops.
 */
contract ReputationRegistry is IReputationRegistry {
    address public immutable owner;

    mapping(address => ReputationMetrics) private _metrics;
    mapping(address => bool) public authorizedReporters;

    error Unauthorized();
    error ZeroAddress();

    modifier onlyReporter() {
        if (!authorizedReporters[msg.sender] && msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
        authorizedReporters[msg.sender] = true;
    }

    function setReporter(address reporter, bool authorized) external {
        if (msg.sender != owner) revert Unauthorized();
        if (reporter == address(0)) revert ZeroAddress();
        authorizedReporters[reporter] = authorized;
    }

    function recordOutcome(address agent, address counterparty, ReputationOutcome outcome, uint256 amount)
        external
        override
        onlyReporter
    {
        if (agent == address(0)) revert ZeroAddress();

        ReputationMetrics storage m = _metrics[agent];
        uint32 currentScore = m.scoreBps;

        // Initialize score if first transaction to 500,000 (50.00% neutral baseline)
        if (m.totalTransactions == 0 && currentScore == 0) {
            currentScore = 500000;
        }

        if (outcome == ReputationOutcome.SETTLED) {
            m.settledCount += 1;
            // Incremental EWMA update: 95% previous + 5% target (1,000,000 bps)
            currentScore = uint32((uint256(currentScore) * 95 + 1000000 * 5) / 100);
            if (currentScore > 1000000) currentScore = 1000000;
        } else if (outcome == ReputationOutcome.DISPUTED) {
            m.disputedCount += 1;
            currentScore = uint32((uint256(currentScore) * 90 + 200000 * 10) / 100);
        } else if (outcome == ReputationOutcome.SLASHED) {
            m.slashedCount += 1;
            // Heavy slashing penalty: 30% instant reduction
            currentScore = uint32((uint256(currentScore) * 70) / 100);
        } else if (outcome == ReputationOutcome.TIMEOUT) {
            currentScore = uint32((uint256(currentScore) * 95 + 300000 * 5) / 100);
        }

        m.totalTransactions += 1;
        m.scoreBps = currentScore;
        m.lastUpdatedTimestamp = uint32(block.timestamp);

        emit OutcomeRecorded(agent, counterparty, outcome, amount, currentScore);
    }

    function getMetrics(address agent) external view override returns (ReputationMetrics memory) {
        ReputationMetrics memory m = _metrics[agent];
        if (m.totalTransactions == 0 && m.scoreBps == 0) {
            m.scoreBps = 500000; // Baseline
        }
        return m;
    }

    function getScore(address agent) external view override returns (uint32 scoreBps) {
        ReputationMetrics memory m = _metrics[agent];
        if (m.totalTransactions == 0 && m.scoreBps == 0) {
            return 500000;
        }
        return m.scoreBps;
    }

    function isTrusted(address agent, uint32 minScoreBps) external view override returns (bool) {
        return this.getScore(agent) >= minScoreBps;
    }
}
