// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { ReputationRegistry } from "../src/core/ReputationRegistry.sol";
import { IReputationRegistry } from "../src/interfaces/IReputationRegistry.sol";

/// @title ReputationRegistryTest
/// @notice Real Foundry tests against compiled ReputationRegistry bytecode.
/// @dev Confirms the EWMA coefficients actually match docs/ADR/0004 (as corrected
///      to describe the real 0-1,000,000 parts-per-million scale, not basis points).
contract ReputationRegistryTest is Test {
    ReputationRegistry internal registry;
    address internal agent = makeAddr("agent");
    address internal counterparty = makeAddr("counterparty");
    address internal reporter = makeAddr("reporter");

    function setUp() public {
        registry = new ReputationRegistry();
        registry.setReporter(reporter, true);
    }

    function test_NewAgentStartsAtNeutralBaseline() public {
        assertEq(registry.getScore(agent), 500_000);
    }

    function test_ReputationScoreIncrementalUpdate() public {
        vm.prank(reporter);
        registry.recordOutcome(agent, counterparty, IReputationRegistry.ReputationOutcome.SETTLED, 1 ether);

        // 0.95 * 500,000 + 0.05 * 1,000,000 = 475,000 + 50,000 = 525,000
        assertEq(registry.getScore(agent), 525_000);

        IReputationRegistry.ReputationMetrics memory m = registry.getMetrics(agent);
        assertEq(m.totalTransactions, 1);
        assertEq(m.settledCount, 1);
    }

    function test_DisputedPullsScoreTowardLowTarget() public {
        vm.prank(reporter);
        registry.recordOutcome(agent, counterparty, IReputationRegistry.ReputationOutcome.DISPUTED, 1 ether);

        // 0.90 * 500,000 + 0.10 * 200,000 = 450,000 + 20,000 = 470,000
        assertEq(registry.getScore(agent), 470_000);
    }

    function test_SlashedAppliesFlat30PercentCut() public {
        vm.prank(reporter);
        registry.recordOutcome(agent, counterparty, IReputationRegistry.ReputationOutcome.SETTLED, 1 ether);
        uint32 preSlashScore = registry.getScore(agent);
        assertGt(preSlashScore, 0);

        vm.prank(reporter);
        registry.recordOutcome(agent, counterparty, IReputationRegistry.ReputationOutcome.SLASHED, 1 ether);

        assertEq(registry.getScore(agent), (uint256(preSlashScore) * 70) / 100);
    }

    function test_RevertWhenUnauthorizedReporterRecordsOutcome() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(ReputationRegistry.Unauthorized.selector);
        registry.recordOutcome(agent, counterparty, IReputationRegistry.ReputationOutcome.SETTLED, 1 ether);
    }

    function test_OwnerCanRevokeReporter() public {
        vm.prank(reporter);
        registry.recordOutcome(agent, counterparty, IReputationRegistry.ReputationOutcome.SETTLED, 1 ether);

        registry.setReporter(reporter, false);

        vm.prank(reporter);
        vm.expectRevert(ReputationRegistry.Unauthorized.selector);
        registry.recordOutcome(agent, counterparty, IReputationRegistry.ReputationOutcome.SETTLED, 1 ether);
    }

    /// forge-config: default.fuzz.runs = 5000
    function testFuzz_ScoreNeverExceedsOneMillion(uint8 outcomeSeed, uint8 iterations) public {
        iterations = uint8(bound(iterations, 1, 50));
        for (uint256 i = 0; i < iterations; i++) {
            IReputationRegistry.ReputationOutcome outcome = IReputationRegistry.ReputationOutcome(outcomeSeed % 4);
            vm.prank(reporter);
            registry.recordOutcome(agent, counterparty, outcome, 1 ether);
            assertLe(registry.getScore(agent), 1_000_000);
        }
    }
}
