// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {CircuitVault} from "../src/core/CircuitVault.sol";
import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {ICircuitVault} from "../src/interfaces/ICircuitVault.sol";
import {IPolicyEngine} from "../src/interfaces/IPolicyEngine.sol";

contract MockUSDC {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        // forge-lint: disable-next-line(missing-events-access-control)
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        // forge-lint: disable-next-line(missing-events-access-control)
        allowance[from][msg.sender] -= amount;
        // forge-lint: disable-next-line(missing-events-access-control)
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

contract CircuitVaultTest is Test {
    CircuitVault internal vault;
    PolicyEngine internal policyEngine;
    MockUSDC internal token;

    uint256 internal agentPrivateKey = 0xA11CE;
    address internal agent;
    address internal admin = makeAddr("admin");
    address internal provider = makeAddr("provider");
    address internal relayer = makeAddr("relayer");

    function setUp() public {
        agent = vm.addr(agentPrivateKey);
        token = new MockUSDC();
        policyEngine = new PolicyEngine();
        vault = new CircuitVault(address(token), address(policyEngine));

        // Configure agent policy and admin
        vm.prank(agent);
        policyEngine.setAgentAdmin(agent, admin);

        vm.prank(admin);
        policyEngine.setPolicy(
            agent,
            IPolicyEngine.SpendPolicy({
                maxPerTx: 1000 ether,
                maxPerWindow: 10000 ether,
                windowSeconds: 3600,
                maxVelocity: 100,
                killSwitch: false,
                whitelistEnabled: false
            })
        );

        // Mint USDC to agent & approve vault
        token.mint(agent, 50000 ether);
        vm.prank(agent);
        token.approve(address(vault), type(uint256).max);
    }

    function _signVoucher(
        address _agent,
        address _provider,
        uint256 _epoch,
        bytes32 _sessionId,
        uint128 _cumulativeSpent,
        uint256 _nonce,
        uint256 _deadline,
        uint256 _privateKey
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                vault.MICRO_VOUCHER_TYPEHASH(),
                _agent,
                _provider,
                _epoch,
                _sessionId,
                _cumulativeSpent,
                _nonce,
                _deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function _signSessionVoucher(
        address _agent,
        address _provider,
        bytes32 _sessionId,
        uint128 _voucherAmount,
        uint256 _privateKey
    ) internal view returns (bytes memory) {
        bytes32 structHash = keccak256(
            abi.encode(vault.SESSION_VOUCHER_TYPEHASH(), _agent, _provider, _sessionId, _voucherAmount)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", vault.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(_privateKey, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_Deposit_BalanceDeltaTracking() public {
        vm.prank(agent);
        uint256 actual = vault.deposit(agent, 1000 ether);
        assertEq(actual, 1000 ether);
        assertEq(vault.getVaultBalance(agent), 1000 ether);
    }

    function test_DoublePartitioned_Allocation_ByDifferentAgents() public {
        address agent2 = makeAddr("agent2");
        token.mint(agent2, 2000 ether);
        vm.prank(agent2);
        token.approve(address(vault), type(uint256).max);

        vm.prank(agent);
        vault.deposit(agent, 5000 ether);

        vm.prank(agent2);
        vault.deposit(agent2, 2000 ether);

        // Agent 1 allocates to provider for epoch 1
        vm.prank(admin);
        vault.allocateEpochBucket(agent, provider, 1, 3000 ether, 3600);

        // Agent 2 allocates to the SAME provider for epoch 1 (orthogonal storage slots)
        vm.prank(agent2);
        vault.allocateEpochBucket(agent2, provider, 1, 1500 ether, 3600);

        ICircuitVault.EpochBucket memory b1 = vault.getEpochBucket(agent, provider, 1);
        ICircuitVault.EpochBucket memory b2 = vault.getEpochBucket(agent2, provider, 1);

        assertEq(b1.allocatedCap, 3000 ether);
        assertEq(b2.allocatedCap, 1500 ether);
        assertEq(vault.getVaultBalance(agent), 2000 ether);
        assertEq(vault.getVaultBalance(agent2), 500 ether);
    }

    function test_SettleVoucherDelta_MonotonicSpend() public {
        vm.prank(agent);
        vault.deposit(agent, 5000 ether);

        vm.prank(admin);
        vault.allocateEpochBucket(agent, provider, 1, 1000 ether, 3600);

        // First voucher: spent 300 ether
        bytes memory sig1 =
            _signVoucher(agent, provider, 1, bytes32(0), 300 ether, 0, block.timestamp + 1 hours, agentPrivateKey);
        uint128 delta1 = vault.settleVoucherDelta(agent, provider, 1, 300 ether, sig1);
        assertEq(delta1, 300 ether);
        assertEq(token.balanceOf(provider), 300 ether);

        // Second voucher: spent 750 ether (delta = 450 ether)
        bytes memory sig2 =
            _signVoucher(agent, provider, 1, bytes32(0), 750 ether, 0, block.timestamp + 1 hours, agentPrivateKey);
        uint128 delta2 = vault.settleVoucherDelta(agent, provider, 1, 750 ether, sig2);
        assertEq(delta2, 450 ether);
        assertEq(token.balanceOf(provider), 750 ether);

        // Non-monotonic voucher (700 <= 750) must revert
        vm.expectRevert(CircuitVault.SpendNotMonotonic.selector);
        vault.settleVoucherDelta(agent, provider, 1, 700 ether, sig2);
    }

    function test_TerminalClose_RefundsUnspentFloat() public {
        vm.prank(agent);
        vault.deposit(agent, 5000 ether);

        vm.prank(admin);
        vault.allocateEpochBucket(agent, provider, 1, 2000 ether, 3600);
        assertEq(vault.getVaultBalance(agent), 3000 ether);

        // Terminal close after spending 1200 ether -> 800 ether refunded instantly
        bytes memory sig =
            _signVoucher(agent, provider, 1, bytes32(0), 1200 ether, 0, block.timestamp + 1 hours, agentPrivateKey);
        (uint128 delta, uint128 refunded) = vault.terminalClose(agent, provider, 1, 1200 ether, sig);

        assertEq(delta, 1200 ether);
        assertEq(refunded, 800 ether);
        assertEq(token.balanceOf(provider), 1200 ether);
        assertEq(vault.getVaultBalance(agent), 3800 ether); // 3000 + 800 refunded float

        ICircuitVault.EpochBucket memory b = vault.getEpochBucket(agent, provider, 1);
        assertTrue(b.isClosed);
    }

    function test_SplitStateDispute_UnilateralChallengeAndResolution() public {
        vm.prank(agent);
        vault.deposit(agent, 5000 ether);

        vm.prank(admin);
        vault.allocateEpochBucket(agent, provider, 1, 2000 ether, 3600);

        bytes32 sessionId = keccak256("session_001");

        // Agent initiates unilateral close claiming spent 500 ether
        vm.prank(admin);
        vault.requestUnilateralClose(agent, provider, 1, sessionId, 500 ether);

        ICircuitVault.UnilateralChallenge memory ch = vault.getAgentChallenge(agent, sessionId);
        assertTrue(ch.active);
        assertEq(ch.proposedSettlement, 500 ether);
        assertEq(ch.provider, provider);
        assertEq(ch.epoch, 1);

        vm.expectRevert(CircuitVault.ChallengeTargetMismatch.selector);
        vault.finalizeUnilateralClose(agent, makeAddr("otherProvider"), 1, sessionId);

        // Provider submits higher merchant voucher for 800 ether
        bytes memory providerSig = _signSessionVoucher(agent, provider, sessionId, 800 ether, agentPrivateKey);

        vault.submitMerchantVoucher(agent, provider, sessionId, 800 ether, providerSig);
        assertEq(vault.getMerchantSettlement(agent, provider, sessionId), 800 ether);

        // A valid signature from an unrelated key cannot authorize the session voucher.
        bytes memory wrongSignerSig = _signSessionVoucher(agent, provider, sessionId, 900 ether, 0xB0B);
        vm.expectRevert(CircuitVault.InvalidVoucherSignature.selector);
        vault.submitMerchantVoucher(agent, provider, sessionId, 900 ether, wrongSignerSig);

        // Cannot finalize before challenge window (200 blocks)
        vm.expectRevert(CircuitVault.ChallengeNotExpired.selector);
        vault.finalizeUnilateralClose(agent, provider, 1, sessionId);

        // Advance 201 blocks
        vm.roll(block.number + 201);

        // Finalize unilateral close: merchant receives max(500, 800) = 800 ether, agent refunded 1200 ether
        (uint128 providerPayout, uint128 agentRefund) = vault.finalizeUnilateralClose(agent, provider, 1, sessionId);

        assertEq(providerPayout, 800 ether);
        assertEq(agentRefund, 1200 ether);
        assertEq(token.balanceOf(provider), 800 ether);
        assertEq(vault.getVaultBalance(agent), 4200 ether); // 3000 + 1200
    }

    function test_RevertWhenCircuitBreakerActive() public {
        vm.prank(agent);
        vault.deposit(agent, 5000 ether);

        // Trip circuit breaker
        vm.prank(admin);
        policyEngine.tripCircuitBreaker(agent);

        // Allocation reverts
        vm.prank(admin);
        vm.expectRevert(CircuitVault.CircuitBreakerActive.selector);
        vault.allocateEpochBucket(agent, provider, 1, 1000 ether, 3600);
    }

    function test_WithdrawalCooldownAndFinalization() public {
        vm.prank(agent);
        vault.deposit(agent, 5000 ether);

        // Request withdrawal of 1000 ether
        vm.prank(admin);
        vault.requestWithdrawal(agent, 1000 ether);

        // Finalize immediately reverts for CooldownActive
        vm.prank(admin);
        vm.expectRevert(CircuitVault.CooldownActive.selector);
        vault.finalizeWithdrawal(agent, admin);

        // Warp 31 minutes
        vm.warp(block.timestamp + 1801);

        // Finalize succeeds
        vm.prank(admin);
        uint128 finalized = vault.finalizeWithdrawal(agent, admin);
        assertEq(finalized, 1000 ether);
        assertEq(token.balanceOf(admin), 1000 ether);
        assertEq(vault.getVaultBalance(agent), 4000 ether);
    }

    function test_ShardedRelayerCreditAndBatchClaim() public {
        token.mint(address(vault), 1000 ether); // Fund vault for relayer payout

        // Owner/authorized credits relayer across shards
        vault.creditRelayerFee(relayer, 1, 10 ether);
        vault.creditRelayerFee(relayer, 2, 25 ether);
        vault.creditRelayerFee(relayer, 3, 15 ether);

        assertEq(vault.getRelayerGasCredits(relayer, 1), 10 ether);
        assertEq(vault.getRelayerGasCredits(relayer, 2), 25 ether);

        uint256[] memory shards = new uint256[](3);
        shards[0] = 1;
        shards[1] = 2;
        shards[2] = 3;

        vm.prank(relayer);
        uint128 claimed = vault.claimRelayerCredits(shards);
        assertEq(claimed, 50 ether);
        assertEq(token.balanceOf(relayer), 50 ether);
        assertEq(vault.getRelayerGasCredits(relayer, 1), 0);
    }
}
