// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ICircuitVault
 * @notice Pure Domain Interface for Circuit Protocol's Monad Parallel Epoch Clearing & Settlement Vault (ADR-0013).
 * @dev Enforces double-partitioned storage slots, split-state dispute challenge protocols,
 *      monotonic spend floors, and Cancun transient storage reentrancy protection.
 */
interface ICircuitVault {
    enum ReasonCode {
        ERR_NONE,
        ERR_CIRCUIT_BREAKER_ACTIVE,
        ERR_INSUFFICIENT_VAULT_BALANCE,
        ERR_BUCKET_CLOSED,
        ERR_BUCKET_EXPIRED,
        ERR_ALLOCATION_EXCEEDED,
        ERR_SPEND_NOT_MONOTONIC,
        ERR_CHALLENGE_ACTIVE,
        ERR_CHALLENGE_NOT_EXPIRED,
        ERR_NO_ACTIVE_CHALLENGE,
        ERR_VOUCHER_SIGNATURE_INVALID,
        ERR_UNAUTHORIZED,
        ERR_COOLDOWN_ACTIVE,
        ERR_ZERO_AMOUNT
    }

    struct EpochBucket {
        uint128 allocatedCap;       // Total credit allocated for (agent, provider, epoch)
        uint128 cumulativeSettled;  // Total claimed by provider so far
        uint32 epochStart;
        uint32 epochDuration;
        bool isClosed;
    }

    struct UnilateralChallenge {
        uint256 challengeBlock;     // Block number when challenge initiated
        uint128 proposedSettlement; // What agent claims was spent
        bool active;
    }

    struct WithdrawalRequest {
        uint128 amount;
        uint64 unlockTimestamp;
        bool active;
    }

    event Deposited(address indexed agent, address indexed depositor, uint256 amount);
    event WithdrawalRequested(address indexed agent, uint128 amount, uint64 unlockTimestamp);
    event WithdrawalFinalized(address indexed agent, address indexed recipient, uint128 amount);
    event EpochBucketAllocated(
        address indexed agent,
        address indexed provider,
        uint256 indexed epoch,
        uint128 cap,
        uint32 duration
    );
    event VoucherDeltaSettled(
        address indexed agent,
        address indexed provider,
        uint256 indexed epoch,
        uint128 delta,
        uint128 cumulativeSettled
    );
    event TerminalClosed(
        address indexed agent,
        address indexed provider,
        uint256 indexed epoch,
        uint128 finalDelta,
        uint128 refundedFloat
    );
    event UnilateralChallengeInitiated(
        address indexed agent,
        bytes32 indexed sessionId,
        uint256 challengeBlock,
        uint128 proposedSettlement
    );
    event MerchantVoucherSubmitted(
        address indexed provider,
        bytes32 indexed sessionId,
        uint128 voucherAmount
    );
    event UnilateralCloseFinalized(
        address indexed agent,
        address indexed provider,
        bytes32 indexed sessionId,
        uint128 providerPayout,
        uint128 agentRefund
    );
    event RelayerCreditAccrued(address indexed relayer, uint256 indexed shardId, uint128 amount);
    event RelayerCreditClaimed(address indexed relayer, uint128 totalPayout);
    event AuthorizedCallerUpdated(address indexed caller, bool allowed);
    event EpochRolledOver(
        address indexed agent,
        address indexed provider,
        uint256 indexed oldEpoch,
        uint256 newEpoch,
        uint128 oldDelta,
        uint128 refundedFloat,
        uint128 newCap
    );

    function deposit(address agent, uint256 amount) external returns (uint256 actualAmount);
    function requestWithdrawal(address agent, uint128 amount) external;
    function finalizeWithdrawal(address agent, address recipient) external returns (uint128 amount);
    function allocateEpochBucket(
        address agent,
        address provider,
        uint256 epoch,
        uint128 amount,
        uint32 duration
    ) external;
    function settleVoucherDelta(
        address agent,
        address provider,
        uint256 epoch,
        uint128 cumulativeSpent,
        bytes calldata signature
    ) external returns (uint128 delta);
    function terminalClose(
        address agent,
        address provider,
        uint256 epoch,
        uint128 cumulativeSpent,
        bytes calldata signature
    ) external returns (uint128 delta, uint128 refundedFloat);
    function rolloverEpochBucket(
        address agent,
        address provider,
        uint256 oldEpoch,
        uint128 oldCumulativeSpent,
        bytes calldata oldSignature,
        uint256 newEpoch,
        uint128 newAmount,
        uint32 newDuration
    ) external returns (uint128 delta, uint128 refundedFloat);
    function requestUnilateralClose(
        address agent,
        address provider,
        uint256 epoch,
        bytes32 sessionId,
        uint128 claimedSpent
    ) external;
    function submitMerchantVoucher(
        address provider,
        bytes32 sessionId,
        uint128 voucherAmount,
        bytes calldata signature
    ) external;
    function finalizeUnilateralClose(
        address agent,
        address provider,
        uint256 epoch,
        bytes32 sessionId
    ) external returns (uint128 providerPayout, uint128 agentRefund);
    function creditRelayerFee(address relayer, uint256 shardId, uint128 amount) external;
    function claimRelayerCredits(uint256[] calldata shardIds) external returns (uint128 totalPayout);

    function getVaultBalance(address agent) external view returns (uint128);
    function getEpochBucket(
        address agent,
        address provider,
        uint256 epoch
    ) external view returns (EpochBucket memory);
    function getAgentChallenge(
        address agent,
        bytes32 sessionId
    ) external view returns (UnilateralChallenge memory);
    function getMerchantSettlement(
        address provider,
        bytes32 sessionId
    ) external view returns (uint128);
    function getRelayerGasCredits(
        address relayer,
        uint256 shardId
    ) external view returns (uint128);
}
