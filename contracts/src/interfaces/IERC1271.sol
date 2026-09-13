// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IERC1271
 * @notice Standard signature validation method for contracts (ERC-1271).
 */
interface IERC1271 {
    /**
     * @notice Should return whether the signature provided is valid for the provided hash
     * @param hash      Hash of the data to be signed
     * @param signature Signature byte array associated with hash
     * @return magicValue The bytes4 magic value 0x1626ba7e when function passes.
     */
    function isValidSignature(bytes32 hash, bytes calldata signature) external view returns (bytes4 magicValue);
}
