// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IOmnichainSpendValidator} from "../interfaces/IOmnichainSpendValidator.sol";
import {IPolicyEngine} from "../interfaces/IPolicyEngine.sol";

/**
 * @title OmnichainSpendValidator
 * @notice Centralized Risk Engine on Monad that authorizes remote agent spends across EVM chains.
 * @dev Emits verifiable cryptographic spend permits that can be settled on Base, Arbitrum, or Ethereum L1.
 */
contract OmnichainSpendValidator is IOmnichainSpendValidator {
    IPolicyEngine public immutable policyEngine;
    address public immutable validatorSigner;
    address public immutable owner;

    uint256 public nextPolicyNonce;
    mapping(bytes32 => bool) public override isPermitRedeemed;

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert Unauthorized();
    }

    constructor(address _policyEngine, address _validatorSigner) {
        if (_policyEngine == address(0) || _validatorSigner == address(0)) revert ZeroAddress();
        policyEngine = IPolicyEngine(_policyEngine);
        validatorSigner = _validatorSigner;
        owner = msg.sender;
    }

    function hashPermit(CrossChainSpendPermit memory permit) public pure returns (bytes32) {
        return keccak256(
            abi.encode(
                permit.agent,
                permit.targetChainId,
                permit.targetMerchant,
                permit.targetToken,
                permit.amount,
                permit.validUntil,
                permit.monadPolicyBlock,
                permit.monadPolicyNonce,
                permit.capabilityHash
            )
        );
    }

    function issueCrossChainPermit(
        address agent,
        uint256 targetChainId,
        address targetMerchant,
        address targetToken,
        uint256 amount,
        uint256 validDurationSeconds,
        bytes32 capabilityHash
    ) external override returns (CrossChainSpendPermit memory permit, bytes32 permitHash) {
        uint256 nonce = ++nextPolicyNonce;
        uint256 validUntil = block.timestamp + validDurationSeconds;

        // Atomic policy evaluation against Monad spend limits
        IPolicyEngine.SpendRequest memory req = IPolicyEngine.SpendRequest({
            agent: agent,
            merchant: targetMerchant,
            amount: amount,
            category: bytes32(targetChainId),
            timestamp: block.timestamp,
            deadline: validUntil,
            nonce: nonce
        });

        IPolicyEngine.PolicyDecision memory decision = policyEngine.evaluateAndSpend(req);
        if (!decision.allowed) {
            revert PolicyEvaluationFailed(uint8(decision.reasonCode));
        }

        permit = CrossChainSpendPermit({
            agent: agent,
            targetChainId: targetChainId,
            targetMerchant: targetMerchant,
            targetToken: targetToken,
            amount: amount,
            validUntil: validUntil,
            monadPolicyBlock: block.number,
            monadPolicyNonce: nonce,
            capabilityHash: capabilityHash
        });

        permitHash = hashPermit(permit);

        emit CrossChainPermitIssued(
            agent,
            targetChainId,
            targetMerchant,
            amount,
            nonce,
            permitHash
        );

        return (permit, permitHash);
    }

    function verifyAndRedeemPermit(
        CrossChainSpendPermit calldata permit,
        bytes calldata validatorSignature
    ) external override returns (bool valid) {
        if (block.timestamp > permit.validUntil) {
            revert PermitExpired();
        }

        bytes32 permitHash = hashPermit(permit);
        if (isPermitRedeemed[permitHash]) {
            revert PermitAlreadyRedeemed();
        }

        // Cryptographic signature verification over permit digest
        bytes32 ethSignedDigest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", permitHash)
        );

        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(validatorSignature.offset)
            s := calldataload(add(validatorSignature.offset, 32))
            v := byte(0, calldataload(add(validatorSignature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0 || (v != 27 && v != 28)) {
            revert Unauthorized();
        }

        address recovered = ecrecover(ethSignedDigest, v, r, s);
        if (recovered != validatorSigner && recovered != owner) {
            revert Unauthorized();
        }

        isPermitRedeemed[permitHash] = true;
        emit RemotePermitRedeemed(permitHash, permit.agent, permit.targetChainId);
        return true;
    }
}
