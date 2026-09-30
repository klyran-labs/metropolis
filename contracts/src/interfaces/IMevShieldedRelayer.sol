// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IMevShieldedRelayer
 * @notice Interface for MEV-protected atomic bundle execution and searcher kickback routing on Monad.
 */
interface IMevShieldedRelayer {
    struct BundleCall {
        address target;
        uint256 value;
        bytes callData;
    }

    struct MevProtectionParams {
        uint256 minBackrunRefund;
        uint256 maxPriorityFee;
        uint256 deadline;
        bytes32 bundleId;
        address beneficiary;
    }

    event BundleExecuted(bytes32 indexed bundleId, address indexed relayer, uint256 kickbackRefund, uint256 callsCount);
    event SearcherKickbackCredited(address indexed beneficiary, uint256 amount);

    error BundleExpired();
    error InsufficientRefund(uint256 received, uint256 required);
    error AtomicCallFailed(uint256 index, bytes returnData);
    error Unauthorized();

    function executeMevShieldedBundle(
        BundleCall[] calldata calls,
        MevProtectionParams calldata params
    ) external payable returns (bool success, uint256 kickbackRefund);
}
