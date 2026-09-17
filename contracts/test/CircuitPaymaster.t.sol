// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CircuitPaymaster} from "../src/core/CircuitPaymaster.sol";
import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {ICircuitPaymaster} from "../src/interfaces/ICircuitPaymaster.sol";
import {IPolicyEngine} from "../src/interfaces/IPolicyEngine.sol";

contract CircuitPaymasterTest is Test {
    CircuitPaymaster internal paymaster;
    PolicyEngine internal policyEngine;

    address internal owner = makeAddr("owner");
    address internal entryPoint = makeAddr("entryPoint");
    address internal treasury = makeAddr("treasury");
    address internal agent = makeAddr("agent");

    uint256 internal constant INITIAL_GAS_DEPOSIT = 10 ether;

    function setUp() public {
        policyEngine = new PolicyEngine();
        paymaster = new CircuitPaymaster(owner, entryPoint, address(policyEngine));

        // Setup agent policy in policyEngine
        vm.prank(agent);
        policyEngine.setPolicy(
            agent,
            IPolicyEngine.SpendPolicy({
                maxPerTx: 1 ether,
                maxPerWindow: 5 ether,
                windowSeconds: 3600,
                maxVelocity: 10,
                killSwitch: false,
                whitelistEnabled: false
            })
        );

        // Assign treasury to agent and fund
        vm.deal(treasury, 20 ether);
        vm.prank(treasury);
        paymaster.setAgentTreasury(agent, treasury);

        vm.prank(treasury);
        paymaster.depositGas{value: INITIAL_GAS_DEPOSIT}(treasury);
    }

    function test_SponsorshipEligible_WhenActiveAndFunded() public view {
        (bool eligible, uint8 reasonCode) = paymaster.isSponsorshipEligible(agent, 0.05 ether);
        assertTrue(eligible);
        assertEq(reasonCode, 0);
    }

    function test_DenySponsorship_WhenCircuitBroken() public {
        // Trip circuit breaker
        policyEngine.tripCircuitBreaker(agent);

        (bool eligible, uint8 reasonCode) = paymaster.isSponsorshipEligible(agent, 0.05 ether);
        assertFalse(eligible);
        assertEq(reasonCode, 8); // ERR_CIRCUIT_BREAKER_ACTIVE
    }

    function test_DenySponsorship_WhenTreasuryUnassigned() public {
        address unassignedAgent = makeAddr("unassignedAgent");
        (bool eligible, uint8 reasonCode) = paymaster.isSponsorshipEligible(unassignedAgent, 0.05 ether);
        assertFalse(eligible);
        assertEq(reasonCode, 1); // ERR_AGENT_NOT_AUTHORIZED
    }

    function test_DenySponsorship_WhenTreasuryBalanceInsufficient() public view {
        (bool eligible, uint8 reasonCode) = paymaster.isSponsorshipEligible(agent, 50 ether);
        assertFalse(eligible);
        assertEq(reasonCode, 6); // ERR_BUDGET_EXCEEDED
    }

    function test_ValidateAndPostOp_DebitsAndRefundsDifference() public {
        uint256 maxCost = 0.1 ether;
        uint256 actualGasCost = 0.04 ether;

        ICircuitPaymaster.UserOperation memory userOp;
        userOp.sender = agent;

        // EntryPoint validates UserOp
        vm.prank(entryPoint);
        (bytes memory context, uint256 validationData) = paymaster.validatePaymasterUserOp(userOp, bytes32(0), maxCost);
        assertEq(validationData, 0);
        assertEq(paymaster.treasuryBalances(treasury), INITIAL_GAS_DEPOSIT - maxCost);

        // EntryPoint executes postOp
        vm.prank(entryPoint);
        paymaster.postOp(ICircuitPaymaster.PostOpMode.opSucceeded, context, actualGasCost);

        // Treasury should have refunded the 0.06 ether unused difference
        assertEq(paymaster.treasuryBalances(treasury), INITIAL_GAS_DEPOSIT - actualGasCost);
    }

    function test_WithdrawGas_OnlyTreasuryOrOwner() public {
        uint256 balanceBefore = treasury.balance;
        vm.prank(treasury);
        paymaster.withdrawGas(treasury, 2 ether);

        assertEq(treasury.balance, balanceBefore + 2 ether);
        assertEq(paymaster.treasuryBalances(treasury), INITIAL_GAS_DEPOSIT - 2 ether);

        // Foreign caller cannot withdraw
        address intruder = makeAddr("intruder");
        vm.prank(intruder);
        vm.expectRevert(CircuitPaymaster.Unauthorized.selector);
        paymaster.withdrawGas(treasury, 1 ether);
    }
}
