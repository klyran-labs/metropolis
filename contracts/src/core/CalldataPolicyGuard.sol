// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICalldataPolicyGuard} from "../interfaces/ICalldataPolicyGuard.sol";

/**
 * @title CalldataPolicyGuard
 * @notice Argument-level calldata policy evaluator for autonomous agents on Monad Parallel EVM.
 * @dev Disjoint storage slots partitioned by agent address. Inspects function selectors,
 *      slippage tolerances, and recipient parameter offsets to prevent prompt-injection drains.
 */
contract CalldataPolicyGuard is ICalldataPolicyGuard {
    address public immutable owner;

    // Disjoint storage slot partition: agent => selector => policy
    mapping(address => mapping(bytes4 => SelectorPolicy)) private _selectorPolicies;
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

    function setSelectorPolicy(
        address agent,
        bytes4 selector,
        SelectorPolicy calldata policy
    ) external override onlyAuthorized(agent) {
        if (agent == address(0)) revert ZeroAddress();
        _selectorPolicies[agent][selector] = policy;
        emit SelectorPolicyUpdated(
            agent,
            selector,
            policy.allowed,
            policy.enforceRecipient,
            policy.maxSlippageBps,
            policy.maxValue
        );
    }

    function getSelectorPolicy(address agent, bytes4 selector)
        external
        view
        override
        returns (SelectorPolicy memory)
    {
        return _selectorPolicies[agent][selector];
    }

    function evaluateCalldata(
        address agent,
        address target,
        uint256 msgValue,
        bytes calldata data
    ) external override returns (bool allowed, uint8 reasonCode) {
        if (agent == address(0) || target == address(0)) {
            revert ZeroAddress();
        }

        // Calldata must contain at least a 4-byte function selector
        if (data.length < 4) {
            emit CalldataEvaluated(agent, target, bytes4(0), false, 3);
            return (false, 3); // ERR_MERCHANT_NOT_WHITELISTED / invalid payload
        }

        bytes4 selector = bytes4(data[:4]);
        SelectorPolicy memory policy = _selectorPolicies[agent][selector];

        // 1. Selector Permission Check
        if (!policy.allowed) {
            emit CalldataEvaluated(agent, target, selector, false, 3);
            return (false, 3);
        }

        // 2. Maximum Value Ceiling Check
        if (policy.maxValue > 0 && msgValue > policy.maxValue) {
            emit CalldataEvaluated(agent, target, selector, false, 1);
            return (false, 1); // ERR_EXCEEDS_MAX_TX
        }

        // 3. Recipient Parameter Offset Check
        if (policy.enforceRecipient) {
            uint256 offset = policy.recipientParamOffset;
            if (data.length < offset + 32) {
                emit CalldataEvaluated(agent, target, selector, false, 9);
                return (false, 9); // ERR_SIGNATURE_INVALID / malformed calldata
            }

            address extractedRecipient;
            assembly {
                let word := calldataload(add(data.offset, offset))
                extractedRecipient := and(word, 0xffffffffffffffffffffffffffffffffffffffff)
            }

            // Recipient must match the agent itself or the designated admin
            if (extractedRecipient != agent && extractedRecipient != agentAdmins[agent]) {
                emit CalldataEvaluated(agent, target, selector, false, 3);
                return (false, 3);
            }
        }

        emit CalldataEvaluated(agent, target, selector, true, 0);
        return (true, 0); // ERR_NONE
    }
}
