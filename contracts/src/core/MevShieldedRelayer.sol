// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IMevShieldedRelayer} from "../interfaces/IMevShieldedRelayer.sol";

/**
 * @title MevShieldedRelayer
 * @notice Executes atomic transaction bundles dispatched by the Gateway private builder relay.
 * @dev Enforces deadline validity, atomic rollback on any sub-call failure, and routes searcher/builder refunds.
 */
contract MevShieldedRelayer is IMevShieldedRelayer {
    address public immutable owner;

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert Unauthorized();
    }

    constructor() {
        owner = msg.sender;
    }

    receive() external payable {}

    function executeMevShieldedBundle(
        BundleCall[] calldata calls,
        MevProtectionParams calldata params
    ) external payable override returns (bool success, uint256 kickbackRefund) {
        if (block.timestamp > params.deadline) {
            revert BundleExpired();
        }

        uint256 startBalance = address(this).balance - msg.value;

        // Execute all bundle calls atomically in sequence
        for (uint256 i = 0; i < calls.length; ++i) {
            (bool callSuccess, bytes memory returnData) = calls[i].target.call{value: calls[i].value}(calls[i].callData);
            if (!callSuccess) {
                revert AtomicCallFailed(i, returnData);
            }
        }

        // Calculate accrued builder/searcher refund
        uint256 currentBalance = address(this).balance;
        if (currentBalance > startBalance) {
            kickbackRefund = currentBalance - startBalance;
        }

        if (kickbackRefund < params.minBackrunRefund) {
            revert InsufficientRefund(kickbackRefund, params.minBackrunRefund);
        }

        // Credit kickback refund to the agent's beneficiary or treasury float
        if (kickbackRefund > 0 && params.beneficiary != address(0)) {
            (bool sent,) = params.beneficiary.call{value: kickbackRefund}("");
            if (sent) {
                emit SearcherKickbackCredited(params.beneficiary, kickbackRefund);
            }
        }

        emit BundleExecuted(params.bundleId, msg.sender, kickbackRefund, calls.length);
        return (true, kickbackRefund);
    }
}
