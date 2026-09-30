// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AgentSuccessionVault} from "../src/core/AgentSuccessionVault.sol";
import {IAgentSuccessionVault} from "../src/interfaces/IAgentSuccessionVault.sol";

contract AgentSuccessionVaultTest is Test {
    AgentSuccessionVault public vault;
    address public admin = address(0xAA11);
    address public agent = address(0xBB22);
    address public standbyKey = address(0xCC33);
    address public treasury = address(0xDD44);
    address public attacker = address(0xDEAD);

    uint256 public constant GRACE_PERIOD = 3 days; // 259,200 seconds

    function setUp() public {
        vm.prank(admin);
        vault = new AgentSuccessionVault();

        vm.prank(admin);
        vault.setAgentAdmin(agent, admin);

        vm.prank(admin);
        vault.configureSuccession(agent, GRACE_PERIOD, standbyKey, treasury);
    }

    function test_ConfigureAndRecordHeartbeat() public {
        vm.warp(block.timestamp + 1 days);
        vm.prank(agent);
        vault.recordHeartbeat(agent);

        IAgentSuccessionVault.AgentLiveness memory l = vault.getLiveness(agent);
        assertEq(l.lastHeartbeat, block.timestamp);
        assertEq(l.standbyKey, standbyKey);
        assertEq(l.fallbackTreasury, treasury);
        assertFalse(l.successionActive);
    }

    function test_TriggerSuccession_RevertIfGracePeriodNotExpired() public {
        // Advance only 1 day (grace period is 3 days)
        vm.warp(block.timestamp + 1 days);

        vm.expectRevert();
        vault.triggerSuccession(agent);
    }

    function test_TriggerSuccession_SucceedsAfterExpiration() public {
        // Advance beyond 3-day grace period
        vm.warp(block.timestamp + 4 days);

        address activated = vault.triggerSuccession(agent);
        assertEq(activated, standbyKey);

        IAgentSuccessionVault.AgentLiveness memory l = vault.getLiveness(agent);
        assertTrue(l.successionActive);
    }

    function test_HeartbeatResetsSuccession() public {
        vm.warp(block.timestamp + 4 days);
        vault.triggerSuccession(agent);

        assertTrue(vault.getLiveness(agent).successionActive);

        // Heartbeat is recorded by agent returning to life
        vm.prank(agent);
        vault.recordHeartbeat(agent);

        assertFalse(vault.getLiveness(agent).successionActive);
    }

    function test_UnauthorizedCannotConfigure() public {
        vm.prank(attacker);
        vm.expectRevert(IAgentSuccessionVault.Unauthorized.selector);
        vault.configureSuccession(agent, 1 days, attacker, attacker);
    }
}
