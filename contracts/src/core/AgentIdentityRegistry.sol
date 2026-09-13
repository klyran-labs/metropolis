// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC6551Registry } from "../interfaces/IERC6551.sol";

/**
 * @title AgentIdentityRegistry
 * @notice Canonical ERC-6551 Registry for autonomous agent Token Bound Accounts on Monad.
 */
contract AgentIdentityRegistry is IERC6551Registry {
    error InitializationFailed();

    function createAccount(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) external override returns (address) {
        bytes memory code = _creationCode(implementation, chainId, tokenContract, tokenId);
        bytes32 combinedSalt = keccak256(abi.encode(salt, chainId, tokenContract, tokenId));

        address computed = account(implementation, salt, chainId, tokenContract, tokenId);
        if (computed.code.length != 0) {
            return computed;
        }

        address deployed;
        assembly {
            deployed := create2(0, add(code, 0x20), mload(code), combinedSalt)
        }

        if (deployed == address(0)) revert InitializationFailed();

        emit ERC6551AccountCreated(
            deployed,
            implementation,
            salt,
            chainId,
            tokenContract,
            tokenId
        );

        return deployed;
    }

    function account(
        address implementation,
        bytes32 salt,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) public view override returns (address) {
        bytes memory code = _creationCode(implementation, chainId, tokenContract, tokenId);
        bytes32 combinedSalt = keccak256(abi.encode(salt, chainId, tokenContract, tokenId));

        bytes32 hash = keccak256(
            abi.encodePacked(
                bytes1(0xff),
                address(this),
                combinedSalt,
                keccak256(code)
            )
        );

        return address(uint160(uint256(hash)));
    }

    function _creationCode(
        address implementation,
        uint256 chainId,
        address tokenContract,
        uint256 tokenId
    ) internal pure returns (bytes memory) {
        // Minimal proxy bytecode that forwards calls to implementation and appends ERC-6551 context
        bytes memory context = abi.encode(chainId, tokenContract, tokenId);
        return abi.encodePacked(
            hex"3d60ad80600a3d3981f3363d3d373d3d3d363d73",
            implementation,
            hex"5af43d82803e903d91602b57fd5bf3",
            context
        );
    }
}
