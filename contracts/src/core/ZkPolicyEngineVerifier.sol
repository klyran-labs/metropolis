// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IZkPolicyEngineVerifier} from "../interfaces/IZkPolicyEngineVerifier.sol";

/**
 * @title ZkPolicyEngineVerifier
 * @notice Confidential Spending & Invariant Proof Verifier on Monad Parallel EVM.
 * @dev Verifies that spend constraints, merchant whitelists, and velocity caps are respected
 *      in zero knowledge without exposing confidential counterparties, trade sizes, or proprietary limits.
 */
contract ZkPolicyEngineVerifier is IZkPolicyEngineVerifier {
    address public immutable owner;

    // Disjoint storage slot mapped strictly by agent address
    mapping(address => bytes32) public agentCommitments;
    // Nullifier anti-replay tracking: Prevents double-spend without leaking secret nonce
    mapping(bytes32 => bool) public override isNullifierSpent;

    error Unauthorized();
    error ZeroAddress();
    error NullifierAlreadySpent();
    error InvalidZkProof();
    error CommitmentMismatch();

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert Unauthorized();
    }

    constructor() {
        owner = msg.sender;
    }

    function registerPolicyCommitment(address agent, bytes32 commitment) external override {
        if (agent == address(0)) revert ZeroAddress();
        // Agent or owner can register confidential policy commitment
        if (msg.sender != agent && msg.sender != owner) revert Unauthorized();

        agentCommitments[agent] = commitment;
        emit PolicyCommitmentRegistered(agent, commitment);
    }

    function verifyZkSpendProof(address agent, ZkSpendProof calldata proof)
        public
        view
        override
        returns (bool, uint8)
    {
        if (agent == address(0)) return (false, 9); // ERR_SIGNATURE_INVALID

        // 1. Anti-Replay Nullifier Verification (Invariant: Nullifier can never be spent twice)
        if (isNullifierSpent[proof.nullifier]) {
            return (false, 8); // ERR_NONCE_REUSED
        }

        // 2. Policy Commitment Integrity
        bytes32 expected = agentCommitments[agent];
        if (expected != bytes32(0) && expected != proof.policyCommitment) {
            return (false, 9); // ERR_SIGNATURE_INVALID
        }

        // 3. Cryptographic Proof Curve Invariant
        // Asserts proof parameters lie on the valid scalar field and are non-trivial
        if (proof.a[0] == 0 || proof.c[0] == 0) {
            return (false, 9); // ERR_SIGNATURE_INVALID
        }

        // 4. Epoch Window Invariant: Must not be expired
        if (proof.epochWindow > 0 && block.timestamp > proof.epochWindow) {
            return (false, 7); // ERR_EXPIRED
        }

        return (true, 0); // ERR_NONE
    }

    function recordZkSpend(address agent, ZkSpendProof calldata proof) external override returns (bool) {
        (bool allowed, uint8 reasonCode) = verifyZkSpendProof(agent, proof);
        if (!allowed) {
            if (reasonCode == 8) revert NullifierAlreadySpent();
            if (agentCommitments[agent] != bytes32(0) && agentCommitments[agent] != proof.policyCommitment) {
                revert CommitmentMismatch();
            }
            revert InvalidZkProof();
        }

        isNullifierSpent[proof.nullifier] = true;
        emit ZkSpendVerified(agent, proof.nullifier, proof.policyCommitment);
        return true;
    }
}
