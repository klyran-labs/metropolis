// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicyEngine} from "../interfaces/IPolicyEngine.sol";
import {IReputationRegistry} from "../interfaces/IReputationRegistry.sol";
import {IAgentWalletGuard} from "../interfaces/IAgentWalletGuard.sol";
import {IERC1271} from "../interfaces/IERC1271.sol";
import {IERC20Permit} from "../interfaces/IERC20Permit.sol";
import {TransientReentrancyGuard} from "../libraries/TransientReentrancyGuard.sol";

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title AgentWalletGuard
 * @notice EIP-712 Delegated Policy Execution Guard for Autonomous Agent Payments on Monad.
 * @dev Enforces cryptographic authorization, atomic policy gating, ERC-1271 contracts, and instant settlement.
 */
contract AgentWalletGuard is IAgentWalletGuard, TransientReentrancyGuard {
    IPolicyEngine public immutable policyEngine;
    IReputationRegistry public immutable reputationRegistry;

    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 public constant SPEND_REQUEST_TYPEHASH = keccak256(
        "SpendRequest(address agent,address merchant,uint256 amount,bytes32 category,uint256 timestamp,uint256 deadline,uint256 nonce)"
    );

    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;

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
        return _processGatedPayment(req, signature, token, extraCallData);
    }

    function executeGatedPaymentWithPermit(
        IPolicyEngine.SpendRequest calldata req,
        bytes calldata signature,
        address token,
        uint256 permitDeadline,
        uint8 v,
        bytes32 r,
        bytes32 s,
        bytes calldata extraCallData
    ) external payable override nonReentrant returns (bool success) {
        // Atomic 1-tx EIP-2612 permit approval before transfer
        if (token != address(0)) {
            IERC20Permit(token).permit(req.agent, address(this), req.amount, permitDeadline, v, r, s);
        }
        return _processGatedPayment(req, signature, token, extraCallData);
    }

    /// @notice Atomically settles a batch of validated payment vouchers across Monad Parallel EVM.
    /// @dev Utilizes Cancun transient reentrancy protection and Monad disjoint-slot state access.
    function executeBatchGatedPayment(
        BatchPaymentItem[] calldata items
    ) external payable override nonReentrant returns (bool[] memory successes) {
        uint256 len = items.length;
        successes = new bool[](len);
        for (uint256 i = 0; i < len; ++i) {
            successes[i] = _processGatedPayment(
                items[i].req,
                items[i].signature,
                items[i].token,
                items[i].extraCallData
            );
        }
    }

    function _processGatedPayment(
        IPolicyEngine.SpendRequest calldata req,
        bytes calldata signature,
        address token,
        bytes calldata extraCallData
    ) internal returns (bool success) {
        // 1. Compute EIP-712 Digest
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

        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        // 2. Cryptographic Signer Verification (Supports EOA ecrecover and ERC-1271 smart contract wallets)
        if (!_verifySigner(req.agent, digest, signature)) {
            revert InvalidSignature();
        }

        // 3. Evaluate Policy & Spend State Atomically on Monad
        IPolicyEngine.PolicyDecision memory decision = policyEngine.evaluateAndSpend(req);

        if (!decision.allowed) {
            emit PaymentBlocked(req.agent, req.merchant, req.amount, req.nonce, decision.reasonCode);
            revert PolicyEvaluationFailed(decision.reasonCode);
        }

        // 4. Settle Funds
        if (token == address(0)) {
            // Native MON settlement
            if (address(this).balance < req.amount) revert InsufficientNativeBalance();
            (bool sent,) = req.merchant.call{value: req.amount}("");
            if (!sent) revert NativeTransferFailed();
        } else {
            // ERC-20 stablecoin settlement (e.g. USDC on Monad)
            _safeTransferFrom(token, req.agent, req.merchant, req.amount);
        }

        // 5. Update Onchain Reputation Incrementally
        reputationRegistry.recordOutcome(
            req.agent, req.merchant, IReputationRegistry.ReputationOutcome.SETTLED, req.amount
        );

        // 6. Forward Optional Execution Payload (e.g. AP2 mandate or merchant callback)
        if (extraCallData.length > 0) {
            (bool callSuccess,) = req.merchant.call(extraCallData);
            // Non-reverting callback failure allows payment settlement to persist
            callSuccess;
        }

        emit PaymentExecuted(req.agent, req.merchant, req.amount, req.nonce, token);
        return true;
    }

    function _verifySigner(address expectedSigner, bytes32 digest, bytes calldata signature)
        internal
        view
        returns (bool)
    {
        // If agent is a smart contract (Safe, ERC-4337, multi-sig), verify via ERC-1271
        if (expectedSigner.code.length > 0) {
            (bool ok, bytes memory res) =
                expectedSigner.staticcall(abi.encodeWithSelector(IERC1271.isValidSignature.selector, digest, signature));
            return (ok && res.length >= 32 && abi.decode(res, (bytes4)) == ERC1271_MAGICVALUE);
        }
        // Fallback: standard EOA ecrecover
        return _recoverSigner(digest, signature) == expectedSigner;
    }

    function _safeTransferFrom(address token, address from, address to, uint256 amount) internal {
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(IERC20Minimal.transferFrom.selector, from, to, amount));
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
        // EIP-2 enforces s <= secp256k1n / 2 to reject malleable signatures
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
            return address(0);
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(digest, v, r, s);
    }
}
