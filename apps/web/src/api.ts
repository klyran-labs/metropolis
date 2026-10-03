import { useMutation, useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { configuration } from "./configuration";

export type Agent = {
  address: string;
  adminAddress: string;
  environment: string;
  riskTier: string;
  status: string;
  createdAt: string;
  walletSource?: "external" | "sovereign";
  label?: string;
};

export type OrganizationWallet = {
  id: string;
  address: string;
  label: string;
  kind: "external" | "sovereign";
  approvalThreshold: number;
  status: string;
  createdBySubject: string;
  createdAt: string;
  accessCount: number;
  hasAccess: boolean;
  balanceBaseUnits: string | null;
};

export type WalletAccessGrant = {
  subject: string;
  grantedBySubject: string;
  grantedAt: string;
};

export type WalletTransfer = {
  id: string;
  direction: "load" | "unload";
  amountBaseUnits: string;
  status: "pending" | "pending_approval" | "confirmed" | "failed";
  transactionHash: string | null;
  failureReason: string | null;
  initiatedBySubject: string;
  createdAt: string;
  confirmedAt: string | null;
  walletLabel: string;
  walletAddress: string;
};

export type WalletTransferResult = {
  transferId: string;
  status: "confirmed" | "pending_approval" | "awaiting_signature" | "pending";
  transactionHash?: string;
  ticketId?: string;
  requiredSignatures?: number;
  signatures?: number;
  intent?: { to: string; tokenAddress: string; amountBaseUnits: string; from: string };
};

export type TelemetryEvent = {
  eventName: string;
  agentAddress: string | null;
  blockNumber: number;
  transactionHash: string;
  payload: Record<string, unknown>;
  observedAt: string;
};

export type Plan = {
  id: string;
  code: string;
  name: string;
  description: string;
  active: boolean;
  prices: Array<{
    id: string;
    chainId: number;
    tokenAddress: string;
    amountBaseUnits: string;
    interval: string;
    active: boolean;
  }>;
};

export type Subscription = { subscription: null | Record<string, unknown> };
export type Checkout = {
  subscriptionId: string;
  paymentId: string;
  settlement: {
    chainId: number;
    tokenAddress: string;
    merchantAddress: string;
    request: Record<string, string>;
  };
};

export type PolicyUpdate = {
  maxPerTx: string;
  maxPerWindow: string;
  windowSeconds: number;
  maxVelocity: number;
  killSwitch: boolean;
  whitelistEnabled: boolean;
};

export type SwarmNodeRole = "supervisor" | "worker" | "specialist";
export type SwarmNodeStatus = "active" | "quarantined";

export type SwarmNode = {
  agentAddress: string;
  label: string;
  parentAddress: string | null;
  role: SwarmNodeRole;
  subBudgetCapUsdc: string;
  allocatedSpendUsdc: string;
  isolatedStatus: SwarmNodeStatus;
  capabilities: string[];
  environment: string;
  riskTier: string;
};

export type SwarmDelegation = {
  supervisorAddress: string;
  workerAddress: string;
  subBudgetCapUsdc: string;
  role: SwarmNodeRole;
  updatedAt: string;
};

export type CanaryStage =
  | "staged"
  | "canary_10"
  | "canary_25"
  | "canary_50"
  | "promoted_100"
  | "rolled_back";

export type CanaryDeployment = {
  agentAddress: string;
  baselinePolicy: PolicyUpdate;
  stagedPolicy: PolicyUpdate;
  stage: CanaryStage;
  trafficPct: number;
  anomalyThresholdPct: number;
  observedBreachRatePct: number;
  updatedAt: string;
};

export type ThreatAnomalyType =
  | "velocity_spike"
  | "category_drift"
  | "cadence_jitter"
  | "sub_threshold_probing";

export type ThreatSeverity = "low" | "medium" | "critical";

export type ThreatAnomaly = {
  id: string;
  agentAddress: string;
  anomalyType: ThreatAnomalyType;
  severity: ThreatSeverity;
  zScore: number;
  historicalCategory: string;
  attemptedCategory: string;
  observedAt: string;
  details: string;
  remediationAction: "trip_killswitch" | "tighten_policy" | "whitelist_merchant";
};

export type PlatformTenant = {
  id: string;
  displayName: string;
  enterpriseAddress: string;
  status: string;
  createdAt: string;
};

export type PlatformLedgerEntry = {
  id: string;
  tenantId: string;
  tenantName: string;
  entryType: string;
  amountBaseUnits: string;
  chainId: number;
  transactionHash: string;
  createdAt: string;
};

export type TenantOperator = {
  subject: string;
  role: string;
  status: string;
  mfaAuthenticated: boolean;
  updatedAt: string;
};

export type SigningWallet = {
  walletId: string;
  address: string;
  label: string;
  createdAt?: string;
};

export type PlatformSubscription = {
  id: string;
  tenantId: string;
  tenantName: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  planCode: string;
  amountBaseUnits: string;
  interval: string;
  updatedAt: string;
};

export type PlatformOperator = {
  subject: string;
  role: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type RevenueSummary = {
  totalRevenueBaseUnits: string;
  totalRefundsBaseUnits: string;
  dailySeries: Array<{ day: string; entryType: string; amountBaseUnits: string }>;
  revenueByPlan: Array<{ code: string; name: string; amountBaseUnits: string }>;
  subscriptionsByStatus: Array<{ status: string; count: number }>;
};

export type ReconciliationReport = {
  summary: {
    confirmedReconciled: number;
    confirmedUnreconciled: number;
    pending: number;
    failed: number;
  };
  entries: Array<{
    id: string;
    tenantName: string;
    status: string;
    transactionHash: string | null;
    reasonCode: number | null;
    failureReason: string | null;
    amountBaseUnits: string;
    createdAt: string;
    updatedAt: string;
    reconciled: boolean;
  }>;
};

export type PricingModelType =
  | "flat_discount"
  | "tiered_volume"
  | "committed_ptu"
  | "batch_discount"
  | "per_unit_request"
  | "hybrid_commit_volume";

export type VolumeTier = {
  minTokens: number;
  discountBps: number;
};

export type ModelRateOverride = {
  inputPerMMicroDollars: number;
  outputPerMMicroDollars: number;
  cacheReadPerMMicroDollars?: number;
  cacheWritePerMMicroDollars?: number;
};

export type ToolRateOverride = {
  costPerCallMicroDollars: number;
};

export type ToolCatalogEntry = {
  toolId: string;
  displayName: string;
  provider: string;
  category: string;
  costPerCallMicroDollars: number;
};

export type TenantPricingModel = {
  orgId: string;
  modelType: PricingModelType;
  discountBps: number;
  volumeTiers: VolumeTier[];
  ptuCapacityTokens: number;
  tokenCapTokens?: number;
  perCallFeeMicroDollars?: number;
  customRates: Record<string, ModelRateOverride>;
  toolCustomRates?: Record<string, ToolRateOverride>;
  monthlyTokensConsumed: number;
  updatedAt: string;
};

export type ModelCatalogEntry = {
  provider: string;
  modelId: string;
  displayName: string;
  inputPerMMicroDollars: number;
  outputPerMMicroDollars: number;
  cacheReadPerMMicroDollars: number;
  cacheWritePerMMicroDollars: number;
};

export type TenantPricingModelResponse = {
  pricing: TenantPricingModel;
  catalog: ModelCatalogEntry[];
  toolCatalog?: ToolCatalogEntry[];
};

export type UpdatePricingModelRequest = {
  modelType: PricingModelType;
  discountBps: number;
  volumeTiers: VolumeTier[];
  ptuCapacityTokens: number;
  tokenCapTokens?: number;
  perCallFeeMicroDollars?: number;
  customRates: Record<string, ModelRateOverride>;
  toolCustomRates?: Record<string, ToolRateOverride>;
};

export type CalculateToolCallRequest = {
  toolId: string;
  count: number;
};

export type FinOpsSpendResult = {
  modelName: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  nominalListCostMicroDollars: number;
  effectiveCostMicroDollars: number;
  effectiveDiscountBps: number;
  contractModel: PricingModelType;
  ptuCapacityApplied: number;
  ptuOverageTokens: number;
  toolCostMicroDollars?: number;
};

export type CalculateSpendRequest = {
  modelName: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  isBatch?: boolean;
  toolCalls?: CalculateToolCallRequest[];
};

export type CompilePolicyRequest = {
  prompt: string;
  agentAddress?: string;
};

export type CompiledPolicyResult = {
  maxPerTx: string;
  maxPerWindow: string;
  windowSeconds: number;
  maxVelocity: number;
  whitelistEnabled: boolean;
  riskTier: string;
  explanation: string;
  suggestedMerchants: string[];
};

let accessTokenProvider: (() => Promise<string | null>) | null = null;

export class RequestError extends Error {
  readonly status: number;
  readonly reasonCode: string;

  constructor(message: string, status: number, reasonCode = "") {
    super(message);
    this.name = "RequestError";
    this.status = status;
    this.reasonCode = reasonCode;
  }
}

export function toUserFacingError(error: unknown, fallback: string): string {
  if (error instanceof RequestError) {
    const reasonMessages: Record<string, string> = {
      ERR_UNAUTHENTICATED: "Your session has expired. Sign in again to continue.",
      ERR_ROLE_FORBIDDEN: "Your role does not permit this action.",
      ERR_TENANT_SCOPE: "This agent belongs to a different organization or tenant workspace.",
      ERR_POLICY_DENIED: "The policy engine denied this action.",
      ERR_RATE_LIMITED: "The workspace is busy. Retry when the current operations finish.",
      ERR_DEPENDENCY_UNAVAILABLE: "The key vault service is temporarily unavailable.",
      ERR_TIMEOUT: "The request timed out before a response was received.",
      ERR_NETWORK: "Could not connect to the AgentGuard gateway service.",
    };
    if (error.reasonCode && reasonMessages[error.reasonCode]) {
      return reasonMessages[error.reasonCode];
    }
    if (
      error.message &&
      error.message !== "The service could not complete the request." &&
      error.message !== "Internal Server Error"
    ) {
      return error.message;
    }
    return fallback;
  }

  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "object" && error !== null && "message" in error
        ? String((error as { message: unknown }).message)
        : "";

  if (!rawMessage) return fallback;

  if (/user rejected|user denied|rejected the request|user cancelled|user canceled|exited signature flow|modal closed/i.test(rawMessage)) {
    return "Wallet approval was cancelled by user.";
  }
  if (/wrong network|chain id|unsupported chain/i.test(rawMessage)) {
    return "Switch your wallet to the correct network and try again.";
  }
  if (/insufficient funds|balance is too low|exceeds balance/i.test(rawMessage)) {
    return "The connected wallet does not have enough funds to cover network fees.";
  }
  if (/nonce too low|replacement transaction underpriced/i.test(rawMessage)) {
    return "A pending transaction is blocking this operation. Please retry in a moment.";
  }
  if (/0x82b42900|only agent admin|unauthorized|not the owner/i.test(rawMessage)) {
    return "Your connected wallet is not the administrator of this agent.";
  }
  if (/execution reverted/i.test(rawMessage)) {
    const match = rawMessage.match(/execution reverted:?\s*([^"'{}\n\r]+)/i);
    if (match && match[1]?.trim()) {
      return `The action was declined: ${match[1].trim()}`;
    }
    return "The action was declined by your spending rules.";
  }

  // Clean common RPC prefixes
  const clean = rawMessage
    .replace(/^Error:\s*/i, "")
    .replace(/^MetaMask - RPC Error:\s*/i, "")
    .replace(/^Internal JSON-RPC error\.\s*/i, "")
    .trim();

  if (clean && clean.length > 3 && clean.length < 240 && !clean.includes(" at ") && !clean.includes(".ts:")) {
    return clean;
  }

  return fallback;
}

export const setAccessTokenProvider = (
  provider: () => Promise<string | null>,
) => {
  accessTokenProvider = provider;
};

const REQUEST_TIMEOUT_MS = 15_000;

function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new RequestError(message, 0, "ERR_TIMEOUT")),
      REQUEST_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await (accessTokenProvider?.() ?? Promise.resolve(null));
  const response = await fetch(`${configuration.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  }).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new RequestError("The request timed out.", 0, "ERR_TIMEOUT");
    }
    throw new RequestError("The service could not be reached.", 0, "ERR_NETWORK");
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    const reasonCode = (
      body.reason_code ??
      body.reasonCode ??
      response.headers.get("x-agentguard-reason-code") ??
      ""
    ).toString();
    const serverMessage = (body.message ?? body.remediation ?? body.error) as string | undefined;
    throw new RequestError(
      typeof serverMessage === "string" && serverMessage.trim()
        ? serverMessage.trim()
        : `Request failed with status ${response.status}`,
      response.status,
      reasonCode,
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const invalidateTenantData = (queryClient: QueryClient) => {
  void queryClient.invalidateQueries({ queryKey: ["agents"] });
  void queryClient.invalidateQueries({ queryKey: ["subscription"] });
};

export const useAgents = (enabled: boolean) =>
  useQuery({
    queryKey: ["agents"],
    queryFn: ({ signal }) => request<Agent[]>("/agents", { signal }),
    enabled,
  });
export const usePlans = (enabled: boolean) =>
  useQuery({
    queryKey: ["plans"],
    queryFn: ({ signal }) => request<Plan[]>("/plans", { signal }),
    enabled,
  });
export const usePlatformPlans = (enabled: boolean) =>
  useQuery({
    queryKey: ["platform-plans"],
    queryFn: ({ signal }) => request<Plan[]>("/platform/plans", { signal }),
    enabled,
  });
export const usePlatformTenants = (enabled: boolean) =>
  useQuery({
    queryKey: ["platform-tenants"],
    queryFn: ({ signal }) => request<PlatformTenant[]>("/platform/tenants", { signal }),
    enabled,
  });
export const usePlatformLedger = (enabled: boolean) =>
  useQuery({
    queryKey: ["platform-ledger"],
    queryFn: ({ signal }) => request<PlatformLedgerEntry[]>("/platform/billing/ledger", { signal }),
    enabled,
  });
export const useTenantOperators = (enabled: boolean) =>
  useQuery({
    queryKey: ["tenant-operators"],
    queryFn: ({ signal }) => request<TenantOperator[]>("/tenant/operators", { signal }),
    enabled,
    retry: false,
  });
export const useSigningWallets = (enabled: boolean) =>
  useQuery({
    queryKey: ["signing-wallets"],
    queryFn: async ({ signal }) => {
      const response = await request<{ wallets: SigningWallet[] }>(
        "/signing/vault",
        { signal },
      );
      return response.wallets;
    },
    enabled,
  });
export const useSubscription = (enabled: boolean) =>
  useQuery({
    queryKey: ["subscription"],
    queryFn: ({ signal }) => request<Subscription>("/subscription", { signal }),
    enabled,
  });
export const useAgentPolicy = (agent: string, enabled: boolean) =>
  useQuery({
    queryKey: ["agent-policy", agent],
    queryFn: ({ signal }) =>
      request<Record<string, unknown>>(
        `/agents/${encodeURIComponent(agent)}/policy`,
        { signal },
      ),
    enabled: enabled && Boolean(agent),
  });

export const useTelemetryEvents = (enabled: boolean) =>
  useQuery({
    queryKey: ["telemetry-events"],
    queryFn: ({ signal }) => request<TelemetryEvent[]>("/telemetry/events", { signal }),
    enabled,
  });

export const usePlatformSubscriptions = (enabled: boolean) =>
  useQuery({
    queryKey: ["platform-subscriptions"],
    queryFn: ({ signal }) => request<PlatformSubscription[]>("/platform/subscriptions", { signal }),
    enabled,
  });
export const usePlatformOperators = (enabled: boolean) =>
  useQuery({
    queryKey: ["platform-operators"],
    queryFn: ({ signal }) => request<PlatformOperator[]>("/platform/operators", { signal }),
    enabled,
  });
export const useUpsertPlatformOperator = (onSuccess: () => void) =>
  useMutation({
    mutationFn: (payload: { subject: string; role: string }) =>
      request("/platform/operators", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess,
  });
export const useRevenueSummary = (enabled: boolean) =>
  useQuery({
    queryKey: ["platform-revenue-summary"],
    queryFn: ({ signal }) => request<RevenueSummary>("/platform/billing/revenue-summary", { signal }),
    enabled,
  });
export const useReconciliation = (enabled: boolean) =>
  useQuery({
    queryKey: ["platform-reconciliation"],
    queryFn: ({ signal }) => request<ReconciliationReport>("/platform/billing/reconciliation", { signal }),
    enabled,
  });

export const useOrganizationWallets = (enabled: boolean) =>
  useQuery({
    queryKey: ["organization-wallets"],
    queryFn: async ({ signal }) => {
      const response = await request<{ wallets: OrganizationWallet[] }>(
        "/organization/wallets",
        { signal },
      );
      return response.wallets;
    },
    enabled,
  });

export const useRegisterOrganizationWallet = (
  onSuccess: () => void,
  onError?: (error: unknown) => void,
) =>
  useMutation({
    mutationFn: (payload: {
      kind: "external" | "sovereign";
      label: string;
      address?: string;
      signature?: string;
    }) =>
      request("/organization/wallets", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess,
    onError,
  });

export const useWalletAccess = (walletId: string, enabled: boolean) =>
  useQuery({
    queryKey: ["wallet-access", walletId],
    queryFn: async ({ signal }) => {
      const response = await request<{ access: WalletAccessGrant[] }>(
        `/organization/wallets/${encodeURIComponent(walletId)}/access`,
        { signal },
      );
      return response.access;
    },
    enabled: enabled && Boolean(walletId),
  });

export const useGrantWalletAccess = (walletId: string, onSuccess: () => void) =>
  useMutation({
    mutationFn: (subject: string) =>
      request(`/organization/wallets/${encodeURIComponent(walletId)}/access`, {
        method: "POST",
        body: JSON.stringify({ subject }),
      }),
    onSuccess,
  });

export const useRevokeWalletAccess = (walletId: string, onSuccess: () => void) =>
  useMutation({
    mutationFn: (subject: string) =>
      request(
        `/organization/wallets/${encodeURIComponent(walletId)}/access/${encodeURIComponent(subject)}`,
        { method: "DELETE" },
      ),
    onSuccess,
  });

export const useUpdateWalletThreshold = (walletId: string, onSuccess: () => void) =>
  useMutation({
    mutationFn: (approvalThreshold: number) =>
      request(`/organization/wallets/${encodeURIComponent(walletId)}`, {
        method: "PATCH",
        body: JSON.stringify({ approvalThreshold }),
      }),
    onSuccess,
  });

export const useWalletTransfers = (agent: string, enabled: boolean) =>
  useQuery({
    queryKey: ["wallet-transfers", agent],
    queryFn: async ({ signal }) => {
      const response = await request<{ transfers: WalletTransfer[] }>(
        `/agents/${encodeURIComponent(agent)}/wallet-transfers`,
        { signal },
      );
      return response.transfers;
    },
    enabled: enabled && Boolean(agent),
  });

export const useLoadAgentWallet = (agent: string, onSuccess: (result: WalletTransferResult) => void) =>
  useMutation({
    mutationFn: (payload: { organizationWalletId: string; amountBaseUnits: string }) =>
      request<WalletTransferResult>(`/agents/${encodeURIComponent(agent)}/load`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess,
  });

export const useUnloadAgentWallet = (agent: string, onSuccess: (result: WalletTransferResult) => void) =>
  useMutation({
    mutationFn: (payload: { organizationWalletId: string; amountBaseUnits: string }) =>
      request<WalletTransferResult>(`/agents/${encodeURIComponent(agent)}/unload`, {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess,
  });

export const useSubmitWalletTransfer = (onSuccess: () => void) =>
  useMutation({
    mutationFn: (payload: { transferId: string; transactionHash: string }) =>
      request<WalletTransferResult>(
        `/wallet-transfers/${encodeURIComponent(payload.transferId)}/submit`,
        { method: "POST", body: JSON.stringify({ transactionHash: payload.transactionHash }) },
      ),
    onSuccess,
  });

export const useApproveWalletTransfer = (onSuccess: () => void) =>
  useMutation({
    mutationFn: (transferId: string) =>
      request<WalletTransferResult>(
        `/wallet-transfers/${encodeURIComponent(transferId)}/approve`,
        { method: "POST" },
      ),
    onSuccess,
  });

export type ApiKey = {
  id: string;
  keyPrefix: string;
  agentAddress: string;
  subject: string;
  capabilities: string[];
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};
export type IssuedApiKey = ApiKey & { secret: string };

export type PbacConditions = {
  maxAmount: string | null;
  requiredMultisigSignatures: number | null;
  eligibleApproverRoles: string[];
  requireMfa: boolean | null;
};
export type PbacPolicy = {
  id: string;
  orgId: string;
  version: number;
  effect: "allow" | "deny";
  principals: string[];
  actions: string[];
  resources: string[];
  conditions: PbacConditions;
};

export type AbacPolicy = {
  allowedCidrs: string[];
  requireMfa: boolean;
  maxAmount: string | null;
  maxGasPrice: string | null;
  tradingStartHourUtc: number;
  tradingEndHourUtc: number;
  allowedEnvironments: string[];
  blockedRiskTiers: string[];
};

export const useApiKeys = (enabled: boolean) =>
  useQuery({
    queryKey: ["api-keys"],
    queryFn: ({ signal }) => request<ApiKey[]>("/api-keys", { signal }),
    enabled,
  });

export const useCreateApiKey = (onSuccess: (key: IssuedApiKey) => void) =>
  useMutation({
    mutationFn: (payload: {
      agentAddress: string;
      subject: string;
      capabilities: string[];
      expiresAt: string;
    }) => request<IssuedApiKey>("/api-keys", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess,
  });

export const useRotateApiKey = (onSuccess: (key: IssuedApiKey) => void) =>
  useMutation({
    mutationFn: (payload: { id: string; expiresAt: string }) =>
      request<IssuedApiKey>(`/api-keys/${encodeURIComponent(payload.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ expiresAt: payload.expiresAt }),
      }),
    onSuccess,
  });

export const useRevokeApiKey = (onSuccess: () => void) =>
  useMutation({
    mutationFn: (id: string) => request(`/api-keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess,
  });

export const usePbacPolicies = (enabled: boolean) =>
  useQuery({
    queryKey: ["pbac-policies"],
    queryFn: ({ signal }) => request<PbacPolicy[]>("/policies/pbac", { signal }),
    enabled,
  });

export const useUpsertPbacPolicy = (onSuccess: () => void) =>
  useMutation({
    mutationFn: (payload: {
      id?: string;
      effect: "allow" | "deny";
      principals: string[];
      actions: string[];
      resources: string[];
      conditions: PbacConditions;
    }) =>
      request<PbacPolicy>("/policies/pbac", { method: "POST", body: JSON.stringify(payload) }),
    onSuccess,
  });

export const useDeactivatePbacPolicy = (onSuccess: () => void) =>
  useMutation({
    mutationFn: (id: string) =>
      request(`/policies/pbac/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSuccess,
  });

export const useAbacPolicy = (enabled: boolean) =>
  useQuery({
    queryKey: ["abac-policy"],
    queryFn: ({ signal }) => request<AbacPolicy>("/policies/abac", { signal }),
    enabled,
  });

export const usePutAbacPolicy = (onSuccess: () => void) =>
  useMutation({
    mutationFn: (payload: AbacPolicy) =>
      request<AbacPolicy>("/policies/abac", { method: "PUT", body: JSON.stringify(payload) }),
    onSuccess,
  });

export const useTenantPricingModel = (enabled: boolean) =>
  useQuery({
    queryKey: ["tenant-pricing-model"],
    queryFn: ({ signal }) => request<TenantPricingModelResponse>("/tenant/pricing-model", { signal }),
    enabled,
  });

export const useUpdateTenantPricingModel = (onSuccess: () => void) =>
  useMutation({
    mutationFn: (payload: UpdatePricingModelRequest) =>
      request<TenantPricingModel>("/tenant/pricing-model", {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess,
  });

export const useCalculateSpend = () =>
  useMutation({
    mutationFn: (payload: CalculateSpendRequest) =>
      request<FinOpsSpendResult>("/finops/calculate-spend", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  });

export const useCompilePolicy = () =>
  useMutation({
    mutationFn: (payload: CompilePolicyRequest) =>
      request<CompiledPolicyResult>("/copilot/compile-policy", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
  });

const SWARM_STORAGE_KEY = "agentguard_swarm_delegations_v1";
const CANARY_STORAGE_KEY = "agentguard_canary_deployments_v1";

export function getStoredSwarmDelegations(): Record<string, SwarmDelegation> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(SWARM_STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveStoredSwarmDelegation(delegation: SwarmDelegation): void {
  try {
    if (typeof window === "undefined") return;
    const current = getStoredSwarmDelegations();
    current[delegation.workerAddress.toLowerCase()] = delegation;
    window.localStorage.setItem(SWARM_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage failure
  }
}

export function removeStoredSwarmDelegation(workerAddress: string): void {
  try {
    if (typeof window === "undefined") return;
    const current = getStoredSwarmDelegations();
    delete current[workerAddress.toLowerCase()];
    window.localStorage.setItem(SWARM_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage failure
  }
}

export function getStoredCanaryDeployments(): Record<string, CanaryDeployment> {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(CANARY_STORAGE_KEY) : null;
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function saveStoredCanaryDeployment(deployment: CanaryDeployment): void {
  try {
    if (typeof window === "undefined") return;
    const current = getStoredCanaryDeployments();
    current[deployment.agentAddress.toLowerCase()] = deployment;
    window.localStorage.setItem(CANARY_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage failure
  }
}

export function clearStoredCanaryDeployment(agentAddress: string): void {
  try {
    if (typeof window === "undefined") return;
    const current = getStoredCanaryDeployments();
    delete current[agentAddress.toLowerCase()];
    window.localStorage.setItem(CANARY_STORAGE_KEY, JSON.stringify(current));
  } catch {
    // Ignore storage failure
  }
}

export type SettlementOutboxRecord = {
  id: string;
  task_id: string;
  agent_address: string;
  merchant_address: string;
  token_address: string;
  amount: string;
  nonce: string;
  status: "pending" | "dispatched" | "mined" | "failed" | "dead_letter";
  tx_hash: string | null;
  attempt_count: number;
  max_attempts: number;
  next_retry_at: string;
  last_error: string | null;
  trace_id: string | null;
  created_at: string;
  updated_at: string;
};

export type SettlementQueueStats = {
  pending: number;
  dispatched: number;
  mined: number;
  failed: number;
  dead_letter: number;
  total: number;
};

export type SettlementOutboxResponse = {
  stats: SettlementQueueStats;
  items: SettlementOutboxRecord[];
};

export function useSettlementOutbox(statusFilter?: string, enabled = true) {
  return useQuery({
    queryKey: ["settlement-outbox", statusFilter],
    queryFn: () => {
      const query = statusFilter && statusFilter !== "all" ? `?status=${encodeURIComponent(statusFilter)}` : "";
      return request<SettlementOutboxResponse>(`/v1/settlement/outbox${query}`);
    },
    enabled,
    refetchInterval: 3000,
  });
}

export function useRetrySettlementOutbox() {
  return useMutation({
    mutationFn: (id: string) =>
      request<{ status: string; id: string; message: string }>(`/v1/settlement/outbox/${id}/retry`, {
        method: "POST",
      }),
  });
}

export type MerkleProofData = {
  outbox_id: string;
  leaf: string;
  index: number;
  siblings: string[];
  root: string;
  total_leaves: number;
};

export type AuditProofResponse = {
  status: string;
  proof: MerkleProofData;
  anchor_registry: string;
};

export function useAuditProof(outboxId?: string, enabled = false) {
  return useQuery({
    queryKey: ["audit-proof", outboxId],
    queryFn: () => request<AuditProofResponse>(`/v1/audit/proof/${outboxId}`),
    enabled: Boolean(outboxId && enabled),
  });
}

export type RelayerShardInfo = {
  id: number;
  address: string;
  current_nonce: number;
  in_flight: number;
  escalation_count: number;
  last_escalation_at: string | null;
  status: "active" | "congested" | "rebalancing";
};

export type RelayerPoolStats = {
  total_shards: number;
  active_shards: number;
  total_in_flight: number;
  total_escalations: number;
  shards: RelayerShardInfo[];
};

export function useRelayerPoolStats(enabled = true) {
  return useQuery({
    queryKey: ["settlement-relayers"],
    queryFn: () => request<RelayerPoolStats>("/v1/settlement/relayers"),
    enabled,
    refetchInterval: 3000,
  });
}

export type MevRelayStats = {
  total_bundles_submitted: number;
  bundles_included: number;
  sandwich_attacks_deflected: number;
  total_kickbacks_wei: number;
  avg_builder_latency_ms: number;
  active_builder_connections: number;
};

export function useMevRelayStats(enabled = true) {
  return useQuery({
    queryKey: ["settlement-mev-stats"],
    queryFn: () => request<MevRelayStats>("/v1/settlement/mev-stats"),
    enabled,
    refetchInterval: 3000,
  });
}

export type DecodedCalldataField = {
  name: string;
  value: string;
  field_type: string;
};

export type CalldataInspectionResponse = {
  selector: string;
  function_name: string;
  fields: DecodedCalldataField[];
  risk_level: "nominal" | "elevated" | "critical";
  clear_signing_summary: string;
};

export async function inspectCalldata(params: {
  calldata: string;
  agent: string;
  target: string;
  msg_value?: string;
}): Promise<CalldataInspectionResponse> {
  return request<CalldataInspectionResponse>("/v1/calldata/inspect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
}

export type AgentLivenessStatus = {
  agent: string;
  last_heartbeat: number;
  status: "HEALTHY" | "WARNING_INACTIVE" | "SUCCESSION_PENDING" | "SUCCESSION_ACTIVE";
  seconds_since_last_heartbeat: number;
  grace_period_seconds: number;
  standby_key: string;
  fallback_treasury: string;
  succession_active: boolean;
};

export function useAgentLiveness(agent: string, enabled = true) {
  return useQuery({
    queryKey: ["agent-liveness", agent],
    queryFn: () => request<AgentLivenessStatus>(`/v1/agent/${agent}/heartbeat`),
    enabled: Boolean(agent && enabled),
    refetchInterval: 5000,
  });
}

export async function recordAgentHeartbeat(agent: string): Promise<AgentLivenessStatus> {
  return request<AgentLivenessStatus>("/v1/agent/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      agent,
      timestamp: Math.floor(Date.now() / 1000),
    }),
  });
}

export type EdgeRegionSummary = {
  region_name: string;
  latency_p99_ms: number;
  active_leases: number;
  allocated_budget_usd: number;
  consensus_health: string;
};

export type EdgeTopologyResponse = {
  global_active_edges: number;
  regions: EdgeRegionSummary[];
};

export function useEdgeTopology(enabled = true) {
  return useQuery({
    queryKey: ["edge-topology"],
    queryFn: () => request<EdgeTopologyResponse>("/v1/edge/topology"),
    enabled,
    refetchInterval: 4000,
  });
}






