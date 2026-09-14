// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PolicyEngine} from "../../src/core/PolicyEngine.sol";
import {IPolicyEngine} from "../../src/interfaces/IPolicyEngine.sol";

/// @notice Drives randomized, stateful evaluateAndSpend calls across a fixed pool
/// of agents for Foundry's invariant fuzzer. Deliberately submits some requests
/// above maxPerTx (they're expected to be rejected, not to succeed) so the
/// invariant is actually exercised under adversarial-shaped input, not just
/// well-behaved traffic.
contract PolicyEngineHandler is Test {
    PolicyEngine public immutable engine;
    address[] internal _agents;
    mapping(address => uint256) public nextNonce;

    uint128 public constant MAX_PER_TX = 1 ether;
    uint128 public constant MAX_PER_WINDOW = 5 ether;
    uint32 public constant WINDOW_SECONDS = 3600;
    uint32 public constant MAX_VELOCITY = 5;

    constructor(PolicyEngine engine_, address[] memory agents_) {
        engine = engine_;
        _agents = agents_;
        for (uint256 i = 0; i < agents_.length; i++) {
            vm.prank(agents_[i]);
            engine.setPolicy(
                agents_[i],
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
    }

    function agentCount() external view returns (uint256) {
        return _agents.length;
    }

    function agentAt(uint256 i) external view returns (address) {
        return _agents[i];
    }

    /// @dev `amountSeed` is intentionally bounded up to 2x maxPerTx so roughly
    /// half of fuzzed calls are expected to be rejected by the tx-limit check —
    /// the invariant must hold regardless of how many of these attempts revert
    /// (they never mutate state) or how many succeed.
    function spend(uint256 agentSeed, uint256 amountSeed, uint256 warpSeed) external {
        address agent = _agents[agentSeed % _agents.length];
        uint256 amount = bound(amountSeed, 0, uint256(MAX_PER_TX) * 2);

        if (warpSeed % 10 == 0) {
            vm.warp(block.timestamp + bound(warpSeed, 0, uint256(WINDOW_SECONDS) * 2));
        }

        IPolicyEngine.SpendRequest memory req = IPolicyEngine.SpendRequest({
            agent: agent,
            merchant: address(0xBEEF),
            amount: amount,
            category: bytes32("fuzz"),
            timestamp: block.timestamp,
            deadline: block.timestamp + 1 hours,
            nonce: nextNonce[agent]++
        });

        vm.prank(agent);
        try engine.evaluateAndSpend(req) {} catch {}
    }
}

/// @title PolicyEngineInvariantTest
/// @notice Plan §4.1: invariant_TotalSpendNeverExceedsWindowLimit, run with
/// 500 randomized call sequences x depth 128 (see contracts/foundry.toml).
/// @dev `invariant_NoDoubleSpendOnConcurrentRequests` from the plan is NOT
/// reproduced here as a stateful-fuzz invariant: Foundry's EVM is single
/// threaded, so it cannot actually exercise Monad's parallel-worker OCC
/// behavior. What that invariant reduces to at the contract level — a nonce is
/// never consumable twice, even when both attempts are otherwise valid — is
/// covered deterministically instead, in
/// `PolicyEngineTest.test_NonceCannotBeConsumedTwice` (contracts/test/PolicyEngine.t.sol).
/// True cross-worker concurrency behavior can only be verified against Monad's
/// actual parallel executor (testnet or a Monad-specific simulator), which is
/// out of reach of this toolchain and tracked as follow-up work.
contract PolicyEngineInvariantTest is Test {
    PolicyEngine internal engine;
    PolicyEngineHandler internal handler;

    function setUp() public {
        engine = new PolicyEngine();

        address[] memory agents = new address[](5);
        for (uint256 i = 0; i < 5; i++) {
            agents[i] = makeAddr(string.concat("invariant-agent-", vm.toString(i)));
        }

        handler = new PolicyEngineHandler(engine, agents);
        targetContract(address(handler));
    }

    function invariant_TotalSpendNeverExceedsWindowLimit() public view {
        uint256 count = handler.agentCount();
        for (uint256 i = 0; i < count; i++) {
            address agent = handler.agentAt(i);
            (uint128 spentInWindow,,,) = engine.getAgentState(agent);
            assertLe(spentInWindow, handler.MAX_PER_WINDOW());
        }
    }
}
