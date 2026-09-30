// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IAgentSuccessionVault
 * @notice Autonomous Dead-Man's Switch & Failover Succession Protocol for AI Agents on Monad.
 * @dev Enforces non-custodial capital recovery and standby key delegation upon prolonged agent cloud inactivity.
 */
interface IAgentSuccessionVault {
    struct AgentLiveness {
        uint256 lastHeartbeat;
        uint256 inactivityWindowSeconds; // e.g. 72 hours = 259,200s
        address standbyKey;
        address fallbackTreasury;
        bool successionActive;
    }

    event HeartbeatRecorded(address indexed agent, uint256 timestamp);
    event SuccessionConfigured(
        address indexed agent,
        uint256 inactivityWindowSeconds,
        address standbyKey,
        address fallbackTreasury
    );
    event SuccessionTriggered(
        address indexed agent,
        address indexed activatedKey,
        address indexed fallbackTreasury,
        uint256 timestamp
    );

    error GracePeriodNotExpired(uint256 remainingSeconds);
    error StandbyKeyNotConfigured();
    error FallbackTreasuryNotConfigured();
    error SuccessionAlreadyActive();
    error Unauthorized();
    error ZeroAddress();

    function recordHeartbeat(address agent) external;

    function configureSuccession(
        address agent,
        uint256 inactivityWindowSeconds,
        address standbyKey,
        address fallbackTreasury
    ) external;

    function triggerSuccession(address agent) external returns (address activatedKey);

    function getLiveness(address agent) external view returns (AgentLiveness memory);
}
