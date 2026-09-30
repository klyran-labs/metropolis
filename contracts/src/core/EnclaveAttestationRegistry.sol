// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IEnclaveAttestationRegistry} from "../interfaces/IEnclaveAttestationRegistry.sol";

/**
 * @title EnclaveAttestationRegistry
 * @notice Onchain Hardware Attestation Registry for Sealed Agent Enclaves (Intel SGX / AWS Nitro).
 * @dev Verifies that agent signing keys are generated and sealed within an untampered TEE runtime.
 */
contract EnclaveAttestationRegistry is IEnclaveAttestationRegistry {
    address public immutable owner;

    // Disjoint storage slot mapped strictly by agent address
    mapping(address => EnclaveRecord) private _enclaves;
    mapping(address => bool) public authorizedVerifiers;

    error Unauthorized();
    error ZeroAddress();
    error InvalidProof();

    modifier onlyVerifier() {
        _checkVerifier();
        _;
    }

    function _checkVerifier() internal view {
        if (!authorizedVerifiers[msg.sender] && msg.sender != owner) revert Unauthorized();
    }

    constructor() {
        owner = msg.sender;
        authorizedVerifiers[msg.sender] = true;
    }

    function setVerifier(address verifier, bool authorized) external {
        if (msg.sender != owner) revert Unauthorized();
        if (verifier == address(0)) revert ZeroAddress();
        // forge-lint: disable-next-line(missing-events-access-control)
        authorizedVerifiers[verifier] = authorized;
        emit VerifierUpdated(verifier, authorized);
    }

    function registerEnclave(address agent, bytes32 mrenclave, bytes32 reportDataHash, uint64 validDurationSeconds)
        external
        onlyVerifier
    {
        if (agent == address(0)) revert ZeroAddress();

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowSec = uint64(block.timestamp);
        uint64 expiresAt = nowSec + validDurationSeconds;

        _enclaves[agent] = EnclaveRecord({
            mrenclave: mrenclave,
            reportDataHash: reportDataHash,
            registeredAt: nowSec,
            expiresAt: expiresAt,
            revoked: false
        });

        emit EnclaveRegistered(agent, mrenclave, expiresAt);
    }

    function verifyAndRegisterAttestation(address agent, AttestationProof calldata proof) external {
        if (agent == address(0)) revert ZeroAddress();
        if (proof.signature.length < 65) revert InvalidProof();

        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19Ethereum Signed Message:\n32",
                keccak256(abi.encode(agent, proof.pcr0, proof.pcr1, proof.pcr2, proof.validDurationSeconds, block.chainid))
            )
        );

        bytes32 r;
        bytes32 s;
        uint8 v;
        bytes memory sig = proof.signature;
        assembly {
            r := mload(add(sig, 32))
            s := mload(add(sig, 64))
            v := byte(0, mload(add(sig, 96)))
        }
        if (v < 27) v += 27;
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || (!authorizedVerifiers[signer] && signer != owner)) revert Unauthorized();

        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 nowSec = uint64(block.timestamp);
        uint64 expiresAt = nowSec + proof.validDurationSeconds;

        _enclaves[agent] = EnclaveRecord({
            mrenclave: proof.pcr0,
            reportDataHash: proof.pcr1,
            registeredAt: nowSec,
            expiresAt: expiresAt,
            revoked: false
        });

        emit EnclaveRegistered(agent, proof.pcr0, expiresAt);
    }

    function revokeEnclave(address agent) external onlyVerifier {
        _enclaves[agent].revoked = true;
        emit EnclaveRevoked(agent);
    }

    function isEnclaveValid(address agent) external view returns (bool) {
        EnclaveRecord memory rec = _enclaves[agent];
        if (rec.mrenclave == bytes32(0)) return false;
        if (rec.revoked) return false;
        if (block.timestamp > rec.expiresAt) return false;
        return true;
    }

    function getEnclaveRecord(address agent) external view returns (EnclaveRecord memory) {
        return _enclaves[agent];
    }
}
