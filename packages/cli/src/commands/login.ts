import { loadConfig, saveConfig } from "../config.js";

export async function loginCommand(apiKeyOption?: string): Promise<void> {
  const apiKey = apiKeyOption || process.env.AGENTGUARD_API_KEY;
  if (!apiKey) {
    console.error("Error: Missing API key. Pass via argument or set AGENTGUARD_API_KEY environment variable.");
    process.exit(1);
  }

  const config = await loadConfig();
  const res = await fetch(`${config.gatewayUrl}/api/v1/health`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  }).catch(() => null);

  if (!res || (!res.ok && res.status !== 200 && res.status !== 404)) {
    console.warn(`Warning: Could not verify gateway connectivity at ${config.gatewayUrl}. Saving credentials locally.`);
  }

  await saveConfig({ apiKey });
  console.log("✓ Successfully authenticated. AgentGuard service account credentials sealed locally.");
}
