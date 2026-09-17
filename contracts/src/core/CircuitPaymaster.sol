// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ICircuitPaymaster} from "../interfaces/ICircuitPaymaster.sol";
import {IPolicyEngine} from "../interfaces/IPolicyEngine.sol";
import {TransientReentrancyGuard} from "../libraries/TransientReentrancyGuard.sol";

/**
 * @title CircuitPaymaster
 * @notice Production ERC-4337 / ERC-7677 Enterprise Gas Paymaster for Monad Parallel EVM.
 * @dev Enforces O(1) circuit breaker verification, disjoint storage slot accounting,
 *      and organization treasury gas debiting with Cancun transient reentrancy protection.
 */
contract CircuitPaymaster is ICircuitPaymaster, TransientReentrancyGuard {
    address public immutable owner;
    address public immutable entryPoint;
    IPolicyEngine public immutable policyEngine;

    // Disjoint storage slot partitioning: treasury balances and agent bindings
    mapping(address => uint256) public treasuryBalances;
    mapping(address => address) public agentToTreasury;

    error CallerNotEntryPoint();
    error Unauthorized();
    error ZeroAddress();
    error ZeroDeposit();
    error InsufficientTreasuryBalance();
    error SponsorshipRejected(uint8 reasonCode);
    error NativeTransferFailed();

    modifier onlyOwner() {
        _onlyOwner();
        _;
    }

    function _onlyOwner() internal view {
        if (msg.sender != owner) revert Unauthorized();
    }

    modifier onlyEntryPoint() {
        _onlyEntryPoint();
        _;
    }

    function _onlyEntryPoint() internal view {
        if (msg.sender != entryPoint) revert CallerNotEntryPoint();
    }

    constructor(address _owner, address _entryPoint, address _policyEngine) {
        if (_owner == address(0) || _entryPoint == address(0) || _policyEngine == address(0)) {
            revert ZeroAddress();
        }
        owner = _owner;
        entryPoint = _entryPoint;
        policyEngine = IPolicyEngine(_policyEngine);
    }

    receive() external payable {
        // Default deposit credited to sender treasury
        if (msg.value > 0) {
            treasuryBalances[msg.sender] += msg.value;
            emit TreasuryDeposited(msg.sender, msg.value);
        }
    }

    function depositGas(address treasury) external payable override {
        if (msg.value == 0) revert ZeroDeposit();
        treasuryBalances[treasury] += msg.value;
        emit TreasuryDeposited(treasury, msg.value);
    }

    function withdrawGas(address treasury, uint256 amount) external override nonReentrant {
        if (msg.sender != treasury && msg.sender != owner) revert Unauthorized();
        if (treasuryBalances[treasury] < amount) revert InsufficientTreasuryBalance();

        treasuryBalances[treasury] -= amount;
        (bool success, ) = payable(msg.sender).call{value: amount}("");
        if (!success) revert NativeTransferFailed();

        emit TreasuryWithdrawn(treasury, amount);
    }

    function setAgentTreasury(address agent, address treasury) external override {
        if (msg.sender != owner && msg.sender != treasury) revert Unauthorized();
        agentToTreasury[agent] = treasury;
        emit AgentTreasuryAssigned(agent, treasury);
    }

    function isSponsorshipEligible(address agent, uint256 maxCost)
        public
        view
        override
        returns (bool eligible, uint8 reasonCode)
    {
        // 1. O(1) Short-circuit: Check if agent is currently tripped by circuit breaker
        if (policyEngine.isCircuitBroken(agent)) {
            // forge-lint: disable-next-line(boolean-cst)
            return (false, 8); // ERR_CIRCUIT_BREAKER_ACTIVE
        }

        // 2. Validate organization treasury link
        address treasury = agentToTreasury[agent];
        if (treasury == address(0)) {
            // forge-lint: disable-next-line(boolean-cst)
            return (false, 1); // ERR_AGENT_NOT_AUTHORIZED
        }

        // 3. Verify treasury gas balance
        if (treasuryBalances[treasury] < maxCost) {
            // forge-lint: disable-next-line(boolean-cst)
            return (false, 6); // ERR_BUDGET_EXCEEDED
        }

        // forge-lint: disable-next-line(boolean-cst)
        return (true, 0); // ERR_NONE
    }

    function validatePaymasterUserOp(
        UserOperation calldata userOp,
        bytes32 /* userOpHash */,
        uint256 maxCost
    ) external override onlyEntryPoint returns (bytes memory context, uint256 validationData) {
        address agent = userOp.sender;
        (bool eligible, uint8 reasonCode) = isSponsorshipEligible(agent, maxCost);
        if (!eligible) revert SponsorshipRejected(reasonCode);

        address treasury = agentToTreasury[agent];
        treasuryBalances[treasury] -= maxCost;

        context = abi.encode(agent, treasury, maxCost);
        // validationData: 0 indicates valid signature and valid for all time
        return (context, 0);
    }

    function postOp(
        PostOpMode /* mode */,
        bytes calldata context,
        uint256 actualGasCost
    ) external override onlyEntryPoint {
        (address agent, address treasury, uint256 maxCost) = abi.decode(context, (address, address, uint256));

        // Refund reserved but unspent gas back to the organization treasury
        if (maxCost > actualGasCost) {
            uint256 unusedGas = maxCost - actualGasCost;
            treasuryBalances[treasury] += unusedGas;
        }

        emit GasSponsored(agent, treasury, actualGasCost);
    }
}
