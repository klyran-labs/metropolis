import { request } from "../../../api";

export async function waitForReceipt(
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> },
  transactionHash: string,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") {
        throw new Error("The settlement approval was rejected by the network.");
      }
      return;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 750));
  }
  throw new Error("The settlement approval did not reach finality in time.");
}

export const policyLabels: Record<string, string> = {
  maxPerTx: "Maximum per transaction",
  maxPerWindow: "Maximum per window",
  windowSeconds: "Window duration (seconds)",
  maxVelocity: "Velocity limit",
  killSwitch: "Paused",
  whitelistEnabled: "Approved merchants required",
};

export interface PolicyPreset {
  label: string;
  description: string;
  maxPerTx: string;
  maxPerWindow: string;
  windowSeconds: number;
  maxVelocity: number;
}

export const POLICY_PRESETS: PolicyPreset[] = [
  {
    label: "Micro Inference",
    description: "LLM completions & embeddings ($10/tx, $100/hr)",
    maxPerTx: "10",
    maxPerWindow: "100",
    windowSeconds: 3600,
    maxVelocity: 50,
  },
  {
    label: "Standard Autonomous",
    description: "Autonomous task execution ($50/tx, $500/hr)",
    maxPerTx: "50",
    maxPerWindow: "500",
    windowSeconds: 3600,
    maxVelocity: 20,
  },
  {
    label: "High-Volume Trader",
    description: "DeFi rebalancing & high-cadence bots ($250/tx, $2k/hr)",
    maxPerTx: "250",
    maxPerWindow: "2000",
    windowSeconds: 3600,
    maxVelocity: 100,
  },
  {
    label: "Low-Cost AI Agent",
    description: "Small, frequent AI calls ($0.10/tx, $1.50/hr, 10 tx/hr)",
    maxPerTx: "0.10",
    maxPerWindow: "1.50",
    windowSeconds: 3600,
    maxVelocity: 10,
  },
];

export function parseBaseUnits(amountStr: string | number, decimals = 6): bigint {
  const str = String(amountStr ?? "0").trim();
  if (!str) return 0n;
  const [whole = "0", fraction = ""] = str.split(".");
  const padded = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole || "0") * (10n ** BigInt(decimals)) + BigInt(padded);
}

export function baseUnitsToDollars(val: string | number | bigint | null | undefined, decimals = 6): string {
  if (val === null || val === undefined || val === "") return "0";
  const str = String(val).trim();
  if (str.includes(".")) return str;
  const num = Number(str);
  if (isNaN(num) || num === 0) return "0";
  const float = num / (10 ** decimals);
  return Number(float.toFixed(decimals)).toString();
}

export function formatUsdcAmount(amount: string | number): string {
  const float = typeof amount === "number" ? amount : parseFloat(amount || "0");
  if (isNaN(float) || float <= 0) return "$0.00 USDC";
  if (float < 0.01) {
    return `$${float.toFixed(6)} USDC`;
  }
  return `$${float.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`;
}

export function formatWindowEpoch(seconds: number): string {
  if (seconds === 900) return "15 minutes";
  if (seconds === 3600) return "1 hour";
  if (seconds === 21600) return "6 hours";
  if (seconds === 86400) return "24 hours";
  if (seconds === 604800) return "7 days";
  if (seconds < 60) return `${seconds}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0 && mins > 0) return `${hours}h ${mins}m`;
  if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""}`;
  return `${mins} minute${mins > 1 ? "s" : ""}`;
}

export interface DryRunVerdict {
  allowed: boolean;
  reasonCode: number;
  title: string;
  description: string;
  remediation: string;
}

export interface PolicyDiffRow {
  param: string;
  current: string;
  draftVal: string;
  deltaText: string;
  risk: "low" | "medium" | "high";
}
