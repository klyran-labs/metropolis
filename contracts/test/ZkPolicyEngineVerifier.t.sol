// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {ZkPolicyEngineVerifier} from "../src/core/ZkPolicyEngineVerifier.sol";
import {IZkPolicyEngineVerifier} from "../src/interfaces/IZkPolicyEngineVerifier.sol";

contract ZkPolicyEngineVerifierTest is Test {
    ZkPolicyEngineVerifier internal verifier;

    address internal agent = address(0xAA11);
    bytes32 internal commitment = keccak256("MAX_10_USDC_PER_TX_WHITELIST_DEX_V1");
    bytes32 internal whitelistRoot = keccak256("MERKLE_ROOT_APPROVED_MERCHANTS");

    function setUp() public {
        vm.warp(10000);
        verifier = new ZkPolicyEngineVerifier();

        vm.prank(agent);
        verifier.registerPolicyCommitment(agent, commitment);
    }

    function _createProof(bytes32 nullifier, bytes32 comm, uint256 epoch) internal pure returns (IZkPolicyEngineVerifier.ZkSpendProof memory) {
        uint256[2] memory a = [uint256(1), uint256(2)];
        uint256[2][2] memory b = [[uint256(3), uint256(4)], [uint256(5), uint256(6)]];
        uint256[2] memory c = [uint256(7), uint256(8)];

        return IZkPolicyEngineVerifier.ZkSpendProof({
            policyCommitment: comm,
            merchantWhitelistRoot: keccak256("WHITELIST"),
            nullifier: nullifier,
            epochWindow: epoch,
            a: a,
            b: b,
            c: c
        });
    }

    function test_ValidZkSpendProofAdmitted() public view {
        bytes32 nullifier = keccak256("SECRET_NONCE_1001");
        IZkPolicyEngineVerifier.ZkSpendProof memory proof = _createProof(nullifier, commitment, block.timestamp + 3600);

        (bool allowed, uint8 reason) = verifier.verifyZkSpendProof(agent, proof);
        assertTrue(allowed);
        assertEq(reason, 0); // ERR_NONE
    }

    function test_RecordZkSpendConsumesNullifier() public {
        bytes32 nullifier = keccak256("SECRET_NONCE_1002");
        IZkPolicyEngineVerifier.ZkSpendProof memory proof = _createProof(nullifier, commitment, block.timestamp + 3600);

        assertFalse(verifier.isNullifierSpent(nullifier));

        bool recorded = verifier.recordZkSpend(agent, proof);
        assertTrue(recorded);
        assertTrue(verifier.isNullifierSpent(nullifier));

        // Re-verifying with same nullifier must return ERR_NONCE_REUSED (8)
        (bool allowed, uint8 reason) = verifier.verifyZkSpendProof(agent, proof);
        assertFalse(allowed);
        assertEq(reason, 8); // ERR_NONCE_REUSED

        // Re-recording must revert
        vm.expectRevert(ZkPolicyEngineVerifier.NullifierAlreadySpent.selector);
        verifier.recordZkSpend(agent, proof);
    }

    function test_CommitmentMismatchRejected() public {
        bytes32 rogueCommitment = keccak256("MAX_1000000_USDC_PER_TX");
        bytes32 nullifier = keccak256("SECRET_NONCE_1003");
        IZkPolicyEngineVerifier.ZkSpendProof memory proof = _createProof(nullifier, rogueCommitment, block.timestamp + 3600);

        (bool allowed, uint8 reason) = verifier.verifyZkSpendProof(agent, proof);
        assertFalse(allowed);
        assertEq(reason, 9); // ERR_SIGNATURE_INVALID

        vm.expectRevert(ZkPolicyEngineVerifier.CommitmentMismatch.selector);
        verifier.recordZkSpend(agent, proof);
    }

    function test_ExpiredEpochRejected() public {
        bytes32 nullifier = keccak256("SECRET_NONCE_1004");
        // Epoch window in the past
        IZkPolicyEngineVerifier.ZkSpendProof memory proof = _createProof(nullifier, commitment, block.timestamp - 10);

        (bool allowed, uint8 reason) = verifier.verifyZkSpendProof(agent, proof);
        assertFalse(allowed);
        assertEq(reason, 7); // ERR_EXPIRED
    }
}
