// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title ICalldataPolicyGuard
 * @notice High-performance argument-level calldata policy evaluator & ERC-7730 clear-signing verification on Monad.
 */
interface ICalldataPolicyGuard {
    struct SelectorPolicy {
        bool allowed;
        bool enforceRecipient;
        uint16 recipientParamOffset; // byte offset of recipient address in calldata (e.g. 4 for transfer, 36 for swap)
        bool enforceMaxSlippage;
        uint16 maxSlippageBps; // e.g. 100 = 1.00% max slippage
        uint256 maxValue; // max native or token value passed in call
    }

    event SelectorPolicyUpdated(
        address indexed agent,
        bytes4 indexed selector,
        bool allowed,
        bool enforceRecipient,
        uint16 maxSlippageBps,
        uint256 maxValue
    );

    event CalldataEvaluated(
        address indexed agent,
        address indexed target,
        bytes4 indexed selector,
        bool passed,
        uint8 reasonCode
    );

    error SelectorProhibited(bytes4 selector);
    error CalldataTooShort(uint256 actual, uint256 minimum);
    error RecipientMismatch(address expected, address actual);
    error SlippageExceeded(uint16 actualBps, uint16 maxBps);
    error CallValueExceeded(uint256 actual, uint256 max);
    error Unauthorized();
    error ZeroAddress();

    function setSelectorPolicy(
        address agent,
        bytes4 selector,
        SelectorPolicy calldata policy
    ) external;

    function evaluateCalldata(
        address agent,
        address target,
        uint256 msgValue,
        bytes calldata data
    ) external returns (bool allowed, uint8 reasonCode);

    function getSelectorPolicy(address agent, bytes4 selector)
        external
        view
        returns (SelectorPolicy memory);
}
