// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IQuarantineController
 * @notice Graduated 4-Tier Adaptive Quarantine & Dynamic Rate Throttling Protocol on Monad.
 * @dev Replaces brittle binary trip-switches with smooth self-healing degradation based on streaming anomaly telemetry.
 */
interface IQuarantineController {
    enum QuarantineTier {
        NOMINAL,          // Tier 0: 100% spend limit allowed (Z < 2.0)
        ELEVATED,         // Tier 1: 50% step-down rate limit (2.0 <= Z < 3.5)
        QUORUM_REQUIRED,  // Tier 2: Multi-sig confirmation required for disbursements (3.5 <= Z < 5.0)
        BYZANTINE_HALTED  // Tier 3: O(1) emergency circuit breaker freeze (Z >= 5.0)
    }

    struct QuarantineState {
        QuarantineTier tier;
        uint16 throttleBps; // 10000 = 100%, 5000 = 50%, 0 = 0%
        uint256 lastTransitionTimestamp;
        uint256 anomalyScoreZ100; // Z-score multiplied by 100 (e.g. 350 = Z of 3.50)
    }

    event QuarantineTierUpdated(
        address indexed agent,
        QuarantineTier oldTier,
        QuarantineTier newTier,
        uint256 anomalyScoreZ100,
        uint16 newThrottleBps
    );

    event QuarantineHealed(address indexed agent, QuarantineTier previousTier, QuarantineTier targetTier);

    error InvalidTierTransition();
    error Unauthorized();
    error ZeroAddress();

    function updateQuarantineTier(
        address agent,
        QuarantineTier newTier,
        uint256 anomalyScoreZ100
    ) external;

    function getQuarantineState(address agent) external view returns (QuarantineState memory);

    function applyThrottle(address agent, uint256 requestedAmount)
        external
        view
        returns (uint256 effectiveAllowedAmount, QuarantineTier currentTier);
}
