// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAgentSuccessionVault} from "../interfaces/IAgentSuccessionVault.sol";

/**
 * @title AgentSuccessionVault
 * @notice Autonomous Dead-Man's Switch and Failover Succession Protocol for AI Agents on Monad.
 * @dev Protects against permanent cloud container death, loss of worker credentials, and unspent capital drag.
 */
contract AgentSuccessionVault is IAgentSuccessionVault {
    address public immutable owner;

    // Disjoint storage slot partition: agent => liveness state
    mapping(address => AgentLiveness) private _liveness;
    mapping(address => address) public agentAdmins;

    modifier onlyAuthorized(address agent) {
        _onlyAuthorized(agent);
        _;
    }

    function _onlyAuthorized(address agent) internal view {
        if (msg.sender != owner && msg.sender != agent && msg.sender != agentAdmins[agent]) {
            revert Unauthorized();
        }
    }

    constructor() {
        owner = msg.sender;
    }

    function setAgentAdmin(address agent, address admin) external {
        if (agent == address(0) || admin == address(0)) revert ZeroAddress();
        if (msg.sender != owner && msg.sender != agent) revert Unauthorized();
        agentAdmins[agent] = admin;
    }

    function configureSuccession(
        address agent,
        uint256 inactivityWindowSeconds,
        address standbyKey,
        address fallbackTreasury
    ) external override onlyAuthorized(agent) {
        if (agent == address(0) || standbyKey == address(0) || fallbackTreasury == address(0)) {
            revert ZeroAddress();
        }

        AgentLiveness storage l = _liveness[agent];
        l.inactivityWindowSeconds = inactivityWindowSeconds;
        l.standbyKey = standbyKey;
        l.fallbackTreasury = fallbackTreasury;
        if (l.lastHeartbeat == 0) {
            l.lastHeartbeat = block.timestamp;
        }

        emit SuccessionConfigured(agent, inactivityWindowSeconds, standbyKey, fallbackTreasury);
    }

    function recordHeartbeat(address agent) external override onlyAuthorized(agent) {
        if (agent == address(0)) revert ZeroAddress();
        AgentLiveness storage l = _liveness[agent];
        l.lastHeartbeat = block.timestamp;
        l.successionActive = false; // Reset succession if a valid heartbeat resumes

        emit HeartbeatRecorded(agent, block.timestamp);
    }

    function triggerSuccession(address agent) external override returns (address activatedKey) {
        if (agent == address(0)) revert ZeroAddress();
        AgentLiveness storage l = _liveness[agent];

        if (l.standbyKey == address(0)) revert StandbyKeyNotConfigured();
        if (l.fallbackTreasury == address(0)) revert FallbackTreasuryNotConfigured();
        if (l.successionActive) revert SuccessionAlreadyActive();

        uint256 deadline = l.lastHeartbeat + l.inactivityWindowSeconds;
        if (block.timestamp < deadline) {
            revert GracePeriodNotExpired(deadline - block.timestamp);
        }

        l.successionActive = true;
        activatedKey = l.standbyKey;

        emit SuccessionTriggered(agent, activatedKey, l.fallbackTreasury, block.timestamp);
        return activatedKey;
    }

    function getLiveness(address agent) external view override returns (AgentLiveness memory) {
        return _liveness[agent];
    }
}
