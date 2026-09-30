// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {QuarantineController} from "../src/core/QuarantineController.sol";
import {IQuarantineController} from "../src/interfaces/IQuarantineController.sol";

contract QuarantineControllerTest is Test {
    QuarantineController public controller;
    address public admin = address(0xAA11);
    address public agent = address(0xBB22);
    address public attacker = address(0xDEAD);

    function setUp() public {
        vm.prank(admin);
        controller = new QuarantineController();

        vm.prank(admin);
        controller.setAgentAdmin(agent, admin);
    }

    function test_DefaultStateIsNominal() public view {
        IQuarantineController.QuarantineState memory state = controller.getQuarantineState(agent);
        assertEq(uint8(state.tier), uint8(IQuarantineController.QuarantineTier.NOMINAL));
        assertEq(state.throttleBps, 10000);
    }

    function test_ElevatedThrottlesTo50Percent() public {
        vm.prank(admin);
        controller.updateQuarantineTier(agent, IQuarantineController.QuarantineTier.ELEVATED, 250); // Z = 2.50

        (uint256 allowed, IQuarantineController.QuarantineTier tier) = controller.applyThrottle(agent, 100 ether);
        assertEq(uint8(tier), uint8(IQuarantineController.QuarantineTier.ELEVATED));
        assertEq(allowed, 50 ether); // 50%
    }

    function test_QuorumRequiredThrottlesTo20Percent() public {
        vm.prank(admin);
        controller.updateQuarantineTier(agent, IQuarantineController.QuarantineTier.QUORUM_REQUIRED, 400); // Z = 4.00

        (uint256 allowed, IQuarantineController.QuarantineTier tier) = controller.applyThrottle(agent, 100 ether);
        assertEq(uint8(tier), uint8(IQuarantineController.QuarantineTier.QUORUM_REQUIRED));
        assertEq(allowed, 20 ether); // 20%
    }

    function test_ByzantineHaltBlocksAll() public {
        vm.prank(admin);
        controller.updateQuarantineTier(agent, IQuarantineController.QuarantineTier.BYZANTINE_HALTED, 550); // Z = 5.50

        (uint256 allowed, IQuarantineController.QuarantineTier tier) = controller.applyThrottle(agent, 100 ether);
        assertEq(uint8(tier), uint8(IQuarantineController.QuarantineTier.BYZANTINE_HALTED));
        assertEq(allowed, 0); // 0%
    }

    function test_ElevatedAutoHealsToNominalAfterWindow() public {
        vm.prank(admin);
        controller.updateQuarantineTier(agent, IQuarantineController.QuarantineTier.ELEVATED, 280);

        // Before healing window
        (uint256 beforeHeal, ) = controller.applyThrottle(agent, 100 ether);
        assertEq(beforeHeal, 50 ether);

        // Advance 31 minutes (> 1800s healing window)
        vm.warp(block.timestamp + 1860);

        (uint256 afterHeal, IQuarantineController.QuarantineTier tier) = controller.applyThrottle(agent, 100 ether);
        assertEq(uint8(tier), uint8(IQuarantineController.QuarantineTier.NOMINAL));
        assertEq(afterHeal, 100 ether); // Restored to 100%
    }

    function test_UnauthorizedCallerCannotUpdateTier() public {
        vm.prank(attacker);
        vm.expectRevert(IQuarantineController.Unauthorized.selector);
        controller.updateQuarantineTier(agent, IQuarantineController.QuarantineTier.BYZANTINE_HALTED, 900);
    }
}
