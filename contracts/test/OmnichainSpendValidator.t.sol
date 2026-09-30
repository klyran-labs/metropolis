// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {OmnichainSpendValidator} from "../src/core/OmnichainSpendValidator.sol";
import {IOmnichainSpendValidator} from "../src/interfaces/IOmnichainSpendValidator.sol";
import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {IPolicyEngine} from "../src/interfaces/IPolicyEngine.sol";

contract OmnichainSpendValidatorTest is Test {
    PolicyEngine public policyEngine;
    OmnichainSpendValidator public validator;

    uint256 public validatorPk = 0xAA11;
    address public validatorSigner;
    address public agent = address(0x4444);
    address public merchant = address(0x5555);
    address public token = address(0x6666);

    function setUp() public {
        validatorSigner = vm.addr(validatorPk);
        policyEngine = new PolicyEngine();
        validator = new OmnichainSpendValidator(address(policyEngine), validatorSigner);

        // Authorize validator in PolicyEngine
        policyEngine.setAuthorizedCaller(address(validator), true);

        // Configure agent policy: Max 100 USDC per tx, 500 per window
        IPolicyEngine.SpendPolicy memory policy = IPolicyEngine.SpendPolicy({
            maxPerTx: 100_000_000,
            maxPerWindow: 500_000_000,
            windowSeconds: 3600,
            maxVelocity: 100,
            killSwitch: false,
            whitelistEnabled: false
        });
        policyEngine.setPolicy(agent, policy);
    }

    function _signPermit(bytes32 permitHash, uint256 pk) internal view returns (bytes memory) {
        bytes32 ethSignedDigest = keccak256(
            abi.encodePacked("\x19Ethereum Signed Message:\n32", permitHash)
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, ethSignedDigest);
        return abi.encodePacked(r, s, v);
    }

    function test_IssueCrossChainPermit_Success() public {
        (IOmnichainSpendValidator.CrossChainSpendPermit memory permit, bytes32 permitHash) =
            validator.issueCrossChainPermit(
                agent,
                8453, // Base
                merchant,
                token,
                50_000_000, // 50 USDC
                3600,
                bytes32(0)
            );

        assertEq(permit.agent, agent);
        assertEq(permit.targetChainId, 8453);
        assertEq(permit.amount, 50_000_000);
        assertTrue(permitHash != bytes32(0));
    }

    function test_IssueCrossChainPermit_PolicyDenied() public {
        // Exceeds maxPerTx of 100 USDC
        vm.expectRevert(
            abi.encodeWithSelector(
                IOmnichainSpendValidator.PolicyEvaluationFailed.selector,
                uint8(IPolicyEngine.ReasonCode.ERR_MAX_PER_TX)
            )
        );
        validator.issueCrossChainPermit(
            agent,
            8453,
            merchant,
            token,
            150_000_000, // 150 USDC > 100 USDC
            3600,
            bytes32(0)
        );
    }

    function test_VerifyAndRedeemPermit_Success() public {
        (IOmnichainSpendValidator.CrossChainSpendPermit memory permit, bytes32 permitHash) =
            validator.issueCrossChainPermit(
                agent,
                42161, // Arbitrum
                merchant,
                token,
                25_000_000,
                3600,
                bytes32(0)
            );

        bytes memory sig = _signPermit(permitHash, validatorPk);
        bool redeemed = validator.verifyAndRedeemPermit(permit, sig);
        assertTrue(redeemed);
        assertTrue(validator.isPermitRedeemed(permitHash));

        // Replay must revert
        vm.expectRevert(IOmnichainSpendValidator.PermitAlreadyRedeemed.selector);
        validator.verifyAndRedeemPermit(permit, sig);
    }

    function test_VerifyAndRedeemPermit_ExpiredReverts() public {
        (IOmnichainSpendValidator.CrossChainSpendPermit memory permit, bytes32 permitHash) =
            validator.issueCrossChainPermit(
                agent,
                1, // Ethereum L1
                merchant,
                token,
                10_000_000,
                60, // 60 seconds
                bytes32(0)
            );

        bytes memory sig = _signPermit(permitHash, validatorPk);

        vm.warp(block.timestamp + 100); // Expired
        vm.expectRevert(IOmnichainSpendValidator.PermitExpired.selector);
        validator.verifyAndRedeemPermit(permit, sig);
    }
}
