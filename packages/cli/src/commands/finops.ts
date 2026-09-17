import { loadConfig } from "../config.js";

export interface FinOpsCalculateOptions {
  model?: string;
  input?: string;
  output?: string;
  cacheRead?: string;
  cacheWrite?: string;
  monPrice?: string;
}

const DEFAULT_RATES: Record<
  string,
  { inRate: number; outRate: number; cacheReadRate: number; cacheWriteRate: number }
> = {
  "claude-3-7-sonnet": {
    inRate: 3_000_000,
    outRate: 15_000_000,
    cacheReadRate: 300_000,
    cacheWriteRate: 3_750_000,
  },
  "claude-3-5-sonnet": {
    inRate: 3_000_000,
    outRate: 15_000_000,
    cacheReadRate: 300_000,
    cacheWriteRate: 3_750_000,
  },
  "gpt-4o": {
    inRate: 2_500_000,
    outRate: 10_000_000,
    cacheReadRate: 1_250_000,
    cacheWriteRate: 2_500_000,
  },
  "qwen-2.5-72b": {
    inRate: 400_000,
    outRate: 1_200_000,
    cacheReadRate: 100_000,
    cacheWriteRate: 500_000,
  },
};

export async function finopsCalculateCommand(options: FinOpsCalculateOptions): Promise<void> {
  const model = options.model || "claude-3-7-sonnet";
  const inputTokens = parseInt(options.input || "1000", 10);
  const outputTokens = parseInt(options.output || "500", 10);
  const cacheReadTokens = parseInt(options.cacheRead || "0", 10);
  const cacheWriteTokens = parseInt(options.cacheWrite || "0", 10);
  const monPriceUsd = parseFloat(options.monPrice || "25.00");

  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

  const rates =
    DEFAULT_RATES[model] || {
      inRate: 3_000_000,
      outRate: 15_000_000,
      cacheReadRate: 300_000,
      cacheWriteRate: 3_750_000,
    };

  const inputMicro = Math.round((inputTokens * rates.inRate) / 1_000_000);
  const outputMicro = Math.round((outputTokens * rates.outRate) / 1_000_000);
  const cacheReadMicro = Math.round((cacheReadTokens * rates.cacheReadRate) / 1_000_000);
  const cacheWriteMicro = Math.round((cacheWriteTokens * rates.cacheWriteRate) / 1_000_000);

  const totalMicroDollars = inputMicro + outputMicro + cacheReadMicro + cacheWriteMicro;
  const totalUsd = totalMicroDollars / 1_000_000;
  const totalMon = totalUsd / monPriceUsd;

  console.log("\nAgentGuard FinOps Rate Card Simulator (Dual-Denomination)");
  console.log("═".repeat(68));
  console.log(`Model Target:       ${model}`);
  console.log(`Input Tokens:       ${inputTokens.toLocaleString()}`);
  console.log(`Output Tokens:      ${outputTokens.toLocaleString()}`);
  console.log(`Cache Read Tokens:  ${cacheReadTokens.toLocaleString()}`);
  console.log(`Cache Write Tokens: ${cacheWriteTokens.toLocaleString()}`);
  console.log(`Total Tokens:       ${totalTokens.toLocaleString()}`);
  console.log("─".repeat(68));
  console.log(`Nominal USD Cost:   $${totalUsd.toFixed(6)} USD (${totalMicroDollars.toLocaleString()} µUSD)`);
  console.log(`MON Denominated:    ${totalMon.toFixed(8)} MON (@ $${monPriceUsd.toFixed(2)}/MON)`);
  console.log(`USDC Micro-Units:   ${totalMicroDollars.toLocaleString()} micro-USDC`);
  console.log("Settlement Tier:    Monad Parallel EVM (400ms finality, ~0.0004 MON gas)");
  console.log("═".repeat(68) + "\n");
}
