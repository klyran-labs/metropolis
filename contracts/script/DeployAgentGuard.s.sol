// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {PolicyEngine} from "../src/core/PolicyEngine.sol";
import {ReputationRegistry} from "../src/core/ReputationRegistry.sol";
import {AgentWalletGuard} from "../src/core/AgentWalletGuard.sol";

/**
 * @title DeployAgentGuard
 * @notice Foundry deployment script for AgentGuard protocol on Monad Testnet (Chain ID 10143).
 * Deploys PolicyEngine, ReputationRegistry, and AgentWalletGuard with disjoint state architecture,
 * then wires AgentWalletGuard as the sole authorized PolicyEngine caller for evaluateAndSpend.
 */
contract DeployAgentGuard {
    function run()
        external
        returns (address policyEngineAddr, address reputationRegistryAddr, address agentWalletGuardAddr)
    {
        // 1. Deploy O(1) PolicyEngine with single 32-byte slot packing
        PolicyEngine policyEngine = new PolicyEngine();
        policyEngineAddr = address(policyEngine);

        // 2. Deploy EWMA ReputationRegistry
        ReputationRegistry reputationRegistry = new ReputationRegistry();
        reputationRegistryAddr = address(reputationRegistry);

        // 3. Deploy AgentWalletGuard gating EIP-712 spend requests
        AgentWalletGuard guard = new AgentWalletGuard(policyEngineAddr, reputationRegistryAddr);
        agentWalletGuardAddr = address(guard);

        // 4. Authorize AgentWalletGuard as the only contract permitted to call
        //    PolicyEngine.evaluateAndSpend on an agent's behalf (closes the
        //    unauthenticated-caller griefing vector — see docs/GAP_ANALYSIS.md 1.3).
        policyEngine.setAuthorizedCaller(agentWalletGuardAddr, true);

        // 5. Authorize AgentWalletGuard to report settlement outcomes to the
        //    reputation registry.
        reputationRegistry.setReporter(agentWalletGuardAddr, true);
    }
}
