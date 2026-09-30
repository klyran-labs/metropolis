// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IAuditAnchorRegistry
 * @notice Cryptographic Merkle audit notarization registry for AI agent fleets on Monad.
 * @dev Records immutable Merkle roots of settled payment outbox records for SOC2/ISO/MiCA compliance.
 */
interface IAuditAnchorRegistry {
    struct AnchorRecord {
        bytes32 merkleRoot;
        uint256 batchStart;
        uint256 batchEnd;
        uint256 count;
        uint256 timestamp;
        address notarizer;
    }

    event AuditBatchAnchored(
        uint256 indexed anchorId,
        bytes32 indexed merkleRoot,
        uint256 batchStart,
        uint256 batchEnd,
        uint256 count,
        address indexed notarizer
    );

    function recordAnchor(
        bytes32 merkleRoot,
        uint256 batchStart,
        uint256 batchEnd,
        uint256 count
    ) external returns (uint256 anchorId);

    function getAnchor(uint256 anchorId) external view returns (AnchorRecord memory);

    function totalAnchors() external view returns (uint256);

    function verifyInclusion(
        bytes32 root,
        bytes32 leaf,
        bytes32[] calldata proof,
        uint256 index
    ) external pure returns (bool);
}
