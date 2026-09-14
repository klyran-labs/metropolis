// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {ReputationRegistry} from "../src/core/ReputationRegistry.sol";
import {AgentWalletGuard} from "../src/core/AgentWalletGuard.sol";
import {IPolicyEngine} from "../src/interfaces/IPolicyEngine.sol";

/// @notice Minimal ERC-20 mock. Intentionally returns `bool` (standard-compliant,
/// e.g. USDC-shaped) to exercise the primary settlement path; the no-return-data
/// tolerance in AgentWalletGuard._safeTransferFrom is exercised separately below.
contract MockERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @notice USDT-shaped ERC-20: `transferFrom` returns no data on success at all.
/// Exercises the SafeERC20-style tolerance added in AgentWalletGuard._safeTransferFrom
/// (docs/GAP_ANALYSIS.md §2 — raw `IERC20Minimal.transferFrom` would have reverted
/// on ABI-decoding an empty return value here).
contract NoReturnDataERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external {
        allowance[msg.sender][spender] = amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        require(allowance[from][msg.sender] >= amount, "allowance");
        require(balanceOf[from] >= amount, "balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        // deliberately returns nothing
    }
}

contract AgentWalletGuardTest is Test {
    PolicyEngine internal engine;
    ReputationRegistry internal reputation;
    AgentWalletGuard internal guard;
    MockERC20 internal token;
    NoReturnDataERC20 internal usdtLike;

    uint256 internal agentPk = 0xA11CE;
    address internal agent;
    address internal merchant = makeAddr("merchant");

    bytes32 internal constant SPEND_REQUEST_TYPEHASH = keccak256(
        "SpendRequest(address agent,address merchant,uint256 amount,bytes32 category,uint256 timestamp,uint256 deadline,uint256 nonce)"
    );

    function setUp() public {
        agent = vm.addr(agentPk);

        engine = new PolicyEngine();
        reputation = new ReputationRegistry();
        guard = new AgentWalletGuard(address(engine), address(reputation));

        engine.setAuthorizedCaller(address(guard), true);
        reputation.setReporter(address(guard), true);

        vm.prank(agent);
        engine.setPolicy(
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

        token = new MockERC20();
        token.mint(agent, 10 ether);
        vm.prank(agent);
        token.approve(address(guard), type(uint256).max);

        usdtLike = new NoReturnDataERC20();
        usdtLike.mint(agent, 10 ether);
        vm.prank(agent);
        usdtLike.approve(address(guard), type(uint256).max);
    }

    function _digest(IPolicyEngine.SpendRequest memory req) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                SPEND_REQUEST_TYPEHASH,
                req.agent,
                req.merchant,
                req.amount,
                req.category,
                req.timestamp,
                req.deadline,
                req.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", guard.DOMAIN_SEPARATOR(), structHash));
    }

    function _sign(uint256 pk, IPolicyEngine.SpendRequest memory req) internal view returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _digest(req));
        return abi.encodePacked(r, s, v);
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

    function test_EIP712_SignatureVerificationAndNonceProtection() public {
        IPolicyEngine.SpendRequest memory req = _req(0.5 ether, 1);
        bytes memory sig = _sign(agentPk, req);

        bool ok = guard.executeGatedPayment(req, sig, address(token), "");
        assertTrue(ok);
        assertEq(token.balanceOf(merchant), 0.5 ether);

        // Replaying the identical signed request must revert: the nonce was
        // already consumed by PolicyEngine on the first call.
        vm.expectRevert();
        guard.executeGatedPayment(req, sig, address(token), "");
    }

    function test_RevertOnForgedSignature() public {
        IPolicyEngine.SpendRequest memory req = _req(0.5 ether, 1);
        uint256 attackerPk = 0xBEEF;
        bytes memory forgedSig = _sign(attackerPk, req);

        vm.expectRevert(AgentWalletGuard.InvalidSignature.selector);
        guard.executeGatedPayment(req, forgedSig, address(token), "");
    }

    function test_RevertWhenPolicyDenies() public {
        IPolicyEngine.SpendRequest memory req = _req(2 ether, 1); // exceeds maxPerTx
        bytes memory sig = _sign(agentPk, req);
        vm.expectRevert();
        guard.executeGatedPayment(req, sig, address(token), "");
    }

    function test_RecordsReputationOnSuccessfulSettlement() public {
        IPolicyEngine.SpendRequest memory req = _req(0.5 ether, 1);
        bytes memory sig = _sign(agentPk, req);
        guard.executeGatedPayment(req, sig, address(token), "");
        assertGt(reputation.getScore(agent), 500_000);
    }

    function test_NativeMonSettlement() public {
        vm.deal(address(guard), 1 ether);
        IPolicyEngine.SpendRequest memory req = _req(0.3 ether, 1);
        bytes memory sig = _sign(agentPk, req);

        uint256 before = merchant.balance;
        guard.executeGatedPayment(req, sig, address(0), "");
        assertEq(merchant.balance - before, 0.3 ether);
    }

    /// @notice USDT-shaped tokens that return no data on a successful transferFrom
    /// must still settle, exercising the SafeERC20-style tolerance in
    /// AgentWalletGuard._safeTransferFrom (docs/GAP_ANALYSIS.md §2).
    function test_SettlesWithNoReturnDataToken() public {
        IPolicyEngine.SpendRequest memory req = _req(0.4 ether, 1);
        bytes memory sig = _sign(agentPk, req);
        guard.executeGatedPayment(req, sig, address(usdtLike), "");
        assertEq(usdtLike.balanceOf(merchant), 0.4 ether);
    }
}
