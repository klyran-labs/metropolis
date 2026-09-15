// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title EnclaveAttestationRegistry
 * @notice Onchain Hardware Attestation Registry for Sealed Agent Enclaves (Intel SGX / AWS Nitro).
 * @dev Verifies that agent signing keys are generated and sealed within an untampered TEE runtime.
 */
contract EnclaveAttestationRegistry {
    address public immutable owner;

    struct EnclaveRecord {
        bytes32 mrenclave;
        bytes32 reportDataHash;
        uint64 registeredAt;
        uint64 expiresAt;
        bool revoked;
    }

    // Disjoint storage slot mapped strictly by agent address
    mapping(address => EnclaveRecord) private _enclaves;
    mapping(address => bool) public authorizedVerifiers;

    event EnclaveRegistered(address indexed agent, bytes32 indexed mrenclave, uint64 expiresAt);
    event EnclaveRevoked(address indexed agent);
    event VerifierUpdated(address indexed verifier, bool authorized);

    error Unauthorized();
    error ZeroAddress();

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
