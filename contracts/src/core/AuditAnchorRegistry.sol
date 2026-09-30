// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IAuditAnchorRegistry} from "../interfaces/IAuditAnchorRegistry.sol";

/**
 * @title AuditAnchorRegistry
 * @notice Immutable Onchain Merkle Notarization Registry for AgentGuard.
 * @dev Records periodic Merkle state roots of the settlement outbox, enabling non-custodial
 * proof-of-audit verification on Monad Parallel EVM without disclosing raw prompt payloads.
 */
contract AuditAnchorRegistry is IAuditAnchorRegistry {
    address public immutable owner;
    mapping(address => bool) public authorizedNotarizers;
    AnchorRecord[] private _anchors;

    error Unauthorized();
    error InvalidMerkleRoot();
    error InvalidBatchBounds();
    error AnchorNotFound();

    event NotarizerUpdated(address indexed notarizer, bool authorized);

    modifier onlyNotarizer() {
        _checkNotarizer();
        _;
    }

    function _checkNotarizer() internal view {
        if (!authorizedNotarizers[msg.sender] && msg.sender != owner) revert Unauthorized();
    }

    constructor() {
        owner = msg.sender;
        authorizedNotarizers[msg.sender] = true;
    }

    function setNotarizer(address notarizer, bool authorized) external {
        if (msg.sender != owner) revert Unauthorized();
        authorizedNotarizers[notarizer] = authorized;
        emit NotarizerUpdated(notarizer, authorized);
    }

    /// @notice Records a cryptographic Merkle root of settled outbox records.
    function recordAnchor(
        bytes32 merkleRoot,
        uint256 batchStart,
        uint256 batchEnd,
        uint256 count
    ) external override onlyNotarizer returns (uint256 anchorId) {
        if (merkleRoot == bytes32(0)) revert InvalidMerkleRoot();
        if (count == 0 || batchEnd < batchStart) revert InvalidBatchBounds();

        anchorId = _anchors.length;
        _anchors.push(
            AnchorRecord({
                merkleRoot: merkleRoot,
                batchStart: batchStart,
                batchEnd: batchEnd,
                count: count,
                timestamp: block.timestamp,
                notarizer: msg.sender
            })
        );

        emit AuditBatchAnchored(anchorId, merkleRoot, batchStart, batchEnd, count, msg.sender);
    }

    /// @notice Returns the total count of recorded audit anchors.
    function totalAnchors() external view override returns (uint256) {
        return _anchors.length;
    }

    /// @notice Retrieves a specific anchor record by ID.
    function getAnchor(uint256 anchorId) external view override returns (AnchorRecord memory) {
        if (anchorId >= _anchors.length) revert AnchorNotFound();
        return _anchors[anchorId];
    }

    /// @notice Verifies a cryptographic Merkle inclusion proof against a recorded root.
    function verifyInclusion(
        bytes32 root,
        bytes32 leaf,
        bytes32[] calldata proof,
        uint256 index
    ) external pure override returns (bool) {
        bytes32 computedHash = leaf;
        uint256 currentIdx = index;

        for (uint256 i = 0; i < proof.length; ++i) {
            bytes32 proofElement = proof[i];
            if (currentIdx % 2 == 0) {
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
            currentIdx = currentIdx / 2;
        }

        return computedHash == root;
    }
}
