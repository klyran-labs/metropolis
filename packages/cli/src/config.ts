import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface CliConfig {
  apiKey?: string;
  gatewayUrl: string;
  rpcUrl?: string;
  policyEngineAddress?: string;
}

const DEFAULT_CONFIG: CliConfig = {
  gatewayUrl: process.env.AGENTGUARD_GATEWAY_URL || "http://127.0.0.1:3000",
  rpcUrl: process.env.AGENTGUARD_RPC_URL || "https://testnet-rpc.monad.xyz",
  policyEngineAddress: process.env.AGENTGUARD_POLICY_ENGINE_ADDRESS || "",
};

function getConfigPath(): string {
  const dir = process.env.AGENTGUARD_CONFIG_DIR || join(homedir(), ".agentguard");
  return join(dir, "config.json");
}

export async function loadConfig(): Promise<CliConfig> {
  const configPath = getConfigPath();
  try {
    const raw = await readFile(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_CONFIG, ...parsed };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(config: Partial<CliConfig>): Promise<void> {
  const configPath = getConfigPath();
  const dir = join(configPath, "..");
  await mkdir(dir, { recursive: true });
  const current = await loadConfig();
  const updated = { ...current, ...config };
  await writeFile(configPath, JSON.stringify(updated, null, 2), "utf8");
}
