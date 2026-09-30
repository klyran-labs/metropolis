// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {YieldFloatSweeper} from "../src/core/YieldFloatSweeper.sol";
import {IYieldFloatSweeper} from "../src/interfaces/IYieldFloatSweeper.sol";

contract YieldFloatSweeperTest is Test {
    YieldFloatSweeper public sweeper;
    address public mockVault = address(0x7777);

    function setUp() public {
        sweeper = new YieldFloatSweeper(mockVault);
        vm.deal(address(this), 100 ether);
    }

    function test_SweepIdleFloat_Maintains20PercentBuffer() public {
        // Send 100 MON to sweeper
        (bool sent,) = address(sweeper).call{value: 100 ether}("");
        assertTrue(sent);

        uint256 swept = sweeper.sweepIdleFloat();
        assertEq(swept, 80 ether); // 80% swept into Tier 1 yield
        assertEq(address(sweeper).balance, 100 ether); // Full physical balance held in contract
        assertEq(sweeper.tier1YieldBalance(), 80 ether);

        IYieldFloatSweeper.FloatReserveState memory state = sweeper.getReserveState();
        assertEq(state.totalFloat, 180 ether);
        assertEq(state.tier0InstantBuffer, 100 ether);
        assertEq(state.tier1YieldBalance, 80 ether);
        assertEq(state.tier0BufferBps, 2000);
        assertEq(state.apyBps, 520);
    }

    function test_ReplenishTier0Buffer_JustInTime() public {
        (bool sent,) = address(sweeper).call{value: 50 ether}("");
        assertTrue(sent);

        sweeper.sweepIdleFloat();
        uint256 initialYield = sweeper.tier1YieldBalance();
        assertTrue(initialYield > 0);

        // Request replenishment for surge
        uint256 redeemed = sweeper.replenishTier0Buffer(60 ether);
        assertEq(redeemed, 10 ether);
        assertEq(sweeper.tier1YieldBalance(), initialYield - 10 ether);
    }

    function test_UnauthorizedCallerReverts() public {
        vm.prank(address(0x1234));
        vm.expectRevert(IYieldFloatSweeper.Unauthorized.selector);
        sweeper.sweepIdleFloat();
    }

    function test_SetTier0TargetBps() public {
        sweeper.setTier0TargetBps(3000); // 30%
        assertEq(sweeper.tier0BufferBps(), 3000);
    }

    receive() external payable {}
}
