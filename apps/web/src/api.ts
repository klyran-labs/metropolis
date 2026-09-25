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
    if (error.message && error.message !== "The service could not complete the request." && error.message !== "Internal Server Error") {
      return error.message;
    }
    const reasonMessages: Record<string, string> = {
      ERR_UNAUTHENTICATED: "Your session has expired. Sign in again to continue.",
      ERR_ROLE_FORBIDDEN: "Your role does not permit this action.",
      ERR_TENANT_SCOPE: "This resource is outside your organization workspace.",
      ERR_POLICY_DENIED: "The policy engine denied this action.",
      ERR_RATE_LIMITED: "The workspace is busy. Retry when the current operations finish.",
      ERR_DEPENDENCY_UNAVAILABLE: "The Sovereign Key Vault service is temporarily unavailable.",
      ERR_TIMEOUT: "The request timed out before a response was received.",
    };
    if (error.reasonCode && reasonMessages[error.reasonCode]) {
      return reasonMessages[error.reasonCode];
    }
    return fallback;
  }

  const message = error instanceof Error ? error.message : "";
  if (/user rejected|user denied|rejected the request|user cancelled|user canceled|exited signature flow|modal closed/i.test(message)) {
    return "Wallet approval was cancelled.";
  }
  if (/wrong network|chain id|unsupported chain/i.test(message)) {
    return "Switch your wallet to the configured settlement network and try again.";
  }
  if (/insufficient funds|balance is too low/i.test(message)) {
    return "The connected wallet does not have enough funds for this action.";
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
    const body = await response.json().catch(() => ({}));
    throw new RequestError(
      typeof body.message === "string"
        ? body.message
        : "The service could not complete the request.",
      response.status,
      typeof body.reasonCode === "string" ? body.reasonCode : "",
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
