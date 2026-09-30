// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CalldataPolicyGuard} from "../src/core/CalldataPolicyGuard.sol";
import {ICalldataPolicyGuard} from "../src/interfaces/ICalldataPolicyGuard.sol";

contract CalldataPolicyGuardTest is Test {
    CalldataPolicyGuard public guard;
    address public admin = address(0xAA11);
    address public agent = address(0xBB22);
    address public merchant = address(0xCC33);
    address public attacker = address(0xDEAD);

    bytes4 public constant TRANSFER_SELECTOR = 0xa9059cbb; // transfer(address,uint256)
    bytes4 public constant APPROVE_SELECTOR = 0x095ea7b3;  // approve(address,uint256)

    function setUp() public {
        vm.prank(admin);
        guard = new CalldataPolicyGuard();

        vm.prank(admin);
        guard.setAgentAdmin(agent, admin);
    }

    function test_EvaluateCalldata_AllowedSelector_Success() public {
        // Configure policy: allow transfer, enforce recipient = agent or admin
        ICalldataPolicyGuard.SelectorPolicy memory policy = ICalldataPolicyGuard.SelectorPolicy({
            allowed: true,
            enforceRecipient: true,
            recipientParamOffset: 4, // 4 bytes for selector, then recipient address word
            enforceMaxSlippage: false,
            maxSlippageBps: 0,
            maxValue: 10 ether
        });

        vm.prank(admin);
        guard.setSelectorPolicy(agent, TRANSFER_SELECTOR, policy);

        // Calldata: transfer(admin, 100)
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, admin, 100);

        (bool allowed, uint8 reason) = guard.evaluateCalldata(agent, merchant, 0, data);
        assertTrue(allowed);
        assertEq(reason, 0);
    }

    function test_EvaluateCalldata_ProhibitedSelector_Denied() public {
        // By default APPROVE_SELECTOR is not allowed
        bytes memory data = abi.encodeWithSelector(APPROVE_SELECTOR, attacker, type(uint256).max);

        (bool allowed, uint8 reason) = guard.evaluateCalldata(agent, merchant, 0, data);
        assertFalse(allowed);
        assertEq(reason, 3); // ERR_MERCHANT_NOT_WHITELISTED
    }

    function test_EvaluateCalldata_RecipientMismatch_Denied() public {
        ICalldataPolicyGuard.SelectorPolicy memory policy = ICalldataPolicyGuard.SelectorPolicy({
            allowed: true,
            enforceRecipient: true,
            recipientParamOffset: 4,
            enforceMaxSlippage: false,
            maxSlippageBps: 0,
            maxValue: 10 ether
        });

        vm.prank(admin);
        guard.setSelectorPolicy(agent, TRANSFER_SELECTOR, policy);

        // Calldata: transfer to unauthorized attacker
        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, attacker, 100);

        (bool allowed, uint8 reason) = guard.evaluateCalldata(agent, merchant, 0, data);
        assertFalse(allowed);
        assertEq(reason, 3);
    }

    function test_EvaluateCalldata_ValueCeilingExceeded_Denied() public {
        ICalldataPolicyGuard.SelectorPolicy memory policy = ICalldataPolicyGuard.SelectorPolicy({
            allowed: true,
            enforceRecipient: false,
            recipientParamOffset: 0,
            enforceMaxSlippage: false,
            maxSlippageBps: 0,
            maxValue: 1 ether
        });

        vm.prank(admin);
        guard.setSelectorPolicy(agent, TRANSFER_SELECTOR, policy);

        bytes memory data = abi.encodeWithSelector(TRANSFER_SELECTOR, agent, 100);

        // msgValue exceeds 1 ether limit
        (bool allowed, uint8 reason) = guard.evaluateCalldata(agent, merchant, 2 ether, data);
        assertFalse(allowed);
        assertEq(reason, 1); // ERR_EXCEEDS_MAX_TX
    }

    function test_UnauthorizedCaller_CannotConfigurePolicy() public {
        ICalldataPolicyGuard.SelectorPolicy memory policy = ICalldataPolicyGuard.SelectorPolicy({
            allowed: true,
            enforceRecipient: false,
            recipientParamOffset: 0,
            enforceMaxSlippage: false,
            maxSlippageBps: 0,
            maxValue: 10 ether
        });

        vm.prank(attacker);
        vm.expectRevert(ICalldataPolicyGuard.Unauthorized.selector);
        guard.setSelectorPolicy(agent, TRANSFER_SELECTOR, policy);
    }
}
