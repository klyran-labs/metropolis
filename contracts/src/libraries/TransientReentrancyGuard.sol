// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/**
 * @title TransientReentrancyGuard
 * @notice Ultra-low-overhead reentrancy protection utilizing EVM Cancun/Prague transient storage (tstore/tload).
 * @dev On Monad (Parallel EVM), transient storage touches zero persistent slots, eliminating thread write-lock contention.
 */
abstract contract TransientReentrancyGuard {
    // keccak256("agentguard.transient.reentrancy.guard")
    bytes32 private constant REENTRANCY_GUARD_SLOT = 0x33405f044d695f91cc74e6673d88c3918e07e58cf49baad92b9b1d327e78edf1;

    error ReentrancyGuardReentrantCall();

    modifier nonReentrant() {
        _enterNonReentrant();
        _;
        _exitNonReentrant();
    }

    function _enterNonReentrant() internal {
        assembly {
            if tload(REENTRANCY_GUARD_SLOT) {
                // Revert with ReentrancyGuardReentrantCall()
                mstore(0x00, 0x3ee5aeb5)
                revert(0x1c, 0x04)
            }
            tstore(REENTRANCY_GUARD_SLOT, 1)
        }
    }

    function _exitNonReentrant() internal {
        assembly {
            tstore(REENTRANCY_GUARD_SLOT, 0)
        }
    }
}
