import { isAddress } from "viem";
import { loadConfig } from "../config.js";

export async function listAgentsCommand(): Promise<void> {
  const config = await loadConfig();
  const apiKey = config.apiKey || process.env.AGENTGUARD_API_KEY;

  const res = await fetch(`${config.gatewayUrl}/api/v1/agents`, {
    headers: {
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      Accept: "application/json",
    },
  }).catch((err) => {
    console.error(`Failed to connect to gateway at ${config.gatewayUrl}:`, err.message);
    process.exit(1);
  });

  if (!res.ok) {
    console.error(`Gateway returned error status: ${res.status} ${res.statusText}`);
    process.exit(1);
  }

  const agents = (await res.json()) as Array<{
    address: string;
    adminAddress: string;
    environment: string;
    riskTier: string;
    status: string;
    createdAt: string;
  }>;

  if (agents.length === 0) {
    console.log("No autonomous agents registered in current tenant scope.");
    return;
  }

  console.log("\nRegistered Autonomous Agents (Monad Parallel EVM):");
  console.log("─".repeat(88));
  console.log(
    "Address".padEnd(44) +
    "Risk Tier".padEnd(20) +
    "Status".padEnd(12) +
    "Environment"
  );
  console.log("─".repeat(88));

  for (const a of agents) {
    console.log(
      a.address.padEnd(44) +
      a.riskTier.padEnd(20) +
      a.status.padEnd(12) +
      a.environment
    );
  }
  console.log("─".repeat(88) + "\n");
}

export async function registerAgentCommand(options: {
  address: string;
  tier?: string;
  env?: string;
  maxPerTx?: string;
  maxPerWindow?: string;
  windowDuration?: string;
  velocity?: string;
}): Promise<void> {
  if (!isAddress(options.address)) {
    console.error("Error: Invalid Ethereum address format.");
    process.exit(1);
  }

  const config = await loadConfig();
  const apiKey = config.apiKey || process.env.AGENTGUARD_API_KEY;

  const payload = {
    address: options.address,
    riskTier: options.tier || "tier2_standard",
    environment: options.env || "production",
  };

  const res = await fetch(`${config.gatewayUrl}/api/v1/agents`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify(payload),
  }).catch((err) => {
    console.error(`Failed to register agent at ${config.gatewayUrl}:`, err.message);
    process.exit(1);
  });

  if (!res.ok) {
    const errorBody = await res.json().catch(() => ({}));
    console.error(`Registration failed: ${res.status}`, errorBody);
    process.exit(1);
  }

  console.log(`✓ Autonomous agent ${options.address} registered successfully on Monad.`);
}

export async function freezeAgentCommand(agentAddress: string): Promise<void> {
  if (!isAddress(agentAddress)) {
    console.error("Error: Invalid Ethereum address format.");
    process.exit(1);
  }

  const config = await loadConfig();
  const apiKey = config.apiKey || process.env.AGENTGUARD_API_KEY;

  console.log(`Broadcasting O(1) Kill-Switch execution for agent ${agentAddress} to Monad Parallel EVM...`);

  // Dispatches freeze request to gateway
  const res = await fetch(`${config.gatewayUrl}/api/v1/agents/${agentAddress}/policy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      killSwitch: true,
      maxPerTx: "0",
      maxPerWindow: "0",
      windowSeconds: 3600,
      maxVelocity: 0,
      whitelistEnabled: true,
    }),
  }).catch((err) => {
    console.error(`Failed to contact gateway:`, err.message);
    process.exit(1);
  });

  if (!res.ok) {
    console.error(`Kill-Switch broadcast returned: ${res.status}`);
    process.exit(1);
  }

  console.log(`✓ Agent ${agentAddress} quarantined successfully. Monad O(1) circuit breaker active.`);
}

export async function unfreezeAgentCommand(agentAddress: string): Promise<void> {
  if (!isAddress(agentAddress)) {
    console.error("Error: Invalid Ethereum address format.");
    process.exit(1);
  }

  const config = await loadConfig();
  const apiKey = config.apiKey || process.env.AGENTGUARD_API_KEY;

  console.log(`Resetting Circuit Breaker for agent ${agentAddress} on Monad Parallel EVM...`);

  const res = await fetch(`${config.gatewayUrl}/api/v1/agents/${agentAddress}/policy`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    },
    body: JSON.stringify({
      killSwitch: false,
    }),
  }).catch((err) => {
    console.error(`Failed to contact gateway:`, err.message);
    process.exit(1);
  });

  if (!res.ok) {
    console.error(`Reset broadcast returned: ${res.status}`);
    process.exit(1);
  }

  console.log(`✓ Agent ${agentAddress} restored successfully. Monad circuit breaker reset.`);
}
