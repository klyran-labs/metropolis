// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { IERC6551Account } from "../interfaces/IERC6551.sol";
import { IERC1271 } from "../interfaces/IERC1271.sol";

interface IERC721Minimal {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/**
 * @title AgentAccount
 * @notice ERC-6551 Token Bound Account implementation representing an autonomous agent identity passport.
 * @dev The account is owned by the current holder of the agent NFT. It natively implements ERC-1271.
 */
contract AgentAccount is IERC6551Account, IERC1271 {
    uint256 private _state;

    receive() external payable {}

    function execute(address to, uint256 value, bytes calldata data) external payable returns (bytes memory) {
        require(msg.sender == owner(), "Not token owner");
        _state++;
        (bool success, bytes memory result) = to.call{value: value}(data);
        require(success, "Execution failed");
        return result;
    }

    function token() public view override returns (uint256 chainId, address tokenContract, uint256 tokenId) {
        bytes memory footer = new bytes(0x60);
        assembly {
            // Read context parameters appended to contract bytecode or deployment context
            extcodecopy(address(), add(footer, 0x20), sub(extcodesize(address()), 0x60), 0x60)
        }
        return abi.decode(footer, (uint256, address, uint256));
    }

    function owner() public view returns (address) {
        (uint256 chainId, address tokenContract, uint256 tokenId) = token();
        if (chainId != block.chainid || tokenContract == address(0)) return address(0);
        return IERC721Minimal(tokenContract).ownerOf(tokenId);
    }

    function state() external view override returns (uint256) {
        return _state;
    }

    function isValidSigner(address signer, bytes calldata) external view override returns (bytes4) {
        if (signer == owner()) {
            return IERC6551Account.isValidSigner.selector;
        }
        return bytes4(0);
    }

    function isValidSignature(bytes32, bytes calldata) external view override returns (bytes4) {
        if (msg.sender == owner()) {
            return IERC1271.isValidSignature.selector;
        }
        return bytes4(0);
    }
}
