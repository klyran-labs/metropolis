// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

interface IZkPolicyEngineVerifier {
    struct ZkSpendProof {
        bytes32 policyCommitment;
        bytes32 merchantWhitelistRoot;
        bytes32 nullifier;
        uint256 epochWindow;
        uint256[2] a;
        uint256[2][2] b;
        uint256[2] c;
    }

    event ZkSpendVerified(address indexed agent, bytes32 indexed nullifier, bytes32 indexed policyCommitment);
    event PolicyCommitmentRegistered(address indexed agent, bytes32 indexed commitment);

    function registerPolicyCommitment(address agent, bytes32 commitment) external;
    function verifyZkSpendProof(address agent, ZkSpendProof calldata proof) external view returns (bool, uint8);
    function recordZkSpend(address agent, ZkSpendProof calldata proof) external returns (bool);
    function isNullifierSpent(bytes32 nullifier) external view returns (bool);
}
