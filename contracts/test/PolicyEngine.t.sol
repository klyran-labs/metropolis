// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import { Test } from "forge-std/Test.sol";
import { PolicyEngine } from "../src/core/PolicyEngine.sol";
import { IPolicyEngine } from "../src/interfaces/IPolicyEngine.sol";

/// @title PolicyEngineTest
/// @notice Real Foundry unit/fuzz tests against compiled PolicyEngine bytecode.
/// @dev These implement the RED-phase test list from the original plan (§4.1).
///      `test_PartialAllow_WhenBudgetPoolPartiallyDepleted` from the plan is
///      intentionally omitted: BudgetPool/Org-level shared budgets are not
///      implemented in this contract (see docs/GAP_ANALYSIS.md, §2) — evaluate()
///      is currently a strict binary allow/deny, never a partial allowance.
contract PolicyEngineTest is Test {
    PolicyEngine internal engine;

    address internal agent = makeAddr("agent");
    address internal merchant = makeAddr("merchant");
    address internal guard = makeAddr("guard"); // stands in for AgentWalletGuard

    uint128 internal constant MAX_PER_TX = 1 ether;
    uint128 internal constant MAX_PER_WINDOW = 3 ether;
    uint32 internal constant WINDOW_SECONDS = 3600;
    uint32 internal constant MAX_VELOCITY = 3;

    function setUp() public {
        engine = new PolicyEngine();
        engine.setAuthorizedCaller(guard, true);

        vm.prank(agent);
        engine.setPolicy(agent, IPolicyEngine.SpendPolicy({
            maxPerTx: MAX_PER_TX,
            maxPerWindow: MAX_PER_WINDOW,
            windowSeconds: WINDOW_SECONDS,
            maxVelocity: MAX_VELOCITY,
            killSwitch: false,
            whitelistEnabled: false
        }));
    }

    function _req(uint256 amount, uint256 nonce) internal view returns (IPolicyEngine.SpendRequest memory) {
        return IPolicyEngine.SpendRequest({
            agent: agent,
            merchant: merchant,
            amount: amount,
            category: bytes32("inference"),
            timestamp: block.timestamp,
            deadline: block.timestamp + 1 hours,
            nonce: nonce
        });
    }

    function test_DenyWhenAmountExceedsMaxPerTx() public {
        IPolicyEngine.PolicyDecision memory d = engine.evaluate(_req(MAX_PER_TX + 1, 1));
        assertFalse(d.allowed);
        assertEq(uint8(d.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_MAX_PER_TX));
    }

    function test_DenyWhenVelocityExceeded_WithinWindow() public {
        vm.startPrank(guard);
        engine.evaluateAndSpend(_req(0.1 ether, 1));
        engine.evaluateAndSpend(_req(0.1 ether, 2));
        engine.evaluateAndSpend(_req(0.1 ether, 3));
        vm.stopPrank();

        IPolicyEngine.PolicyDecision memory d = engine.evaluate(_req(0.1 ether, 4));
        assertFalse(d.allowed);
        assertEq(uint8(d.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_VELOCITY_EXCEEDED));
    }

    function test_AllowWhenWithinAllLimits() public {
        IPolicyEngine.PolicyDecision memory d = engine.evaluate(_req(0.5 ether, 1));
        assertTrue(d.allowed);
        assertEq(uint8(d.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_NONE));
        assertEq(d.allowedAmount, 0.5 ether);
    }

    function test_KillSwitchShortCircuitsAllOtherChecks() public {
        vm.prank(agent);
        engine.setKillSwitch(agent, true);

        // Request would otherwise be perfectly valid (within all limits) — it
        // must still be denied, and denied specifically for KILL_SWITCH, proving
        // the kill switch is checked before (and independent of) every other rule.
        IPolicyEngine.PolicyDecision memory d = engine.evaluate(_req(0.1 ether, 1));
        assertFalse(d.allowed);
        assertEq(uint8(d.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_KILL_SWITCH));
    }

    function test_ReasonCodeAlwaysPresentOnDeny() public {
        IPolicyEngine.PolicyDecision memory d = engine.evaluate(_req(MAX_PER_TX + 1, 1));
        assertFalse(d.allowed);
        assertTrue(uint8(d.reasonCode) != uint8(IPolicyEngine.ReasonCode.ERR_NONE));
    }

    function test_RollingWindowResetsAfterWindowDuration() public {
        vm.startPrank(guard);
        engine.evaluateAndSpend(_req(1 ether, 1));
        engine.evaluateAndSpend(_req(1 ether, 2));
        engine.evaluateAndSpend(_req(1 ether, 3));
        vm.stopPrank();

        // Window (3 ether) and velocity (3 tx) are both now exhausted.
        IPolicyEngine.PolicyDecision memory blocked = engine.evaluate(_req(0.1 ether, 4));
        assertFalse(blocked.allowed);

        vm.warp(block.timestamp + WINDOW_SECONDS + 1);

        IPolicyEngine.PolicyDecision memory allowed = engine.evaluate(_req(1 ether, 4));
        assertTrue(allowed.allowed);
    }

    /// @notice Finding 1.3 (docs/GAP_ANALYSIS.md): PolicyEngine must reject any
    /// caller that is neither the agent, its admin, nor an authorized contract
    /// (e.g. the deployed AgentWalletGuard) from consuming spend/velocity budget.
    function test_RevertWhenUnauthorizedCallerInvokesEvaluateAndSpend() public {
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(PolicyEngine.Unauthorized.selector);
        engine.evaluateAndSpend(_req(0.1 ether, 1));
    }

    function test_AgentCanCallEvaluateAndSpendDirectlyForItself() public {
        vm.prank(agent);
        IPolicyEngine.PolicyDecision memory d = engine.evaluateAndSpend(_req(0.1 ether, 1));
        assertTrue(d.allowed);
    }

    function test_AuthorizedCallerCanSpendOnAgentsBehalf() public {
        vm.prank(guard);
        IPolicyEngine.PolicyDecision memory d = engine.evaluateAndSpend(_req(0.1 ether, 1));
        assertTrue(d.allowed);
    }

    /// @notice Nonce reuse must be rejected even when both attempts are otherwise
    /// fully valid — this is the contract-level guarantee the plan's
    /// `invariant_NoDoubleSpendOnConcurrentRequests` reduces to: Monad's OCC
    /// serializes any two same-agent transactions (they touch the same disjoint
    /// storage slot), so "no double spend under concurrency" is enforced here by
    /// "a nonce is never consumable twice," not by anything Foundry's
    /// single-threaded EVM could directly simulate about parallel workers.
    function test_NonceCannotBeConsumedTwice() public {
        IPolicyEngine.SpendRequest memory req = _req(0.1 ether, 42);

        vm.prank(guard);
        IPolicyEngine.PolicyDecision memory first = engine.evaluateAndSpend(req);
        assertTrue(first.allowed);

        vm.prank(guard);
        IPolicyEngine.PolicyDecision memory second = engine.evaluateAndSpend(req);
        assertFalse(second.allowed);
        assertEq(uint8(second.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_NONCE_REUSED));

        (uint128 spentInWindow, , uint32 txCount, ) = engine.getAgentState(agent);
        assertEq(spentInWindow, 0.1 ether); // only the first spend was ever recorded
        assertEq(txCount, 1);
    }

    function test_DenyPastDeadline() public {
        IPolicyEngine.SpendRequest memory req = _req(0.1 ether, 1);
        req.deadline = block.timestamp; // deadline in the "now or past" boundary
        vm.warp(block.timestamp + 1);

        IPolicyEngine.PolicyDecision memory d = engine.evaluate(req);
        assertFalse(d.allowed);
        assertEq(uint8(d.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_EXPIRED));
    }

    function test_MerchantWhitelistEnforcedWhenEnabled() public {
        vm.prank(agent);
        engine.setPolicy(agent, IPolicyEngine.SpendPolicy({
            maxPerTx: MAX_PER_TX,
            maxPerWindow: MAX_PER_WINDOW,
            windowSeconds: WINDOW_SECONDS,
            maxVelocity: MAX_VELOCITY,
            killSwitch: false,
            whitelistEnabled: true
        }));

        IPolicyEngine.PolicyDecision memory blocked = engine.evaluate(_req(0.1 ether, 1));
        assertFalse(blocked.allowed);
        assertEq(uint8(blocked.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_MERCHANT_NOT_ALLOWED));

        vm.prank(agent);
        engine.setMerchantWhitelist(agent, merchant, true);

        IPolicyEngine.PolicyDecision memory allowed = engine.evaluate(_req(0.1 ether, 1));
        assertTrue(allowed.allowed);
    }

    /// forge-config: default.fuzz.runs = 5000
    function testFuzz_NeverAllowsAboveMaxPerTx(uint256 amount) public {
        amount = bound(amount, uint256(MAX_PER_TX) + 1, type(uint128).max);
        IPolicyEngine.PolicyDecision memory d = engine.evaluate(_req(amount, 1));
        assertFalse(d.allowed);
        assertEq(uint8(d.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_MAX_PER_TX));
    }

    /// forge-config: default.fuzz.runs = 5000
    function testFuzz_WithinMaxPerTxNeverDeniedForTxLimitReason(uint128 amount) public {
        amount = uint128(bound(amount, 0, MAX_PER_TX));
        IPolicyEngine.PolicyDecision memory d = engine.evaluate(_req(amount, 1));
        assertTrue(d.reasonCode != IPolicyEngine.ReasonCode.ERR_MAX_PER_TX);
    }
}
