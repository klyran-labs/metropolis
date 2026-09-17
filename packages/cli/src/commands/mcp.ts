import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { loadConfig } from "../config.js";

export interface McpInitOptions {
  client?: "claude" | "cursor" | "all";
  gatewayUrl?: string;
  apiKey?: string;
  dryRun?: boolean;
  output?: string;
}

export function generateMcpServerConfig(gatewayUrl: string, apiKey?: string) {
  return {
    command: "npx",
    args: ["-y", "@agentguard/mcp-server"],
    env: {
      AGENTGUARD_GATEWAY_URL: gatewayUrl,
      ...(apiKey ? { AGENTGUARD_API_KEY: apiKey } : {}),
    },
  };
}

export async function mcpInitCommand(options: McpInitOptions): Promise<void> {
  const config = await loadConfig();
  const gatewayUrl = options.gatewayUrl || config.gatewayUrl || "http://127.0.0.1:3000";
  const apiKey = options.apiKey || config.apiKey || process.env.AGENTGUARD_API_KEY;
  const client = options.client || "all";

  const mcpEntry = generateMcpServerConfig(gatewayUrl, apiKey);

  console.log("\nAgentGuard / Circuit Protocol MCP Initialization");
  console.log("═".repeat(68));
  console.log(`Gateway Upstream:  ${gatewayUrl}`);
  console.log(`Client Target:     ${client}`);
  console.log(`API Key Provided:  ${apiKey ? "Yes (Masked)" : "No (Local/Anonymous Mode)"}`);
  console.log("═".repeat(68));

  if (options.dryRun) {
    console.log("\n[DRY RUN] Generated Claude Desktop & Cursor MCP Configuration:\n");
    console.log(
      JSON.stringify(
        {
          mcpServers: {
            circuit: mcpEntry,
          },
        },
        null,
        2
      )
    );
    console.log("\nNo files modified (--dry-run active).\n");
    return;
  }

  const targets: Array<{ name: string; path: string }> = [];

  if (options.output) {
    targets.push({ name: "Custom Path", path: options.output });
  } else {
    if (client === "claude" || client === "all") {
      const claudePath =
        process.platform === "darwin"
          ? join(homedir(), "Library/Application Support/Claude/claude_desktop_config.json")
          : process.platform === "win32"
          ? join(process.env.APPDATA || "", "Claude/claude_desktop_config.json")
          : join(homedir(), ".config/Claude/claude_desktop_config.json");
      targets.push({ name: "Claude Desktop", path: claudePath });
    }

    if (client === "cursor" || client === "all") {
      targets.push({ name: "Cursor Workspace", path: join(process.cwd(), ".cursor/mcp.json") });
    }
  }

  for (const target of targets) {
    try {
      let existingConfig: any = { mcpServers: {} };
      try {
        const raw = await readFile(target.path, "utf8");
        existingConfig = JSON.parse(raw);
        if (!existingConfig.mcpServers) {
          existingConfig.mcpServers = {};
        }
      } catch {
        // File does not exist yet or empty
      }

      existingConfig.mcpServers.circuit = mcpEntry;

      await mkdir(dirname(target.path), { recursive: true });
      await writeFile(target.path, JSON.stringify(existingConfig, null, 2) + "\n", "utf8");
      console.log(`✔ Initialized MCP configuration for ${target.name} at:`);
      console.log(`  ${target.path}`);
    } catch (err: any) {
      console.warn(`! Could not write ${target.name} config (${err.message}). Configuration printed below:\n`);
      console.log(JSON.stringify({ mcpServers: { circuit: mcpEntry } }, null, 2));
    }
  }

  console.log("\nCircuit Protocol MCP Server is now configured and ready.");
  console.log("Restart your AI client (Cursor / Claude Desktop) to activate the 5 supervisory tools:\n");
  console.log("  1. agentguard_check_budget           - Check session token & financial limits");
  console.log("  2. agentguard_inspect_limits         - Inspect 400ms finality & O(1) kill switch");
  console.log("  3. agentguard_request_spend_elevation - Request multisig quorum budget elevation");
  console.log("  4. circuit_trip_emergency_breaker    - Emergency freeze rogue bot in 400ms");
  console.log("  5. circuit_inspect_tba_passport      - Inspect ERC-6551 passport & trust reputation\n");
}
