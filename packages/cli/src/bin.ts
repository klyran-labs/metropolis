#!/usr/bin/env node
import { Command } from "commander";
import { loginCommand } from "./commands/login.js";
import { listAgentsCommand, registerAgentCommand, freezeAgentCommand, unfreezeAgentCommand } from "./commands/agents.js";
import { proxyCommand } from "./commands/proxy.js";
import { finopsCalculateCommand } from "./commands/finops.js";
import { mcpInitCommand } from "./commands/mcp.js";

const program = new Command();

program
  .name("agentguard")
  .description("Official AgentGuard CLI: Autonomous Agent Fleet Management & Monad Risk Settlement")
  .version("1.0.0");

program
  .command("login")
  .description("Authenticate developer or service account key")
  .argument("[apiKey]", "AgentGuard API key")
  .action(async (apiKey) => {
    await loginCommand(apiKey);
  });

const agents = program.command("agents").description("Manage autonomous agent fleet and policies");

agents
  .command("list")
  .description("List registered agents and their active onchain postures")
  .action(async () => {
    await listAgentsCommand();
  });

agents
  .command("register")
  .description("Register an autonomous agent on Monad")
  .requiredOption("--address <address>", "Agent Ethereum address (0x...)")
  .option("--tier <tier>", "Risk tier (tier1_conservative, tier2_standard, tier3_autonomous)", "tier2_standard")
  .option("--env <env>", "Deployment environment (production, staging)", "production")
  .action(async (opts) => {
    await registerAgentCommand(opts);
  });

agents
  .command("freeze")
  .alias("trip")
  .description("Emergency O(1) Circuit Breaker / Kill-Switch execution on Monad Parallel EVM")
  .argument("<address>", "Agent address to freeze")
  .action(async (address) => {
    await freezeAgentCommand(address);
  });

agents
  .command("unfreeze")
  .alias("reset")
  .description("Reset O(1) Circuit Breaker for agent on Monad Parallel EVM")
  .argument("<address>", "Agent address to unfreeze")
  .action(async (address) => {
    await unfreezeAgentCommand(address);
  });

program
  .command("proxy")
  .description("Start local drop-in testing proxy for OpenAI/Anthropic SDKs")
  .option("-p, --port <port>", "Port to bind local proxy", "8080")
  .option("-t, --target <url>", "Upstream AgentGuard gateway URL")
  .action(async (opts) => {
    await proxyCommand(opts);
  });

const finops = program
  .command("finops")
  .description("Simulate enterprise model pricing and dual-denomination rate cards");

finops
  .command("calculate")
  .description("Calculate dual-denomination compute vs. fiat spend across enterprise models")
  .option("-m, --model <model>", "Model identifier (e.g. claude-3-7-sonnet, gpt-4o, qwen-2.5-72b)", "claude-3-7-sonnet")
  .option("-i, --input <tokens>", "Input prompt token count", "1000")
  .option("-o, --output <tokens>", "Output generation token count", "500")
  .option("-r, --cache-read <tokens>", "Cache read token count", "0")
  .option("-w, --cache-write <tokens>", "Cache creation token count", "0")
  .option("--mon-price <usd>", "MON token spot price in USD for dual-denomination parity", "25.00")
  .action(async (opts) => {
    await finopsCalculateCommand(opts);
  });

const mcp = program
  .command("mcp")
  .description("Configure and integrate Model Context Protocol (MCP) tooling");

mcp
  .command("init")
  .description("Initialize AgentGuard / Circuit Protocol MCP server configuration for Claude Desktop and Cursor")
  .option("-c, --client <client>", "Target client: claude, cursor, or all", "all")
  .option("-g, --gateway-url <url>", "Upstream gateway URL")
  .option("-k, --api-key <key>", "AgentGuard API key")
  .option("--dry-run", "Print configuration without writing to disk")
  .option("-o, --output <path>", "Custom output file path")
  .action(async (opts) => {
    await mcpInitCommand(opts);
  });

program.parse(process.argv);
