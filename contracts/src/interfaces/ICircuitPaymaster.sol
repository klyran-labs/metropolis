// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ICircuitPaymaster
 * @notice Formal specification for Circuit Protocol's ERC-4337 / ERC-7677 Enterprise Gas Paymaster.
 * @dev Enforces Monad Parallel EVM disjoint storage accounting, O(1) circuit breaker checks,
 *      and organization treasury gas sponsorship.
 */
interface ICircuitPaymaster {
    enum PostOpMode {
        opSucceeded,
        opReverted,
        postOpReverted
    }

    struct UserOperation {
        address sender;
        uint256 nonce;
        bytes initCode;
        bytes callData;
        uint256 callGasLimit;
        uint256 verificationGasLimit;
        uint256 preVerificationGas;
        uint256 maxFeePerGas;
        uint256 maxPriorityFeePerGas;
        bytes paymasterAndData;
        bytes signature;
    }

    event GasSponsored(address indexed agent, address indexed treasury, uint256 actualGasCost);
    event TreasuryDeposited(address indexed treasury, uint256 amount);
    event TreasuryWithdrawn(address indexed treasury, uint256 amount);
    event AgentTreasuryAssigned(address indexed agent, address indexed treasury);
    event PaymasterDepositToEntryPoint(address indexed entryPoint, uint256 amount);

    function depositGas(address treasury) external payable;
    function withdrawGas(address treasury, uint256 amount) external;
    function setAgentTreasury(address agent, address treasury) external;
    function isSponsorshipEligible(address agent, uint256 maxCost) external view returns (bool eligible, uint8 reasonCode);
    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 maxCost
    ) external returns (bytes memory context, uint256 validationData);
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost
    ) external;
}
