// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title IERC7579Module
 * @notice ERC-7579 standard interface for modular smart account extensions.
 */
interface IERC7579Module {
    function onInstall(bytes calldata data) external;
    function onUninstall(bytes calldata data) external;
    function isModuleType(uint256 moduleTypeId) external view returns (bool);
}

/**
 * @title IERC7579Hook
 * @notice ERC-7579 execution hook module interface (Module Type 4).
 */
interface IERC7579Hook is IERC7579Module {
    function preCheck(address msgSender, bytes calldata msgData) external returns (bytes memory hookData);
    function postCheck(bytes calldata hookData) external;
}

/**
 * @title IERC7579Validator
 * @notice ERC-7579 validation module interface (Module Type 1).
 */
interface IERC7579Validator is IERC7579Module {
    function validateUserOp(bytes32 userOpHash, bytes calldata signature) external view returns (uint256 validationData);
    function isValidSignatureWithSender(address sender, bytes32 hash, bytes calldata data) external view returns (bytes4);
}
