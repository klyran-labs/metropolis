// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICircuitVault} from "../interfaces/ICircuitVault.sol";
import {IPolicyEngine} from "../interfaces/IPolicyEngine.sol";
import {IERC1271} from "../interfaces/IERC1271.sol";
import {TransientReentrancyGuard} from "../libraries/TransientReentrancyGuard.sol";

interface IERC20Minimal {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @title CircuitVault
 * @notice Production Clearing & Settlement Kernel for Circuit Protocol on Monad Parallel EVM (ADR-0013).
 * @dev Enforces double-partitioned storage slots, split-state dispute challenge protocols,
 *      monotonic spend floors, and Cancun transient storage reentrancy protection.
 */
contract CircuitVault is ICircuitVault, TransientReentrancyGuard {
    address public immutable owner;
    IERC20Minimal public immutable token;
    IPolicyEngine public immutable policyEngine;

    uint256 public constant CHALLENGE_WINDOW_BLOCKS = 200;
    uint64 public constant UNBONDING_COOLDOWN_SECONDS = 1800; // 30 minutes
    bytes4 private constant ERC1271_MAGICVALUE = 0x1626ba7e;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant MICRO_VOUCHER_TYPEHASH = keccak256(
        "MicroVoucher(address agent,address provider,uint256 epoch,bytes32 sessionId,uint128 cumulativeSpent,uint256 nonce,uint256 deadline)"
    );
    bytes32 public constant SESSION_VOUCHER_TYPEHASH =
        keccak256("SessionVoucher(address agent,address provider,bytes32 sessionId,uint128 voucherAmount)");

    // Double-Partitioned Storage Slots: Anchored strictly by agent address
    // Eliminates parallel write-write conflicts across concurrent agents on Monad Parallel EVM
    mapping(address => mapping(address => mapping(uint256 => EpochBucket))) public agentEpochAllocation;
    mapping(address => uint128) public vaultBalance;
    mapping(address => WithdrawalRequest) public withdrawalRequests;

    // Split-State Challenge Protocol Slots: Disentangles agent challenges from merchant vouchers
    mapping(address => mapping(bytes32 => UnilateralChallenge)) public agentChallenges;
    mapping(address => mapping(address => mapping(bytes32 => uint128))) public merchantSettlements;

    // Sharded Lazy-Settled Relayer Compensation Slots
    mapping(address => mapping(uint256 => uint128)) public relayerGasCredits;
    mapping(address => bool) public authorizedCallers;

    error Unauthorized();
    error ZeroAddress();
    error CircuitBreakerActive();
    error InsufficientVaultBalance();
    error BucketClosed();
    error AllocationExceeded();
    error SpendNotMonotonic();
    error ChallengeAlreadyActive();
    error ChallengeTargetMismatch();
    error ChallengeNotExpired();
    error NoActiveChallenge();
    error InvalidVoucherSignature();
    error CooldownActive();
    error ZeroAmount();
    error TokenTransferFailed();
    error AmountOverflow();
    error BucketExpired();

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert Unauthorized();
    }

    modifier notCircuitBroken(address agent) {
        _notCircuitBroken(agent);
        _;
    }

    function _notCircuitBroken(address agent) internal view {
        if (policyEngine.isCircuitBroken(agent)) revert CircuitBreakerActive();
    }

    constructor(address _token, address _policyEngine) {
        if (_token == address(0) || _policyEngine == address(0)) revert ZeroAddress();
        owner = msg.sender;
        token = IERC20Minimal(_token);
        policyEngine = IPolicyEngine(_policyEngine);

        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("CircuitVault_MicroVoucher")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    function setAuthorizedCaller(address caller, bool allowed) external onlyOwner {
        if (caller == address(0)) revert ZeroAddress();
        authorizedCallers[caller] = allowed;
        emit AuthorizedCallerUpdated(caller, allowed);
    }

    /// @notice Balance-delta custody deposit protecting against fee-on-transfer / rebasing insolvency.
    function deposit(address agent, uint256 amount) external override nonReentrant returns (uint256 actualAmount) {
        if (agent == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();

        uint256 balBefore = token.balanceOf(address(this));
        bool ok = token.transferFrom(msg.sender, address(this), amount);
        if (!ok) revert TokenTransferFailed();
        uint256 balAfter = token.balanceOf(address(this));

        actualAmount = balAfter - balBefore;
        if (actualAmount == 0) revert ZeroAmount();
        if (actualAmount > type(uint128).max) revert AmountOverflow();

        if (vaultBalance[agent] > type(uint128).max - uint128(actualAmount)) revert AmountOverflow();
        vaultBalance[agent] += uint128(actualAmount);
        emit Deposited(agent, msg.sender, actualAmount);
    }

    /// @notice Initiates a timelocked withdrawal with 30-minute cooldown to prevent flash-loan griefing.
    function requestWithdrawal(address agent, uint128 amount) external override {
        if (msg.sender != agent && msg.sender != policyEngine.agentAdmin(agent) && msg.sender != owner) {
            revert Unauthorized();
        }
        if (amount == 0) revert ZeroAmount();
        if (vaultBalance[agent] < amount) revert InsufficientVaultBalance();

        WithdrawalRequest storage req = withdrawalRequests[agent];
        if (req.active) revert CooldownActive();

        req.amount = amount;
        req.unlockTimestamp = uint64(block.timestamp + UNBONDING_COOLDOWN_SECONDS);
        req.active = true;

        emit WithdrawalRequested(agent, amount, req.unlockTimestamp);
    }

    /// @notice Finalizes an unbonded withdrawal after cooldown expires.
    function finalizeWithdrawal(address agent, address recipient)
        external
        override
        nonReentrant
        returns (uint128 amount)
    {
        if (msg.sender != agent && msg.sender != policyEngine.agentAdmin(agent) && msg.sender != owner) {
            revert Unauthorized();
        }
        if (recipient == address(0)) revert ZeroAddress();

        WithdrawalRequest storage req = withdrawalRequests[agent];
        if (!req.active) revert NoActiveChallenge();
        if (block.timestamp < req.unlockTimestamp) revert CooldownActive();

        amount = req.amount;
        if (vaultBalance[agent] < amount) revert InsufficientVaultBalance();

        vaultBalance[agent] -= amount;
        req.active = false;
        req.amount = 0;

        bool ok = token.transfer(recipient, amount);
        if (!ok) revert TokenTransferFailed();

        emit WithdrawalFinalized(agent, recipient, amount);
    }

    /// @notice Double-partitioned allocation: anchors credit in agent's orthogonal storage slot.
    function allocateEpochBucket(address agent, address provider, uint256 epoch, uint128 amount, uint32 duration)
        external
        override
        notCircuitBroken(agent)
    {
        if (msg.sender != agent && msg.sender != policyEngine.agentAdmin(agent) && msg.sender != owner) {
            revert Unauthorized();
        }
        if (provider == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        if (vaultBalance[agent] < amount) revert InsufficientVaultBalance();

        EpochBucket storage bucket = agentEpochAllocation[agent][provider][epoch];
        if (bucket.isClosed) revert BucketClosed();
        if (bucket.allocatedCap > 0) _notBucketExpired(bucket);

        vaultBalance[agent] -= amount;

        if (bucket.allocatedCap == 0) {
            bucket.epochStart = uint32(block.timestamp);
            bucket.epochDuration = duration;
        }
        if (bucket.allocatedCap > type(uint128).max - amount) revert AmountOverflow();
        bucket.allocatedCap += amount;

        emit EpochBucketAllocated(agent, provider, epoch, bucket.allocatedCap, duration);
    }

    /// @notice Streaming settlement: claims earned delta while keeping the credit bucket open.
    function settleVoucherDelta(
        address agent,
        address provider,
        uint256 epoch,
        uint128 cumulativeSpent,
        bytes calldata signature
    ) external override nonReentrant notCircuitBroken(agent) returns (uint128 delta) {
        EpochBucket storage bucket = agentEpochAllocation[agent][provider][epoch];
        if (bucket.isClosed) revert BucketClosed();
        _notBucketExpired(bucket);
        if (cumulativeSpent > bucket.allocatedCap) revert AllocationExceeded();
        if (cumulativeSpent <= bucket.cumulativeSettled) revert SpendNotMonotonic();

        _verifyVoucher(agent, provider, epoch, bytes32(0), cumulativeSpent, 0, block.timestamp + 1 hours, signature);

        delta = cumulativeSpent - bucket.cumulativeSettled;
        bucket.cumulativeSettled = cumulativeSpent;

        bool ok = token.transfer(provider, delta);
        if (!ok) revert TokenTransferFailed();

        emit VoucherDeltaSettled(agent, provider, epoch, delta, cumulativeSpent);
    }

    /// @notice Explicit session teardown: claims final delta and refunds unspent float to enterprise treasury.
    function terminalClose(
        address agent,
        address provider,
        uint256 epoch,
        uint128 cumulativeSpent,
        bytes calldata signature
    ) external override nonReentrant returns (uint128 delta, uint128 refundedFloat) {
        EpochBucket storage bucket = agentEpochAllocation[agent][provider][epoch];
        if (bucket.isClosed) revert BucketClosed();

        if (cumulativeSpent > 0 && cumulativeSpent > bucket.cumulativeSettled) {
            if (cumulativeSpent > bucket.allocatedCap) revert AllocationExceeded();
            _notBucketExpired(bucket);
            _verifyVoucher(agent, provider, epoch, bytes32(0), cumulativeSpent, 0, block.timestamp + 1 hours, signature);
            delta = cumulativeSpent - bucket.cumulativeSettled;
            bucket.cumulativeSettled = cumulativeSpent;
            bool ok = token.transfer(provider, delta);
            if (!ok) revert TokenTransferFailed();
        }

        bucket.isClosed = true;
        refundedFloat = bucket.allocatedCap - bucket.cumulativeSettled;
        if (refundedFloat > 0) {
            vaultBalance[agent] += refundedFloat;
        }

        emit TerminalClosed(agent, provider, epoch, delta, refundedFloat);
    }

    /// @notice Atomic Epoch Rollover: settles previous epoch and allocates new epoch in a single 400ms transaction.
    function rolloverEpochBucket(
        address agent,
        address provider,
        uint256 oldEpoch,
        uint128 oldCumulativeSpent,
        bytes calldata oldSignature,
        uint256 newEpoch,
        uint128 newAmount,
        uint32 newDuration
    ) external override nonReentrant notCircuitBroken(agent) returns (uint128 delta, uint128 refundedFloat) {
        if (msg.sender != agent && msg.sender != policyEngine.agentAdmin(agent) && msg.sender != owner) {
            revert Unauthorized();
        }

        // 1. Terminal close the old epoch bucket if allocated
        EpochBucket storage oldBucket = agentEpochAllocation[agent][provider][oldEpoch];
        if (oldBucket.allocatedCap > 0 && !oldBucket.isClosed) {
            if (oldCumulativeSpent > 0 && oldCumulativeSpent > oldBucket.cumulativeSettled) {
                if (oldCumulativeSpent > oldBucket.allocatedCap) revert AllocationExceeded();
                _notBucketExpired(oldBucket);
                _verifyVoucher(
                    agent,
                    provider,
                    oldEpoch,
                    bytes32(0),
                    oldCumulativeSpent,
                    0,
                    block.timestamp + 1 hours,
                    oldSignature
                );
                delta = oldCumulativeSpent - oldBucket.cumulativeSettled;
                oldBucket.cumulativeSettled = oldCumulativeSpent;
                bool ok = token.transfer(provider, delta);
                if (!ok) revert TokenTransferFailed();
            }

            oldBucket.isClosed = true;
            refundedFloat = oldBucket.allocatedCap - oldBucket.cumulativeSettled;
            if (refundedFloat > 0) {
                vaultBalance[agent] += refundedFloat;
            }

            emit TerminalClosed(agent, provider, oldEpoch, delta, refundedFloat);
        }

        // 2. Allocate the new epoch bucket
        if (provider == address(0)) revert ZeroAddress();
        if (newAmount == 0) revert ZeroAmount();
        if (vaultBalance[agent] < newAmount) revert InsufficientVaultBalance();

        EpochBucket storage newBucket = agentEpochAllocation[agent][provider][newEpoch];
        if (newBucket.isClosed) revert BucketClosed();

        vaultBalance[agent] -= newAmount;

        if (newBucket.allocatedCap == 0) {
            newBucket.epochStart = uint32(block.timestamp);
            newBucket.epochDuration = newDuration;
        }
        if (newBucket.allocatedCap > type(uint128).max - newAmount) revert AmountOverflow();
        newBucket.allocatedCap += newAmount;

        emit EpochBucketAllocated(agent, provider, newEpoch, newBucket.allocatedCap, newDuration);
        emit EpochRolledOver(agent, provider, oldEpoch, newEpoch, delta, refundedFloat, newBucket.allocatedCap);
    }

    /// @notice Split-State Dispute: Agent initiates unilateral challenge writing strictly to agent's slot.
    function requestUnilateralClose(
        address agent,
        address provider,
        uint256 epoch,
        bytes32 sessionId,
        uint128 claimedSpent
    ) external override {
        if (msg.sender != agent && msg.sender != policyEngine.agentAdmin(agent) && msg.sender != owner) {
            revert Unauthorized();
        }
        if (provider == address(0)) revert ZeroAddress();
        EpochBucket storage bucket = agentEpochAllocation[agent][provider][epoch];
        if (bucket.isClosed) revert BucketClosed();

        UnilateralChallenge storage ch = agentChallenges[agent][sessionId];
        if (ch.active) revert ChallengeAlreadyActive();

        ch.challengeBlock = block.number;
        ch.proposedSettlement = claimedSpent;
        ch.provider = provider;
        ch.epoch = epoch;
        ch.active = true;

        emit UnilateralChallengeInitiated(agent, provider, epoch, sessionId, block.number, claimedSpent);
    }

    /// @notice Split-State Dispute: Merchant submits highest voucher writing strictly to provider slot.
    function submitMerchantVoucher(
        address agent,
        address provider,
        bytes32 sessionId,
        uint128 voucherAmount,
        bytes calldata signature
    ) external override {
        if (agent == address(0) || provider == address(0)) revert ZeroAddress();
        if (!agentChallenges[agent][sessionId].active) revert NoActiveChallenge();
        if (voucherAmount <= merchantSettlements[agent][provider][sessionId]) revert SpendNotMonotonic();

        // Verifies the agent's signature on the session voucher
        _verifySessionVoucher(agent, provider, sessionId, voucherAmount, signature);

        merchantSettlements[agent][provider][sessionId] = voucherAmount;
        emit MerchantVoucherSubmitted(agent, provider, sessionId, voucherAmount);
    }

    /// @notice Split-State Dispute: Resolves dispute via read-only comparison across orthogonal slots.
    function finalizeUnilateralClose(address agent, address provider, uint256 epoch, bytes32 sessionId)
        external
        override
        nonReentrant
        returns (uint128 providerPayout, uint128 agentRefund)
    {
        UnilateralChallenge storage ch = agentChallenges[agent][sessionId];
        if (!ch.active) revert NoActiveChallenge();
        if (ch.provider != provider || ch.epoch != epoch) revert ChallengeTargetMismatch();
        if (block.number < ch.challengeBlock + CHALLENGE_WINDOW_BLOCKS) revert ChallengeNotExpired();

        EpochBucket storage bucket = agentEpochAllocation[agent][provider][epoch];
        if (bucket.isClosed) revert BucketClosed();

        uint128 merchantClaim = merchantSettlements[agent][provider][sessionId];
        uint128 finalSpent = merchantClaim > ch.proposedSettlement ? merchantClaim : ch.proposedSettlement;
        if (finalSpent > bucket.allocatedCap) {
            finalSpent = bucket.allocatedCap;
        }

        if (finalSpent > bucket.cumulativeSettled) {
            providerPayout = finalSpent - bucket.cumulativeSettled;
            bucket.cumulativeSettled = finalSpent;
            bool ok = token.transfer(provider, providerPayout);
            if (!ok) revert TokenTransferFailed();
        }

        bucket.isClosed = true;
        ch.active = false;

        agentRefund = bucket.allocatedCap - bucket.cumulativeSettled;
        if (agentRefund > 0) {
            vaultBalance[agent] += agentRefund;
        }

        emit UnilateralCloseFinalized(agent, provider, sessionId, providerPayout, agentRefund);
    }

    /// @notice Accrues gas compensation internally to prevent write collisions on external ERC-20 slots.
    function creditRelayerFee(address relayer, uint256 shardId, uint128 amount) external override {
        if (msg.sender != owner && !authorizedCallers[msg.sender]) revert Unauthorized();
        if (relayer == address(0)) revert ZeroAddress();
        if (relayerGasCredits[relayer][shardId] > type(uint128).max - amount) revert AmountOverflow();
        relayerGasCredits[relayer][shardId] += amount;
        emit RelayerCreditAccrued(relayer, shardId, amount);
    }

    /// @notice Relayers claim accumulated payouts in aggregated batch withdrawals.
    function claimRelayerCredits(uint256[] calldata shardIds)
        external
        override
        nonReentrant
        returns (uint128 totalPayout)
    {
        for (uint256 i = 0; i < shardIds.length; i++) {
            uint256 shard = shardIds[i];
            uint128 credit = relayerGasCredits[msg.sender][shard];
            if (credit > 0) {
                if (totalPayout > type(uint128).max - credit) revert AmountOverflow();
                totalPayout += credit;
                relayerGasCredits[msg.sender][shard] = 0;
            }
        }
        if (totalPayout > 0) {
            bool ok = token.transfer(msg.sender, totalPayout);
            if (!ok) revert TokenTransferFailed();
        }
        emit RelayerCreditClaimed(msg.sender, totalPayout);
    }

    function _verifyVoucher(
        address agent,
        address provider,
        uint256 epoch,
        bytes32 sessionId,
        uint128 cumulativeSpent,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) internal view {
        bytes32 structHash = keccak256(
            abi.encode(MICRO_VOUCHER_TYPEHASH, agent, provider, epoch, sessionId, cumulativeSpent, nonce, deadline)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := calldataload(signature.offset)
                s := calldataload(add(signature.offset, 0x20))
                v := byte(0, calldataload(add(signature.offset, 0x40)))
            }
            // EIP-2 signature malleability protection: reject upper half of secp256k1 order
            if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
                revert InvalidVoucherSignature();
            }
            // forge-lint: disable-next-line(ecrecover)
            address recovered = ecrecover(digest, v, r, s);
            if (recovered == agent) return;
        }

        // ERC-1271 fallback
        if (agent.code.length > 0) {
            try IERC1271(agent).isValidSignature(digest, signature) returns (bytes4 magic) {
                if (magic == ERC1271_MAGICVALUE) return;
            } catch {}
        }

        revert InvalidVoucherSignature();
    }

    function _verifySessionVoucher(
        address agent,
        address provider,
        bytes32 sessionId,
        uint128 voucherAmount,
        bytes calldata signature
    ) internal view {
        bytes32 structHash = keccak256(abi.encode(SESSION_VOUCHER_TYPEHASH, agent, provider, sessionId, voucherAmount));
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));

        if (signature.length == 65) {
            bytes32 r;
            bytes32 s;
            uint8 v;
            assembly {
                r := calldataload(signature.offset)
                s := calldataload(add(signature.offset, 0x20))
                v := byte(0, calldataload(add(signature.offset, 0x40)))
            }
            // EIP-2 signature malleability protection: reject upper half of secp256k1 order
            if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) {
                revert InvalidVoucherSignature();
            }
            // forge-lint: disable-next-line(ecrecover)
            address recovered = ecrecover(digest, v, r, s);
            if (recovered == agent) return;
        }

        if (agent.code.length > 0) {
            try IERC1271(agent).isValidSignature(digest, signature) returns (bytes4 magic) {
                if (magic == ERC1271_MAGICVALUE) return;
            } catch {}
        }

        revert InvalidVoucherSignature();
    }

    // View Getters
    function getVaultBalance(address agent) external view override returns (uint128) {
        return vaultBalance[agent];
    }

    function getEpochBucket(address agent, address provider, uint256 epoch)
        external
        view
        override
        returns (EpochBucket memory)
    {
        return agentEpochAllocation[agent][provider][epoch];
    }

    function getAgentChallenge(address agent, bytes32 sessionId)
        external
        view
        override
        returns (UnilateralChallenge memory)
    {
        return agentChallenges[agent][sessionId];
    }

    function getMerchantSettlement(address agent, address provider, bytes32 sessionId)
        external
        view
        override
        returns (uint128)
    {
        return merchantSettlements[agent][provider][sessionId];
    }

    function getRelayerGasCredits(address relayer, uint256 shardId) external view override returns (uint128) {
        return relayerGasCredits[relayer][shardId];
    }

    function _notBucketExpired(EpochBucket storage bucket) internal view {
        if (bucket.epochDuration > 0 && block.timestamp > uint256(bucket.epochStart) + uint256(bucket.epochDuration)) {
            revert BucketExpired();
        }
    }
}
