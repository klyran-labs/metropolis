import type { Page, Route } from "@playwright/test";

/**
 * Deterministic gateway responses for UI tests. They exist only under e2e/ and are served by
 * Playwright's network layer; the application contains no mock data paths.
 */
const ORG_ID = "11111111-1111-7111-8111-111111111111";
const WALLET_ID = "22222222-2222-7222-8222-222222222222";
const AGENT_A = "0x1111111111111111111111111111111111111111";
const AGENT_B = "0x2222222222222222222222222222222222222222";
const TREASURY = "0x3333333333333333333333333333333333333333";
const NOW = "2026-10-03T12:00:00.000Z";

export type PendingApprovalFixture = {
  transferId: string;
  direction: "load" | "unload";
  amountBaseUnits: string;
  agentAddress: string;
  initiatedBySubject: string;
  createdAt: string;
  expiresAt: string;
  walletId: string;
  walletLabel: string;
  walletAddress: string;
  signatures: number;
  requiredSignatures: number;
  alreadySigned: boolean;
  canApprove: boolean;
};

export type Scenario = {
  role: string;
  pending: PendingApprovalFixture[];
};

export const defaultScenario = (): Scenario => ({
  role: "super_admin",
  pending: [
    {
      transferId: "44444444-4444-7444-8444-444444444444",
      direction: "load",
      amountBaseUnits: "25000000",
      agentAddress: AGENT_A,
      initiatedBySubject: "did:privy:alice",
      createdAt: NOW,
      expiresAt: "2026-10-04T12:00:00.000Z",
      walletId: WALLET_ID,
      walletLabel: "Main treasury",
      walletAddress: TREASURY,
      signatures: 1,
      requiredSignatures: 2,
      alreadySigned: false,
      canApprove: true,
    },
    {
      transferId: "55555555-5555-7555-8555-555555555555",
      direction: "unload",
      amountBaseUnits: "5000000",
      agentAddress: AGENT_B,
      initiatedBySubject: "did:privy:bob",
      createdAt: NOW,
      expiresAt: "2026-10-04T12:00:00.000Z",
      walletId: WALLET_ID,
      walletLabel: "Main treasury",
      walletAddress: TREASURY,
      signatures: 1,
      requiredSignatures: 2,
      alreadySigned: true,
      canApprove: false,
    },
  ],
});

const agents = [
  { address: AGENT_A, adminAddress: TREASURY, environment: "production", riskTier: "tier2_standard", status: "active", createdAt: NOW, walletSource: "sovereign", label: "Research assistant" },
  { address: AGENT_B, adminAddress: TREASURY, environment: "production", riskTier: "tier1_critical", status: "paused", createdAt: NOW, walletSource: "external", label: "Invoice bot" },
];

const wallets = [
  { id: WALLET_ID, address: TREASURY, label: "Main treasury", kind: "sovereign", approvalThreshold: 2, status: "active", createdBySubject: "did:privy:alice", createdAt: NOW, accessCount: 2, hasAccess: true, balanceBaseUnits: "120000000" },
];

const telemetry = [
  { eventName: "payment_cleared", agentAddress: AGENT_A, blockNumber: 1042, transactionHash: "0xaaa1000000000000000000000000000000000000000000000000000000000001", payload: { reasonCode: 0, amount: "2500000" }, observedAt: NOW },
  { eventName: "policy_evaluated", agentAddress: AGENT_B, blockNumber: 1041, transactionHash: "0xaaa2000000000000000000000000000000000000000000000000000000000002", payload: { reasonCode: 1 }, observedAt: NOW },
  { eventName: "circuit_tripped", agentAddress: AGENT_B, blockNumber: 1040, transactionHash: "0xaaa3000000000000000000000000000000000000000000000000000000000003", payload: { reasonCode: 4 }, observedAt: NOW },
];

const plans = [
  { id: "p1", code: "growth", name: "Growth", description: "For growing teams", active: true, prices: [{ id: "pr1", chainId: 10143, tokenAddress: TREASURY, amountBaseUnits: "99000000", interval: "monthly", active: true }] },
];

const pricing = {
  pricing: { orgId: ORG_ID, modelType: "flat_discount", discountBps: 1000, volumeTiers: [], ptuCapacityTokens: 0, tokenCapTokens: 0, perCallFeeMicroDollars: 0, customRates: {}, toolCustomRates: {}, monthlyTokensConsumed: 1250000, updatedAt: NOW },
  catalog: [{ provider: "anthropic", modelId: "claude-sonnet", displayName: "Claude Sonnet", inputPerMMicroDollars: 3000000, outputPerMMicroDollars: 15000000, cacheReadPerMMicroDollars: 300000, cacheWritePerMMicroDollars: 3750000 }],
  toolCatalog: [{ toolId: "web-search", displayName: "Web search", provider: "example", category: "search", costPerCallMicroDollars: 10000 }],
};

/** Mirrors the gateway: newest-first pages, SQL-style totals over the whole list, opaque cursor. */
export const pendingResponse = (all: PendingApprovalFixture[], limit = 25, offset = 0) => {
  const approvals = all.slice(offset, offset + limit);
  const hasMore = offset + limit < all.length;
  return {
    count: approvals.length,
    total: all.length,
    approvableCount: all.filter((item) => item.canApprove).length,
    hasMore,
    nextCursor: hasMore ? String(offset + limit) : null,
    approvals,
  };
};

/** `count` distinct pending transfers the operator can sign. */
export const manyPending = (count: number): PendingApprovalFixture[] =>
  Array.from({ length: count }, (_, index) => ({
    ...defaultScenario().pending[0],
    transferId: `77777777-7777-7777-8777-${String(index).padStart(12, "0")}`,
    walletLabel: `Treasury ${index + 1}`,
  }));

export const approveResponse = (transferId: string) => ({
  transferId,
  status: "pending_approval",
  signatures: 2,
  requiredSignatures: 2,
});

export const transfersResponse = () => ({
  transfers: [
    {
      id: "66666666-6666-7666-8666-666666666666",
      direction: "load",
      amountBaseUnits: "10000000",
      status: "confirmed",
      transactionHash: "0xccc1000000000000000000000000000000000000000000000000000000000001",
      failureReason: null,
      initiatedBySubject: "did:privy:alice",
      createdAt: NOW,
      confirmedAt: NOW,
      walletLabel: "Main treasury",
      walletAddress: TREASURY,
    },
  ],
});

/**
 * One sample response per contract endpoint (`METHOD /path` as published in
 * docs/api/ui-contract.json). The route handler above serves these same samples, and the contract
 * test validates each against the gateway-generated schema.
 */
export const contractSamples = (scenario: Scenario = defaultScenario()): Record<string, unknown> => ({
  "GET /agents": agents,
  "GET /organization/wallets": { wallets },
  "GET /agents/{agent}/wallet-transfers": transfersResponse(),
  "GET /telemetry/events": telemetry,
  "GET /wallet-transfers/pending": pendingResponse(scenario.pending),
  "POST /wallet-transfers/{id}/approve": approveResponse(scenario.pending[0]?.transferId ?? "00000000-0000-7000-8000-000000000000"),
});

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

export async function installGateway(
  page: Page,
  scenario: Scenario = defaultScenario(),
  options: { streamUrl?: string } = {},
) {
  const approved = new Set<string>();

  // On-chain reads are not part of these tests; fail fast so screens show their empty states.
  await page.route("http://127.0.0.1:8545/**", (route) => route.abort());

  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace(/^\/api\/v1/, "");
    const method = route.request().method();

    if (path === "/telemetry/stream") {
      // Default: no push channel, so the UI falls back to polling. A test can point it at a real SSE server.
      return options.streamUrl ? route.continue({ url: options.streamUrl }) : route.abort();
    }
    if (/^\/users\/.+\/role$/.test(path)) return json(route, { role: scenario.role, org_id: ORG_ID, tenant_name: "Acme Robotics" });
    if (path === "/agents") return json(route, agents);
    if (path === "/organization/wallets") return json(route, { wallets });
    if (path === "/telemetry/events") return json(route, telemetry);
    if (path === "/subscription") return json(route, { subscription: null });
    if (path === "/plans" || path === "/platform/plans") return json(route, plans);
    if (path === "/tenant/operators") return json(route, [{ subject: "did:privy:e2e-operator", role: scenario.role, status: "active", mfaAuthenticated: true, updatedAt: NOW }]);
    if (path === "/api-keys") return json(route, []);
    if (path === "/policies/pbac") return json(route, []);
    if (path === "/policies/abac") return json(route, { allowedCidrs: [], requireMfa: false, maxAmount: null, maxGasPrice: null, tradingStartHourUtc: 0, tradingEndHourUtc: 24, allowedEnvironments: [], blockedRiskTiers: [] });
    if (path === "/tenant/pricing-model") return json(route, pricing);
    if (path === "/wallet-transfers/pending") {
      const remaining = scenario.pending.filter((item) => !approved.has(item.transferId));
      const limit = Number(url.searchParams.get("limit") ?? 25);
      const offset = Number(url.searchParams.get("cursor") ?? 0);
      return json(route, pendingResponse(remaining, limit, offset));
    }
    const approve = path.match(/^\/wallet-transfers\/([^/]+)\/approve$/);
    if (approve && method === "POST") {
      approved.add(approve[1]);
      return json(route, approveResponse(approve[1]));
    }
    if (/^\/agents\/[^/]+\/wallet-transfers$/.test(path)) return json(route, transfersResponse());
    if (path === "/platform/tenants") return json(route, [{ id: ORG_ID, displayName: "Acme Robotics", enterpriseAddress: TREASURY, status: "active", createdAt: NOW }]);
    if (path === "/platform/subscriptions") return json(route, [{ id: "s1", tenantId: ORG_ID, tenantName: "Acme Robotics", status: "active", currentPeriodStart: NOW, currentPeriodEnd: "2026-11-03T12:00:00.000Z", planCode: "growth", amountBaseUnits: "99000000", interval: "monthly", updatedAt: NOW }]);
    if (path === "/platform/billing/ledger") return json(route, [{ id: "l1", tenantId: ORG_ID, tenantName: "Acme Robotics", entryType: "charge", amountBaseUnits: "99000000", chainId: 10143, transactionHash: "0xbbb1000000000000000000000000000000000000000000000000000000000001", createdAt: NOW }]);
    if (path === "/platform/billing/revenue-summary") return json(route, { totalRevenueBaseUnits: "99000000", totalRefundsBaseUnits: "0", dailySeries: [{ day: NOW, entryType: "charge", amountBaseUnits: "99000000" }], revenueByPlan: [{ code: "growth", name: "Growth", amountBaseUnits: "99000000" }], subscriptionsByStatus: [{ status: "active", count: 1 }] });
    if (path === "/platform/billing/reconciliation") return json(route, { summary: { confirmedReconciled: 1, confirmedUnreconciled: 0, pending: 0, failed: 0 }, entries: [{ id: "r1", tenantName: "Acme Robotics", status: "confirmed", transactionHash: "0xbbb1", reasonCode: null, failureReason: null, amountBaseUnits: "99000000", createdAt: NOW, updatedAt: NOW, reconciled: true }] });
    if (path === "/platform/operators") return json(route, [{ subject: "did:privy:e2e-operator", role: "platform_super_admin", status: "active", createdAt: NOW, updatedAt: NOW }]);

    // Anything else the UI polls (edge topology, relayers, outbox...) returns an empty-but-valid payload.
    return json(route, method === "GET" ? [] : {});
  });
}
