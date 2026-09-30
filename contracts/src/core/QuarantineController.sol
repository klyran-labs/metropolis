// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IQuarantineController} from "../interfaces/IQuarantineController.sol";

/**
 * @title QuarantineController
 * @notice Graduated 4-Tier Adaptive Quarantine & Dynamic Rate Throttling Protocol on Monad Parallel EVM.
 * @dev Enforces graduated degradation and exponential self-healing to avoid brittle binary trip disruptions.
 */
contract QuarantineController is IQuarantineController {
    address public immutable owner;
    uint256 public constant HEALING_WINDOW_SECONDS = 1800; // 30 minutes to auto-heal from Elevated to Nominal

    // Disjoint storage slot partition: agent => quarantine state
    mapping(address => QuarantineState) private _quarantineStates;
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

    function updateQuarantineTier(
        address agent,
        QuarantineTier newTier,
        uint256 anomalyScoreZ100
    ) external override onlyAuthorized(agent) {
        if (agent == address(0)) revert ZeroAddress();

        QuarantineState storage s = _quarantineStates[agent];
        QuarantineTier oldTier = s.tier;

        uint16 newThrottle;
        if (newTier == QuarantineTier.NOMINAL) {
            newThrottle = 10000; // 100%
        } else if (newTier == QuarantineTier.ELEVATED) {
            newThrottle = 5000;  // 50% step-down
        } else if (newTier == QuarantineTier.QUORUM_REQUIRED) {
            newThrottle = 2000;  // 20% micro-cap until multi-sig approval
        } else {
            newThrottle = 0;     // Byzantine halt
        }

        s.tier = newTier;
        s.throttleBps = newThrottle;
        s.lastTransitionTimestamp = block.timestamp;
        s.anomalyScoreZ100 = anomalyScoreZ100;

        emit QuarantineTierUpdated(agent, oldTier, newTier, anomalyScoreZ100, newThrottle);
    }

    function getQuarantineState(address agent) public view override returns (QuarantineState memory) {
        QuarantineState memory s = _quarantineStates[agent];
        // Default uninitialized agent to Nominal
        if (s.lastTransitionTimestamp == 0) {
            return QuarantineState({
                tier: QuarantineTier.NOMINAL,
                throttleBps: 10000,
                lastTransitionTimestamp: block.timestamp,
                anomalyScoreZ100: 0
            });
        }

        // Auto-heal Elevated tier to Nominal after 30 minutes of tranquility
        if (s.tier == QuarantineTier.ELEVATED && block.timestamp >= s.lastTransitionTimestamp + HEALING_WINDOW_SECONDS) {
            s.tier = QuarantineTier.NOMINAL;
            s.throttleBps = 10000;
        }

        return s;
    }

    function applyThrottle(address agent, uint256 requestedAmount)
        external
        view
        override
        returns (uint256 effectiveAllowedAmount, QuarantineTier currentTier)
    {
        QuarantineState memory s = getQuarantineState(agent);
        currentTier = s.tier;

        if (s.tier == QuarantineTier.BYZANTINE_HALTED) {
            effectiveAllowedAmount = 0;
        } else {
            effectiveAllowedAmount = (requestedAmount * s.throttleBps) / 10000;
        }

        return (effectiveAllowedAmount, currentTier);
    }
}
