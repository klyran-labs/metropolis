// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPolicyEngine } from "../interfaces/IPolicyEngine.sol";
import { IReputationRegistry } from "../interfaces/IReputationRegistry.sol";
import { TransientReentrancyGuard } from "../libraries/TransientReentrancyGuard.sol";

interface IERC20Minimal {
    function transfer(address to, uint256 amount) external returns (bool);
}

/**
 * @title AgentDelegationAccount
 * @notice EIP-7702 Delegated Code Implementation for Autonomous EOA Agents on Monad.
 * @dev When an EOA delegates its code to this contract via EIP-7702, `address(this)` is the EOA.
 *      All outgoing payments are atomically evaluated against PolicyEngine and logged in ReputationRegistry.
 */
contract AgentDelegationAccount is TransientReentrancyGuard {
    IPolicyEngine public immutable policyEngine;
    IReputationRegistry public immutable reputationRegistry;

    event DelegatedPaymentExecuted(
        address indexed agent,
        address indexed merchant,
        uint256 amount,
        uint256 nonce,
        address token
    );

    event DelegatedPaymentBlocked(
        address indexed agent,
        address indexed merchant,
        uint256 amount,
        uint256 nonce,
        IPolicyEngine.ReasonCode reasonCode
    );

    error PolicyEvaluationFailed(IPolicyEngine.ReasonCode reasonCode);
    error NativeTransferFailed();
    error ERC20TransferFailed();
    error InsufficientNativeBalance();

    constructor(address _policyEngine, address _reputationRegistry) {
        policyEngine = IPolicyEngine(_policyEngine);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
    }

    receive() external payable {}

    struct DelegatedPayment {
        address merchant;
        uint256 amount;
        address token;
        bytes32 category;
        uint256 deadline;
        uint256 nonce;
        bytes extraCallData;
    }

    /**
     * @notice Executes a gated payment directly from the delegating EOA context.
     */
    function executeGated(DelegatedPayment calldata p) external nonReentrant returns (bool) {
        IPolicyEngine.SpendRequest memory req = IPolicyEngine.SpendRequest({
            agent: address(this),
            merchant: p.merchant,
            amount: p.amount,
            category: p.category,
            timestamp: block.timestamp,
            deadline: p.deadline,
            nonce: p.nonce
        });

        IPolicyEngine.PolicyDecision memory decision = policyEngine.evaluateAndSpend(req);
        if (!decision.allowed) {
            emit DelegatedPaymentBlocked(address(this), p.merchant, p.amount, p.nonce, decision.reasonCode);
            revert PolicyEvaluationFailed(decision.reasonCode);
        }

        if (p.token == address(0)) {
            if (address(this).balance < p.amount) revert InsufficientNativeBalance();
            (bool sent, ) = p.merchant.call{value: p.amount}("");
            if (!sent) revert NativeTransferFailed();
        } else {
            (bool success, bytes memory data) = p.token.call(
                abi.encodeWithSelector(IERC20Minimal.transfer.selector, p.merchant, p.amount)
            );
            if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
                revert ERC20TransferFailed();
            }
        }

        reputationRegistry.recordOutcome(
            address(this),
            p.merchant,
            IReputationRegistry.ReputationOutcome.SETTLED,
            p.amount
        );

        if (p.extraCallData.length > 0) {
            (bool callSuccess, ) = p.merchant.call(p.extraCallData);
            callSuccess;
        }

        emit DelegatedPaymentExecuted(address(this), p.merchant, p.amount, p.nonce, p.token);
        return true;
    }

    /**
     * @notice Batched gated execution for high-throughput atomic Monad transactions.
     */
    function executeBatchGated(DelegatedPayment[] calldata payments) external nonReentrant returns (uint256 executedCount) {
        for (uint256 i = 0; i < payments.length; i++) {
            DelegatedPayment calldata p = payments[i];
            IPolicyEngine.SpendRequest memory req = IPolicyEngine.SpendRequest({
                agent: address(this),
                merchant: p.merchant,
                amount: p.amount,
                category: p.category,
                timestamp: block.timestamp,
                deadline: p.deadline,
                nonce: p.nonce
            });

            IPolicyEngine.PolicyDecision memory decision = policyEngine.evaluateAndSpend(req);
            if (!decision.allowed) {
                emit DelegatedPaymentBlocked(address(this), p.merchant, p.amount, p.nonce, decision.reasonCode);
                revert PolicyEvaluationFailed(decision.reasonCode);
            }

            if (p.token == address(0)) {
                if (address(this).balance < p.amount) revert InsufficientNativeBalance();
                (bool sent, ) = p.merchant.call{value: p.amount}("");
                if (!sent) revert NativeTransferFailed();
            } else {
                (bool success, bytes memory data) = p.token.call(
                    abi.encodeWithSelector(IERC20Minimal.transfer.selector, p.merchant, p.amount)
                );
                if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
                    revert ERC20TransferFailed();
                }
            }

            reputationRegistry.recordOutcome(
                address(this),
                p.merchant,
                IReputationRegistry.ReputationOutcome.SETTLED,
                p.amount
            );

            if (p.extraCallData.length > 0) {
                (bool callSuccess, ) = p.merchant.call(p.extraCallData);
                callSuccess;
            }

            emit DelegatedPaymentExecuted(address(this), p.merchant, p.amount, p.nonce, p.token);
        }
        return payments.length;
    }
}
