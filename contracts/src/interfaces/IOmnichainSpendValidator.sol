// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IOmnichainSpendValidator
 * @notice Cross-Chain Spend Verification & Permit Issuance using Monad as Central Risk Co-Processor.
 */
interface IOmnichainSpendValidator {
    struct CrossChainSpendPermit {
        address agent;
        uint256 targetChainId;
        address targetMerchant;
        address targetToken;
        uint256 amount;
        uint256 validUntil;
        uint256 monadPolicyBlock;
        uint256 monadPolicyNonce;
        bytes32 capabilityHash;
    }

    event CrossChainPermitIssued(
        address indexed agent,
        uint256 indexed targetChainId,
        address indexed targetMerchant,
        uint256 amount,
        uint256 monadPolicyNonce,
        bytes32 permitHash
    );

    event RemotePermitRedeemed(bytes32 indexed permitHash, address indexed agent, uint256 targetChainId);

    error PermitExpired();
    error ChainIdMismatch(uint256 expected, uint256 actual);
    error PermitAlreadyRedeemed();
    error PolicyEvaluationFailed(uint8 reasonCode);
    error Unauthorized();
    error ZeroAddress();

    function issueCrossChainPermit(
        address agent,
        uint256 targetChainId,
        address targetMerchant,
        address targetToken,
        uint256 amount,
        uint256 validDurationSeconds,
        bytes32 capabilityHash
    ) external returns (CrossChainSpendPermit memory permit, bytes32 permitHash);

    function verifyAndRedeemPermit(
        CrossChainSpendPermit calldata permit,
        bytes calldata validatorSignature
    ) external returns (bool valid);

    function isPermitRedeemed(bytes32 permitHash) external view returns (bool);
}
