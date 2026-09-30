// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {AgentDelegationAccount} from "../src/core/AgentDelegationAccount.sol";
import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {ReputationRegistry} from "../src/core/ReputationRegistry.sol";
import {IPolicyEngine} from "../src/interfaces/IPolicyEngine.sol";

contract MockDelegationERC20 {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AgentDelegationAccountTest is Test {
    PolicyEngine internal policyEngine;
    ReputationRegistry internal reputationRegistry;
    AgentDelegationAccount internal delegationTarget;
    MockDelegationERC20 internal token;

    uint256 internal supervisorPk = 0xA11CE;
    address internal supervisor;

    uint256 internal workerPk = 0xB0B;
    address internal worker;

    address internal merchant = address(0xEEEE);

    function setUp() public {
        vm.warp(10000);
        supervisor = vm.addr(supervisorPk);
        worker = vm.addr(workerPk);

        policyEngine = new PolicyEngine();
        reputationRegistry = new ReputationRegistry();
        token = new MockDelegationERC20();

        delegationTarget = new AgentDelegationAccount(address(policyEngine), address(reputationRegistry));
        reputationRegistry.setReporter(address(delegationTarget), true);

        // Fund supervisor and approve
        token.mint(address(delegationTarget), 100_000_000); // 100 USDC

        // Set policy on PolicyEngine for delegationTarget
        IPolicyEngine.SpendPolicy memory policy = IPolicyEngine.SpendPolicy({
            maxPerTx: 50_000_000, // 50 USDC
            maxPerWindow: 200_000_000,
            windowSeconds: 3600,
            maxVelocity: 100,
            killSwitch: false,
            whitelistEnabled: false
        });
        policyEngine.setPolicy(address(delegationTarget), policy);
        policyEngine.setAgentAdmin(address(delegationTarget), supervisor);
    }

    function _signSupervisor(
        AgentDelegationAccount.SessionCertificate memory cert,
        uint256 pk
    ) internal view returns (bytes memory) {
        bytes32 messageHash = keccak256(
            abi.encode(
                cert.supervisor,
                cert.workerSigner,
                cert.validAfter,
                cert.validUntil,
                cert.subBudgetCap,
                cert.capabilityMerkleRoot,
                cert.sessionNonce,
                block.chainid
            )
        );
        bytes32 ethSignedDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethSignedDigest);
        return abi.encodePacked(r, s, v);
    }

    function _signWorker(
        uint256 sessionNonce,
        AgentDelegationAccount.DelegatedPayment memory p,
        uint256 pk
    ) internal view returns (bytes memory) {
        bytes32 messageHash = keccak256(
            abi.encode(
                sessionNonce,
                p.merchant,
                p.amount,
                p.token,
                p.category,
                p.deadline,
                p.nonce,
                block.chainid
            )
        );
        bytes32 ethSignedDigest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", messageHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethSignedDigest);
        return abi.encodePacked(r, s, v);
    }

    function test_ExecuteSignedSessionDelegation_Success() public {
        AgentDelegationAccount.SessionCertificate memory cert = AgentDelegationAccount.SessionCertificate({
            supervisor: supervisor,
            workerSigner: worker,
            validAfter: uint64(block.timestamp - 10),
            validUntil: uint64(block.timestamp + 3600),
            subBudgetCap: 10_000_000, // 10 USDC
            capabilityMerkleRoot: bytes32(0),
            sessionNonce: 101
        });
        bytes memory certSig = _signSupervisor(cert, supervisorPk);

        AgentDelegationAccount.DelegatedPayment memory p = AgentDelegationAccount.DelegatedPayment({
            merchant: merchant,
            amount: 2_000_000, // 2 USDC
            token: address(token),
            category: bytes32(0),
            deadline: block.timestamp + 1000,
            nonce: 1,
            extraCallData: ""
        });
        bytes memory workerSig = _signWorker(cert.sessionNonce, p, workerPk);

        bool success = delegationTarget.executeSignedSessionDelegation(cert, certSig, p, workerSig);
        assertTrue(success);
        assertEq(delegationTarget.sessionSpent(101), 2_000_000);
        assertEq(token.balanceOf(merchant), 2_000_000);
    }

    function test_ExecuteSignedSessionDelegation_SubBudgetExceeded() public {
        AgentDelegationAccount.SessionCertificate memory cert = AgentDelegationAccount.SessionCertificate({
            supervisor: supervisor,
            workerSigner: worker,
            validAfter: uint64(block.timestamp - 10),
            validUntil: uint64(block.timestamp + 3600),
            subBudgetCap: 5_000_000, // 5 USDC
            capabilityMerkleRoot: bytes32(0),
            sessionNonce: 102
        });
        bytes memory certSig = _signSupervisor(cert, supervisorPk);

        AgentDelegationAccount.DelegatedPayment memory p = AgentDelegationAccount.DelegatedPayment({
            merchant: merchant,
            amount: 6_000_000, // 6 USDC > 5 USDC
            token: address(token),
            category: bytes32(0),
            deadline: block.timestamp + 1000,
            nonce: 1,
            extraCallData: ""
        });
        bytes memory workerSig = _signWorker(cert.sessionNonce, p, workerPk);

        vm.expectRevert(AgentDelegationAccount.SubBudgetExceeded.selector);
        delegationTarget.executeSignedSessionDelegation(cert, certSig, p, workerSig);
    }

    function test_ExecuteSignedSessionDelegation_SessionExpired() public {
        AgentDelegationAccount.SessionCertificate memory cert = AgentDelegationAccount.SessionCertificate({
            supervisor: supervisor,
            workerSigner: worker,
            validAfter: uint64(block.timestamp - 100),
            validUntil: uint64(block.timestamp - 10), // expired
            subBudgetCap: 10_000_000,
            capabilityMerkleRoot: bytes32(0),
            sessionNonce: 103
        });
        bytes memory certSig = _signSupervisor(cert, supervisorPk);

        AgentDelegationAccount.DelegatedPayment memory p = AgentDelegationAccount.DelegatedPayment({
            merchant: merchant,
            amount: 1_000_000,
            token: address(token),
            category: bytes32(0),
            deadline: block.timestamp + 1000,
            nonce: 1,
            extraCallData: ""
        });
        bytes memory workerSig = _signWorker(cert.sessionNonce, p, workerPk);

        vm.expectRevert(AgentDelegationAccount.SessionExpired.selector);
        delegationTarget.executeSignedSessionDelegation(cert, certSig, p, workerSig);
    }

    function test_ExecuteSignedSessionDelegation_InvalidSupervisor() public {
        AgentDelegationAccount.SessionCertificate memory cert = AgentDelegationAccount.SessionCertificate({
            supervisor: supervisor,
            workerSigner: worker,
            validAfter: uint64(block.timestamp - 10),
            validUntil: uint64(block.timestamp + 3600),
            subBudgetCap: 10_000_000,
            capabilityMerkleRoot: bytes32(0),
            sessionNonce: 104
        });
        // Signed with attacker/worker key instead of supervisor key
        bytes memory certSig = _signSupervisor(cert, workerPk);

        AgentDelegationAccount.DelegatedPayment memory p = AgentDelegationAccount.DelegatedPayment({
            merchant: merchant,
            amount: 1_000_000,
            token: address(token),
            category: bytes32(0),
            deadline: block.timestamp + 1000,
            nonce: 1,
            extraCallData: ""
        });
        bytes memory workerSig = _signWorker(cert.sessionNonce, p, workerPk);

        vm.expectRevert(AgentDelegationAccount.InvalidSupervisorSignature.selector);
        delegationTarget.executeSignedSessionDelegation(cert, certSig, p, workerSig);
    }

    function test_ExecuteSignedSessionDelegation_InvalidWorker() public {
        AgentDelegationAccount.SessionCertificate memory cert = AgentDelegationAccount.SessionCertificate({
            supervisor: supervisor,
            workerSigner: worker,
            validAfter: uint64(block.timestamp - 10),
            validUntil: uint64(block.timestamp + 3600),
            subBudgetCap: 10_000_000,
            capabilityMerkleRoot: bytes32(0),
            sessionNonce: 105
        });
        bytes memory certSig = _signSupervisor(cert, supervisorPk);

        AgentDelegationAccount.DelegatedPayment memory p = AgentDelegationAccount.DelegatedPayment({
            merchant: merchant,
            amount: 1_000_000,
            token: address(token),
            category: bytes32(0),
            deadline: block.timestamp + 1000,
            nonce: 1,
            extraCallData: ""
        });
        // Signed with supervisor key instead of authorized worker key
        bytes memory workerSig = _signWorker(cert.sessionNonce, p, supervisorPk);

        vm.expectRevert(AgentDelegationAccount.InvalidWorkerSignature.selector);
        delegationTarget.executeSignedSessionDelegation(cert, certSig, p, workerSig);
    }
}
