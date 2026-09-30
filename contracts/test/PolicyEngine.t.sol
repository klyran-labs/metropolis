// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {IPolicyEngine} from "../src/interfaces/IPolicyEngine.sol";

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
        engine.setPolicy(
            agent,
            IPolicyEngine.SpendPolicy({
                maxPerTx: MAX_PER_TX,
                maxPerWindow: MAX_PER_WINDOW,
                windowSeconds: WINDOW_SECONDS,
                maxVelocity: MAX_VELOCITY,
                killSwitch: false,
                whitelistEnabled: false
            })
        );
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

    function test_DenyWhenAmountExceedsMaxPerTx() public view {
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

    function test_AllowWhenWithinAllLimits() public view {
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

    function test_ReasonCodeAlwaysPresentOnDeny() public view {
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

        IPolicyEngine.SpendRequest memory renewedRequest = _req(1 ether, 4);
        renewedRequest.deadline = type(uint256).max;
        IPolicyEngine.PolicyDecision memory allowed = engine.evaluate(renewedRequest);
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

        (uint128 spentInWindow,, uint32 txCount,) = engine.getAgentState(agent);
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
        engine.setPolicy(
            agent,
            IPolicyEngine.SpendPolicy({
                maxPerTx: MAX_PER_TX,
                maxPerWindow: MAX_PER_WINDOW,
                windowSeconds: WINDOW_SECONDS,
                maxVelocity: MAX_VELOCITY,
                killSwitch: false,
                whitelistEnabled: true
            })
        );

        IPolicyEngine.PolicyDecision memory blocked = engine.evaluate(_req(0.1 ether, 1));
        assertFalse(blocked.allowed);
        assertEq(uint8(blocked.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_MERCHANT_NOT_ALLOWED));

        vm.prank(agent);
        engine.setMerchantWhitelist(agent, merchant, true);

        IPolicyEngine.PolicyDecision memory allowed = engine.evaluate(_req(0.1 ether, 1));
        assertTrue(allowed.allowed);
    }

    /// forge-config: default.fuzz.runs = 5000
    function testFuzz_NeverAllowsAboveMaxPerTx(uint256 amount) public view {
        amount = bound(amount, uint256(MAX_PER_TX) + 1, type(uint128).max);
        IPolicyEngine.PolicyDecision memory d = engine.evaluate(_req(amount, 1));
        assertFalse(d.allowed);
        assertEq(uint8(d.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_MAX_PER_TX));
    }

    /// forge-config: default.fuzz.runs = 5000
    function testFuzz_WithinMaxPerTxNeverDeniedForTxLimitReason(uint128 amount) public view {
        amount = uint128(bound(amount, 0, MAX_PER_TX));
        IPolicyEngine.PolicyDecision memory d = engine.evaluate(_req(amount, 1));
        assertTrue(d.reasonCode != IPolicyEngine.ReasonCode.ERR_MAX_PER_TX);
    }

    /* ═══════════════════════════════════════════════════════════════════
       ADR-0012: CIRCUIT PROTOCOL FINANCIAL CIRCUIT BREAKER TESTS
       ═══════════════════════════════════════════════════════════════════ */

    function test_ADR0012_TripAndResetCircuitBreaker_ByAdmin() public {
        address admin = makeAddr("enterpriseAdmin");
        // Bind enterprise controller
        vm.prank(agent);
        engine.setAgentAdmin(agent, admin);

        assertFalse(engine.isCircuitBroken(agent));
        assertFalse(engine.circuitBroken(agent));

        // Enterprise controller trips circuit breaker
        vm.prank(admin);
        engine.tripCircuitBreaker(agent);

        assertTrue(engine.isCircuitBroken(agent));
        assertTrue(engine.circuitBroken(agent));

        // Evaluation is immediately short-circuited with ERR_KILL_SWITCH
        IPolicyEngine.PolicyDecision memory d = engine.evaluate(_req(0.1 ether, 1));
        assertFalse(d.allowed);
        assertEq(uint8(d.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_KILL_SWITCH));

        // Enterprise controller resets circuit breaker
        vm.prank(admin);
        engine.resetCircuitBreaker(agent);

        assertFalse(engine.isCircuitBroken(agent));
        assertFalse(engine.circuitBroken(agent));

        // Evaluation succeeds again
        IPolicyEngine.PolicyDecision memory dRestored = engine.evaluate(_req(0.1 ether, 1));
        assertTrue(dRestored.allowed);
        assertEq(uint8(dRestored.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_NONE));
    }

    function test_ADR0012_RevertWhenAgentAttemptsToResetCircuitBreaker() public {
        address admin = makeAddr("enterpriseAdmin");
        vm.prank(agent);
        engine.setAgentAdmin(agent, admin);

        // Admin trips breaker
        vm.prank(admin);
        engine.tripCircuitBreaker(agent);
        assertTrue(engine.isCircuitBroken(agent));

        // Autonomous agent (0xAgent) must NEVER be allowed to reset its own circuit breaker
        vm.prank(agent);
        vm.expectRevert(PolicyEngine.Unauthorized.selector);
        engine.resetCircuitBreaker(agent);

        // Circuit breaker remains tripped
        assertTrue(engine.isCircuitBroken(agent));
    }

    function test_ADR0012_RevertWhenUnauthorizedCallerTripsOrResetsCircuitBreaker() public {
        address admin = makeAddr("enterpriseAdmin");
        address attacker = makeAddr("attacker");
        vm.prank(agent);
        engine.setAgentAdmin(agent, admin);

        // Attacker cannot trip
        vm.prank(attacker);
        vm.expectRevert(PolicyEngine.Unauthorized.selector);
        engine.tripCircuitBreaker(agent);

        // Admin trips
        vm.prank(admin);
        engine.tripCircuitBreaker(agent);

        // Attacker cannot reset
        vm.prank(attacker);
        vm.expectRevert(PolicyEngine.Unauthorized.selector);
        engine.resetCircuitBreaker(agent);
    }

    function test_ADR0008_AdaptiveCircuitBreakerCanaryAndHealing() public {
        address admin = makeAddr("enterpriseAdmin");
        vm.prank(agent);
        engine.setAgentAdmin(agent, admin);

        // 1. Trip breaker to OPEN
        vm.prank(admin);
        engine.tripCircuitBreaker(agent);
        (IPolicyEngine.CircuitState state,,,,) = engine.getCircuitState(agent);
        assertEq(uint8(state), uint8(IPolicyEngine.CircuitState.OPEN));

        // 2. Admin enters Canary mode: throttled to 0.05 ether, requires 2 clean transactions
        vm.prank(admin);
        engine.enterCanaryMode(agent, 0.05 ether, 2);
        (state,,,,) = engine.getCircuitState(agent);
        assertEq(uint8(state), uint8(IPolicyEngine.CircuitState.HALF_OPEN));

        // Spend > canary limit (0.06 ether) is rejected with ERR_KILL_SWITCH
        IPolicyEngine.PolicyDecision memory dTooLarge = engine.evaluate(_req(0.06 ether, 10));
        assertFalse(dTooLarge.allowed);
        assertEq(uint8(dTooLarge.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_KILL_SWITCH));

        // Clean spend 1: 0.04 ether (within canary ceiling)
        vm.prank(agent);
        IPolicyEngine.PolicyDecision memory d1 = engine.evaluateAndSpend(_req(0.04 ether, 10));
        assertTrue(d1.allowed);
        assertEq(uint8(d1.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_NONE));

        // Remains in HALF_OPEN with 1 clean transaction
        uint32 cleanCount;
        (state,,, cleanCount,) = engine.getCircuitState(agent);
        assertEq(uint8(state), uint8(IPolicyEngine.CircuitState.HALF_OPEN));
        assertEq(cleanCount, 1);

        // Clean spend 2: 0.03 ether -> Reaches required clean threshold (2) -> Auto-heals to CLOSED!
        vm.prank(agent);
        IPolicyEngine.PolicyDecision memory d2 = engine.evaluateAndSpend(_req(0.03 ether, 11));
        assertTrue(d2.allowed);

        // Verified: State is automatically promoted to CLOSED and kill switch is completely disarmed
        (state,,,,) = engine.getCircuitState(agent);
        assertEq(uint8(state), uint8(IPolicyEngine.CircuitState.CLOSED));
        assertFalse(engine.isCircuitBroken(agent));

        // Normal full spend (e.g. 0.2 ether) now succeeds as usual
        vm.prank(agent);
        IPolicyEngine.PolicyDecision memory dNormal = engine.evaluateAndSpend(_req(0.2 ether, 12));
        assertTrue(dNormal.allowed);
    }

    function test_ADR0008_AdaptiveCircuitBreakerCanaryViolationRelapsesToOpen() public {
        address admin = makeAddr("enterpriseAdmin");
        vm.prank(agent);
        engine.setAgentAdmin(agent, admin);

        // Admin enters Canary mode directly: 0.05 ether limit
        vm.prank(admin);
        engine.enterCanaryMode(agent, 0.05 ether, 2);

        // Attempting to spend 0.1 ether in evaluateAndSpend breaches canary limit
        vm.prank(agent);
        IPolicyEngine.PolicyDecision memory dBreach = engine.evaluateAndSpend(_req(0.1 ether, 20));
        assertFalse(dBreach.allowed);
        assertEq(uint8(dBreach.reasonCode), uint8(IPolicyEngine.ReasonCode.ERR_KILL_SWITCH));

        // Relapses back to OPEN with active kill switch!
        (IPolicyEngine.CircuitState state,,,,) = engine.getCircuitState(agent);
        assertEq(uint8(state), uint8(IPolicyEngine.CircuitState.OPEN));
        assertTrue(engine.isCircuitBroken(agent));
    }
}

