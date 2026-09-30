// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AuditAnchorRegistry} from "../src/core/AuditAnchorRegistry.sol";
import {IAuditAnchorRegistry} from "../src/interfaces/IAuditAnchorRegistry.sol";

contract AuditAnchorRegistryTest is Test {
    AuditAnchorRegistry public registry;
    address public owner;
    address public notarizer;
    address public outsider;

    function setUp() public {
        owner = address(this);
        notarizer = makeAddr("notarizer");
        outsider = makeAddr("outsider");

        registry = new AuditAnchorRegistry();
        registry.setNotarizer(notarizer, true);
    }

    function test_RecordAnchor_Success() public {
        bytes32 sampleRoot = keccak256("batch-merkle-root-1");
        vm.prank(notarizer);
        uint256 anchorId = registry.recordAnchor(sampleRoot, 100, 150, 51);

        assertEq(anchorId, 0);
        assertEq(registry.totalAnchors(), 1);

        IAuditAnchorRegistry.AnchorRecord memory record = registry.getAnchor(0);
        assertEq(record.merkleRoot, sampleRoot);
        assertEq(record.batchStart, 100);
        assertEq(record.batchEnd, 150);
        assertEq(record.count, 51);
        assertEq(record.notarizer, notarizer);
    }

    function test_RecordAnchor_RevertUnauthorized() public {
        bytes32 sampleRoot = keccak256("unauthorized-root");
        vm.prank(outsider);
        vm.expectRevert(AuditAnchorRegistry.Unauthorized.selector);
        registry.recordAnchor(sampleRoot, 1, 10, 10);
    }

    function test_VerifyInclusion_ValidProof() public {
        // Build 2-leaf Merkle tree:
        // leaf0 = keccak256("leaf0")
        // leaf1 = keccak256("leaf1")
        // root = keccak256(leaf0, leaf1)
        bytes32 leaf0 = keccak256("leaf0");
        bytes32 leaf1 = keccak256("leaf1");
        bytes32 root = keccak256(abi.encodePacked(leaf0, leaf1));

        bytes32[] memory proof0 = new bytes32[](1);
        proof0[0] = leaf1;

        bool valid0 = registry.verifyInclusion(root, leaf0, proof0, 0);
        assertTrue(valid0);

        bytes32[] memory proof1 = new bytes32[](1);
        proof1[0] = leaf0;

        bool valid1 = registry.verifyInclusion(root, leaf1, proof1, 1);
        assertTrue(valid1);

        // Corrupted proof should fail
        proof0[0] = keccak256("corrupted");
        bool invalid = registry.verifyInclusion(root, leaf0, proof0, 0);
        assertFalse(invalid);
    }
}
