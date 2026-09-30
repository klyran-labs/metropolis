// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {EnclaveAttestationRegistry} from "../src/core/EnclaveAttestationRegistry.sol";
import {IEnclaveAttestationRegistry} from "../src/interfaces/IEnclaveAttestationRegistry.sol";

contract EnclaveAttestationRegistryTest is Test {
    EnclaveAttestationRegistry internal registry;

    uint256 internal ownerPk = 0xA11CE;
    address internal owner;

    uint256 internal verifierPk = 0xB0B;
    address internal verifier;

    address internal agent = address(0xCAFE);

    bytes32 internal pcr0 = keccak256("PCR0_AWS_NITRO_V1");
    bytes32 internal pcr1 = keccak256("PCR1_KERNEL_BOOT");
    bytes32 internal pcr2 = keccak256("PCR2_APPLICATION_BINARY");

    function setUp() public {
        owner = vm.addr(ownerPk);
        verifier = vm.addr(verifierPk);

        vm.prank(owner);
        registry = new EnclaveAttestationRegistry();

        vm.prank(owner);
        registry.setVerifier(verifier, true);
    }

    function test_DirectVerifierRegistration() public {
        assertFalse(registry.isEnclaveValid(agent));

        vm.prank(verifier);
        registry.registerEnclave(agent, pcr0, pcr1, 3600);

        assertTrue(registry.isEnclaveValid(agent));
        IEnclaveAttestationRegistry.EnclaveRecord memory rec = registry.getEnclaveRecord(agent);
        assertEq(rec.mrenclave, pcr0);
        assertEq(rec.reportDataHash, pcr1);
        assertFalse(rec.revoked);
    }

    function test_CryptographicAttestationProof() public {
        uint64 duration = 7200; // 2 hours

        bytes32 messageHash = keccak256(abi.encode(agent, pcr0, pcr1, pcr2, duration, block.chainid));
        bytes32 ethSignedDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));

        (uint8 v, bytes32 r, bytes32 s) = vm.sign(verifierPk, ethSignedDigest);
        bytes memory signature = abi.encodePacked(r, s, v);

        IEnclaveAttestationRegistry.AttestationProof memory proof = IEnclaveAttestationRegistry.AttestationProof({
            pcr0: pcr0,
            pcr1: pcr1,
            pcr2: pcr2,
            validDurationSeconds: duration,
            signature: signature
        });

        // Anyone can submit the valid cryptographic proof
        address relayer = address(0x999);
        vm.prank(relayer);
        registry.verifyAndRegisterAttestation(agent, proof);

        assertTrue(registry.isEnclaveValid(agent));
    }

    function test_AttestationExpiration() public {
        vm.prank(verifier);
        registry.registerEnclave(agent, pcr0, pcr1, 3600);
        assertTrue(registry.isEnclaveValid(agent));

        // Warp past expiration
        vm.warp(block.timestamp + 3601);
        assertFalse(registry.isEnclaveValid(agent));
    }

    function test_RevokeEnclave() public {
        vm.prank(verifier);
        registry.registerEnclave(agent, pcr0, pcr1, 3600);
        assertTrue(registry.isEnclaveValid(agent));

        vm.prank(verifier);
        registry.revokeEnclave(agent);
        assertFalse(registry.isEnclaveValid(agent));
    }

    function test_UnauthorizedVerifierReverts() public {
        address rogue = address(0xBAD);
        vm.prank(rogue);
        vm.expectRevert(EnclaveAttestationRegistry.Unauthorized.selector);
        registry.registerEnclave(agent, pcr0, pcr1, 3600);
    }
}
