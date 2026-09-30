// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicyEngine} from "../interfaces/IPolicyEngine.sol";
import {IReputationRegistry} from "../interfaces/IReputationRegistry.sol";
import {TransientReentrancyGuard} from "../libraries/TransientReentrancyGuard.sol";

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
        address indexed agent, address indexed merchant, uint256 amount, uint256 nonce, address token
    );

    event DelegatedPaymentBlocked(
        address indexed agent,
        address indexed merchant,
        uint256 amount,
        uint256 nonce,
        IPolicyEngine.ReasonCode reasonCode
    );

    event SessionDelegationExecuted(
        address indexed supervisor,
        address indexed worker,
        uint256 indexed sessionNonce,
        uint256 amount,
        uint128 totalSpent
    );

    error PolicyEvaluationFailed(IPolicyEngine.ReasonCode reasonCode);
    error NativeTransferFailed();
    error ERC20TransferFailed();
    error InsufficientNativeBalance();
    error SessionExpired();
    error SubBudgetExceeded();
    error InvalidSupervisorSignature();
    error InvalidWorkerSignature();

    struct SessionCertificate {
        address supervisor;
        address workerSigner;
        uint64 validAfter;
        uint64 validUntil;
        uint128 subBudgetCap;
        bytes32 capabilityMerkleRoot;
        uint256 sessionNonce;
    }

    // Tracks cumulative spend per delegated session certificate
    mapping(uint256 => uint128) public sessionSpent;

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
            (bool sent,) = p.merchant.call{value: p.amount}("");
            if (!sent) revert NativeTransferFailed();
        } else {
            (bool success, bytes memory data) =
                p.token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, p.merchant, p.amount));
            if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
                revert ERC20TransferFailed();
            }
        }

        reputationRegistry.recordOutcome(
            address(this), p.merchant, IReputationRegistry.ReputationOutcome.SETTLED, p.amount
        );

        if (p.extraCallData.length > 0) {
            (bool callSuccess,) = p.merchant.call(p.extraCallData);
            callSuccess;
        }

        emit DelegatedPaymentExecuted(address(this), p.merchant, p.amount, p.nonce, p.token);
        return true;
    }

    /**
     * @notice Batched gated execution for high-throughput atomic Monad transactions.
     */
    function executeBatchGated(DelegatedPayment[] calldata payments)
        external
        nonReentrant
        returns (uint256 executedCount)
    {
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
                (bool sent,) = p.merchant.call{value: p.amount}("");
                if (!sent) revert NativeTransferFailed();
            } else {
                (bool success, bytes memory data) =
                    p.token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, p.merchant, p.amount));
                if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
                    revert ERC20TransferFailed();
                }
            }

            reputationRegistry.recordOutcome(
                address(this), p.merchant, IReputationRegistry.ReputationOutcome.SETTLED, p.amount
            );

            if (p.extraCallData.length > 0) {
                (bool callSuccess,) = p.merchant.call(p.extraCallData);
                callSuccess;
            }

            emit DelegatedPaymentExecuted(address(this), p.merchant, p.amount, p.nonce, p.token);
        }
        return payments.length;
    }

    /**
     * @notice Executes an autonomous payment authorized via an ephemeral session certificate.
     * @dev Enables zero-gas sub-agent delegation with Merkle-scoped capability and sub-budget ceilings.
     */
    function executeSignedSessionDelegation(
        SessionCertificate calldata cert,
        bytes memory certSignature,
        DelegatedPayment calldata p,
        bytes memory workerSignature
    ) external nonReentrant returns (bool) {
        // 1. Time Validity Enforcement
        if (block.timestamp < cert.validAfter || block.timestamp > cert.validUntil) {
            revert SessionExpired();
        }

        // 2. Sub-Budget Enforcement
        uint128 newTotal = sessionSpent[cert.sessionNonce] + uint128(p.amount);
        if (newTotal > cert.subBudgetCap) {
            revert SubBudgetExceeded();
        }

        // 3. Supervisor Signature Verification
        bytes32 certDigest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(
                    abi.encode(
                        cert.supervisor,
                        cert.workerSigner,
                        cert.validAfter,
                        cert.validUntil,
                        cert.subBudgetCap,
                        cert.capabilityMerkleRoot,
                        cert.sessionNonce,
                        block.chainid
                    )
                )
            )
        );
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(certSignature, 32))
            s := mload(add(certSignature, 64))
            v := byte(0, mload(add(certSignature, 96)))
        }
        if (v < 27) v += 27;
        address recoveredSupervisor = ecrecover(certDigest, v, r, s);
        address expectedAdmin = policyEngine.agentAdmin(address(this));
        if (
            recoveredSupervisor == address(0) ||
            recoveredSupervisor != cert.supervisor ||
            (cert.supervisor != address(this) && (expectedAdmin == address(0) || cert.supervisor != expectedAdmin))
        ) {
            revert InvalidSupervisorSignature();
        }

        // 4. Worker Signature Verification over payment parameters
        bytes32 payDigest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(
                    abi.encode(
                        cert.sessionNonce,
                        p.merchant,
                        p.amount,
                        p.token,
                        p.category,
                        p.deadline,
                        p.nonce,
                        block.chainid
                    )
                )
            )
        );
        assembly {
            r := mload(add(workerSignature, 32))
            s := mload(add(workerSignature, 64))
            v := byte(0, mload(add(workerSignature, 96)))
        }
        if (v < 27) v += 27;
        address recoveredWorker = ecrecover(payDigest, v, r, s);
        if (recoveredWorker != cert.workerSigner) {
            revert InvalidWorkerSignature();
        }

        // 5. Update session spend accumulator (Checks-Effects-Interactions)
        sessionSpent[cert.sessionNonce] = newTotal;

        // 6. Atomic Onchain Policy Evaluation against delegating agent's global policy
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

        // 7. Value Settlement
        if (p.token == address(0)) {
            if (address(this).balance < p.amount) revert InsufficientNativeBalance();
            (bool sent,) = p.merchant.call{value: p.amount}("");
            if (!sent) revert NativeTransferFailed();
        } else {
            (bool success, bytes memory data) =
                p.token.call(abi.encodeWithSelector(IERC20Minimal.transfer.selector, p.merchant, p.amount));
            if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
                revert ERC20TransferFailed();
            }
        }

        // 8. Log Reputation
        reputationRegistry.recordOutcome(
            address(this), p.merchant, IReputationRegistry.ReputationOutcome.SETTLED, p.amount
        );

        emit SessionDelegationExecuted(cert.supervisor, cert.workerSigner, cert.sessionNonce, p.amount, newTotal);
        emit DelegatedPaymentExecuted(address(this), p.merchant, p.amount, p.nonce, p.token);
        return true;
    }
}
