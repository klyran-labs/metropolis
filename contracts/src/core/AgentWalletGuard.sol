// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IPolicyEngine } from "../interfaces/IPolicyEngine.sol";
import { IReputationRegistry } from "../interfaces/IReputationRegistry.sol";
import { IAgentWalletGuard } from "../interfaces/IAgentWalletGuard.sol";
import { TransientReentrancyGuard } from "../libraries/TransientReentrancyGuard.sol";

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AgentWalletGuard
 * @notice EIP-712 Delegated Policy Execution Guard for Autonomous Agent Payments on Monad.
 * @dev Enforces cryptographic authorization, atomic policy gating, and instant settlement.
 */
contract AgentWalletGuard is IAgentWalletGuard, TransientReentrancyGuard {
    IPolicyEngine public immutable policyEngine;
    IReputationRegistry public immutable reputationRegistry;

    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant SPEND_REQUEST_TYPEHASH = keccak256(
        "SpendRequest(address agent,address merchant,uint256 amount,bytes32 category,uint256 timestamp,uint256 deadline,uint256 nonce)"
    );

    error InvalidSignature();
    error PolicyEvaluationFailed(IPolicyEngine.ReasonCode reasonCode);
    error NativeTransferFailed();
    error ERC20TransferFailed();
    error InsufficientNativeBalance();

    constructor(address _policyEngine, address _reputationRegistry) {
        policyEngine = IPolicyEngine(_policyEngine);
        reputationRegistry = IReputationRegistry(_reputationRegistry);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("AgentGuard_PolicyEngine")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    receive() external payable {}

    function getPolicyEngine() external view override returns (address) {
        return address(policyEngine);
    }

    function getReputationRegistry() external view override returns (address) {
        return address(reputationRegistry);
    }

    function executeGatedPayment(
        IPolicyEngine.SpendRequest calldata req,
        bytes calldata signature,
        address token,
        bytes calldata extraCallData
    ) external payable override nonReentrant returns (bool success) {
        // 1. Verify EIP-712 Signature
        bytes32 structHash = keccak256(
            abi.encode(
                SPEND_REQUEST_TYPEHASH,
                req.agent,
                req.merchant,
                req.amount,
                req.category,
                req.timestamp,
                req.deadline,
                req.nonce
            )
        );

        bytes32 digest = keccak256(
            abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash)
        );

        address recoveredSigner = _recoverSigner(digest, signature);
        if (recoveredSigner != req.agent) {
            revert InvalidSignature();
        }

        // 2. Evaluate Policy & Spend State Atomically on Monad
        IPolicyEngine.PolicyDecision memory decision = policyEngine.evaluateAndSpend(req);

        if (!decision.allowed) {
            emit PaymentBlocked(req.agent, req.merchant, req.amount, req.nonce, decision.reasonCode);
            revert PolicyEvaluationFailed(decision.reasonCode);
        }

        // 3. Settle Funds
        if (token == address(0)) {
            // Native MON settlement
            if (address(this).balance < req.amount) revert InsufficientNativeBalance();
            (bool sent, ) = req.merchant.call{value: req.amount}("");
            if (!sent) revert NativeTransferFailed();
        } else {
            // ERC-20 stablecoin settlement (e.g. USDC on Monad)
            _safeTransferFrom(token, req.agent, req.merchant, req.amount);
        }

        // 4. Update Onchain Reputation Incrementally
        reputationRegistry.recordOutcome(
            req.agent,
            req.merchant,
            IReputationRegistry.ReputationOutcome.SETTLED,
            req.amount
        );

        // 5. Forward Optional Execution Payload (e.g. AP2 mandate or merchant callback)
        if (extraCallData.length > 0) {
            (bool callSuccess, ) = req.merchant.call(extraCallData);
            // Non-reverting callback failure allows payment settlement to persist
            callSuccess;
        }

        emit PaymentExecuted(req.agent, req.merchant, req.amount, req.nonce, token);
        return true;
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert ERC20TransferFailed();
        }
    }

    function _recoverSigner(bytes32 digest, bytes calldata sig) internal pure returns (address) {
        if (sig.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(sig.offset)
            s := calldataload(add(sig.offset, 32))
            v := byte(0, calldataload(add(sig.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
