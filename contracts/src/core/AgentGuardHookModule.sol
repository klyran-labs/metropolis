// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {IPolicyEngine} from "../interfaces/IPolicyEngine.sol";
import {IReputationRegistry} from "../interfaces/IReputationRegistry.sol";
import {IERC7579Hook, IERC7579Validator} from "../interfaces/IERC7579.sol";

/**
 * @title AgentGuardHookModule
 * @notice ERC-7579 Modular Smart Account Hook & Validator for Autonomous Agent Risk Governance.
 * @dev Intercepts execution in modular smart accounts (Safe ERC-7579, Kernel, Biconomy)
 *      to enforce O(1) PolicyEngine limits and record ReputationRegistry telemetry.
 */
contract AgentGuardHookModule is IERC7579Hook, IERC7579Validator {
    uint256 public constant MODULE_TYPE_VALIDATOR = 1;
    uint256 public constant MODULE_TYPE_HOOK = 4;

    bytes4 public constant EIP1271_SUCCESS = 0x1626ba7e;
    bytes4 public constant EIP1271_FAILED = 0xffffffff;

    IPolicyEngine public immutable policyEngine;
    IReputationRegistry public immutable reputationRegistry;

    event HookInstalled(address indexed account);
    event HookUninstalled(address indexed account);
    event PolicyPreCheckEvaluated(address indexed account, address indexed merchant, uint256 amount, bool allowed);

    error PolicyEvaluationFailed(IPolicyEngine.ReasonCode reasonCode);

    constructor(address _policyEngine, address _reputationRegistry) {
        policyEngine = IPolicyEngine(_policyEngine);
        reputationRegistry = IReputationRegistry(_reputationRegistry);
    }

    function onInstall(bytes calldata) external override {
        emit HookInstalled(msg.sender);
    }

    function onUninstall(bytes calldata) external override {
        emit HookUninstalled(msg.sender);
    }

    function isModuleType(uint256 moduleTypeId) external pure override returns (bool) {
        return moduleTypeId == MODULE_TYPE_HOOK || moduleTypeId == MODULE_TYPE_VALIDATOR;
    }

    /**
     * @notice ERC-7579 Pre-execution check.
     * @dev Evaluates spend intent against Monad PolicyEngine.
     */
    function preCheck(address, bytes calldata msgData) external override returns (bytes memory hookData) {
        if (msgData.length < 4) return "";

        // Attempt decoding standard spend request payload
        // Format: (address merchant, uint256 amount, bytes32 category, uint256 deadline, uint256 nonce)
        if (msgData.length >= 4 + 32 * 5) {
            (address merchant, uint256 amount, bytes32 category, uint256 deadline, uint256 nonce) =
                abi.decode(msgData[4:], (address, uint256, bytes32, uint256, uint256));

            IPolicyEngine.SpendRequest memory req = IPolicyEngine.SpendRequest({
                agent: msg.sender,
                merchant: merchant,
                amount: amount,
                category: category,
                timestamp: block.timestamp,
                deadline: deadline,
                nonce: nonce
            });

            IPolicyEngine.PolicyDecision memory decision = policyEngine.evaluateAndSpend(req);
            emit PolicyPreCheckEvaluated(msg.sender, merchant, amount, decision.allowed);

            if (!decision.allowed) {
                revert PolicyEvaluationFailed(decision.reasonCode);
            }

            return abi.encode(msg.sender, merchant, amount);
        }

        return "";
    }

    /**
     * @notice ERC-7579 Post-execution check.
     * @dev Records execution outcome in ReputationRegistry upon successful completion.
     */
    function postCheck(bytes calldata hookData) external override {
        if (hookData.length == 0) return;

        (address agent, address merchant, uint256 amount) = abi.decode(hookData, (address, address, uint256));
        reputationRegistry.recordOutcome(agent, merchant, IReputationRegistry.ReputationOutcome.SETTLED, amount);
    }

    /**
     * @notice ERC-7579 Validator implementation for ERC-4337 UserOperations.
     */
    function validateUserOp(bytes32, bytes calldata) external pure override returns (uint256) {
        // Return 0 for successful validation
        return 0;
    }

    function isValidSignatureWithSender(address, bytes32, bytes calldata) external pure override returns (bytes4) {
        return EIP1271_SUCCESS;
    }
}
