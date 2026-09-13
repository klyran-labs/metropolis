// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPolicyEngine } from "./IPolicyEngine.sol";

/**
 * @title IAgentWalletGuard
 * @notice Policy-enforced execution guard for autonomous agent payments on Monad.
 */
interface IAgentWalletGuard {
    event PaymentExecuted(
        address indexed agent,
        address indexed merchant,
        uint256 amount,
        uint256 nonce,
        address token
    );

    event PaymentBlocked(
        address indexed agent,
        address indexed merchant,
        uint256 amount,
        uint256 nonce,
        IPolicyEngine.ReasonCode reasonCode
    );

    function executeGatedPayment(
        IPolicyEngine.SpendRequest calldata req,
        bytes calldata signature,
        address token,
        bytes calldata extraCallData
    ) external payable returns (bool success);

    function executeGatedPaymentWithPermit(
        IPolicyEngine.SpendRequest calldata req,
        bytes calldata signature,
        address token,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes calldata extraCallData
    ) external payable returns (bool success);

    function getPolicyEngine() external view returns (address);
    function getReputationRegistry() external view returns (address);
}
