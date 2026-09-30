// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {Test} from "forge-std/Test.sol";
import {MevShieldedRelayer} from "../src/core/MevShieldedRelayer.sol";
import {IMevShieldedRelayer} from "../src/interfaces/IMevShieldedRelayer.sol";

contract MockTargetContract {
    uint256 public counter;

    function increment() external {
        counter += 1;
    }

    function failingCall() external pure {
        revert("TargetFailure");
    }

    function refundSender() external payable {
        // Sends some ether back to caller as simulated searcher refund
        (bool s,) = msg.sender.call{value: msg.value + 0.1 ether}("");
        require(s, "RefundFailed");
    }

    receive() external payable {}
}

contract MevShieldedRelayerTest is Test {
    MevShieldedRelayer public relayer;
    MockTargetContract public target;
    address public beneficiary = address(0x9999);

    function setUp() public {
        relayer = new MevShieldedRelayer();
        target = new MockTargetContract();
        vm.deal(address(target), 10 ether);
        vm.deal(address(this), 10 ether);
    }

    function test_ExecuteBundle_Success() public {
        IMevShieldedRelayer.BundleCall[] memory calls = new IMevShieldedRelayer.BundleCall[](2);
        calls[0] = IMevShieldedRelayer.BundleCall({
            target: address(target),
            value: 0,
            callData: abi.encodeWithSelector(MockTargetContract.increment.selector)
        });
        calls[1] = IMevShieldedRelayer.BundleCall({
            target: address(target),
            value: 0,
            callData: abi.encodeWithSelector(MockTargetContract.increment.selector)
        });

        IMevShieldedRelayer.MevProtectionParams memory params = IMevShieldedRelayer.MevProtectionParams({
            minBackrunRefund: 0,
            maxPriorityFee: 2 gwei,
            deadline: block.timestamp + 3600,
            bundleId: keccak256("BUNDLE_1001"),
            beneficiary: beneficiary
        });

        (bool success, uint256 refund) = relayer.executeMevShieldedBundle(calls, params);
        assertTrue(success);
        assertEq(refund, 0);
        assertEq(target.counter(), 2);
    }

    function test_ExecuteBundle_AtomicRollbackOnFailure() public {
        IMevShieldedRelayer.BundleCall[] memory calls = new IMevShieldedRelayer.BundleCall[](2);
        calls[0] = IMevShieldedRelayer.BundleCall({
            target: address(target),
            value: 0,
            callData: abi.encodeWithSelector(MockTargetContract.increment.selector)
        });
        calls[1] = IMevShieldedRelayer.BundleCall({
            target: address(target),
            value: 0,
            callData: abi.encodeWithSelector(MockTargetContract.failingCall.selector)
        });

        IMevShieldedRelayer.MevProtectionParams memory params = IMevShieldedRelayer.MevProtectionParams({
            minBackrunRefund: 0,
            maxPriorityFee: 2 gwei,
            deadline: block.timestamp + 3600,
            bundleId: keccak256("BUNDLE_1002"),
            beneficiary: beneficiary
        });

        vm.expectRevert();
        relayer.executeMevShieldedBundle(calls, params);

        // Counter must remain 0 due to atomic rollback
        assertEq(target.counter(), 0);
    }

    function test_ExecuteBundle_ExpiredDeadlineReverts() public {
        IMevShieldedRelayer.BundleCall[] memory calls = new IMevShieldedRelayer.BundleCall[](1);
        calls[0] = IMevShieldedRelayer.BundleCall({
            target: address(target),
            value: 0,
            callData: abi.encodeWithSelector(MockTargetContract.increment.selector)
        });

        IMevShieldedRelayer.MevProtectionParams memory params = IMevShieldedRelayer.MevProtectionParams({
            minBackrunRefund: 0,
            maxPriorityFee: 2 gwei,
            deadline: block.timestamp - 1, // expired
            bundleId: keccak256("BUNDLE_1003"),
            beneficiary: beneficiary
        });

        vm.expectRevert(IMevShieldedRelayer.BundleExpired.selector);
        relayer.executeMevShieldedBundle(calls, params);
    }
}
