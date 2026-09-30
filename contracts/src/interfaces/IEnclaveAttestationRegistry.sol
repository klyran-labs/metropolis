// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IEnclaveAttestationRegistry {
    struct EnclaveRecord {
        bytes32 mrenclave;
        bytes32 reportDataHash;
        uint64 registeredAt;
        uint64 expiresAt;
        bool revoked;
    }

    struct AttestationProof {
        bytes32 pcr0;
        bytes32 pcr1;
        bytes32 pcr2;
        uint64 validDurationSeconds;
        bytes signature;
    }

    event EnclaveRegistered(address indexed agent, bytes32 indexed mrenclave, uint64 expiresAt);
    event EnclaveRevoked(address indexed agent);
    event VerifierUpdated(address indexed verifier, bool authorized);

    function setVerifier(address verifier, bool authorized) external;
    function registerEnclave(address agent, bytes32 mrenclave, bytes32 reportDataHash, uint64 validDurationSeconds) external;
    function verifyAndRegisterAttestation(address agent, AttestationProof calldata proof) external;
    function revokeEnclave(address agent) external;
    function isEnclaveValid(address agent) external view returns (bool);
    function getEnclaveRecord(address agent) external view returns (EnclaveRecord memory);
}
