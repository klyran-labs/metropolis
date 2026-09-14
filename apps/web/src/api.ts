import { useQuery } from "@tanstack/react-query";
import type { QueryClient } from "@tanstack/react-query";
import { configuration } from "./configuration";

export type Agent = {
  address: string;
  adminAddress: string;
  environment: string;
  riskTier: string;
  status: string;
  createdAt: string;
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

let accessTokenProvider: (() => Promise<string | null>) | null = null;
export const setAccessTokenProvider = (
  provider: () => Promise<string | null>,
) => {
  accessTokenProvider = provider;
};

export async function request<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await accessTokenProvider?.();
  const response = await fetch(`${configuration.apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(
      typeof body.message === "string"
        ? body.message
        : "The service could not complete the request.",
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
    queryFn: () => request<Agent[]>("/agents"),
    enabled,
  });
export const usePlans = (enabled: boolean) =>
  useQuery({
    queryKey: ["plans"],
    queryFn: () => request<Plan[]>("/plans"),
    enabled,
  });
export const usePlatformPlans = (enabled: boolean) =>
  useQuery({
    queryKey: ["platform-plans"],
    queryFn: () => request<Plan[]>("/platform/plans"),
    enabled,
  });
export const usePlatformTenants = (enabled: boolean) =>
  useQuery({
    queryKey: ["platform-tenants"],
    queryFn: () => request<PlatformTenant[]>("/platform/tenants"),
    enabled,
  });
export const usePlatformLedger = (enabled: boolean) =>
  useQuery({
    queryKey: ["platform-ledger"],
    queryFn: () => request<PlatformLedgerEntry[]>("/platform/billing/ledger"),
    enabled,
  });
export const useTenantOperators = (enabled: boolean) =>
  useQuery({
    queryKey: ["tenant-operators"],
    queryFn: () => request<TenantOperator[]>("/tenant/operators"),
    enabled,
    retry: false,
  });
export const useSigningWallets = (enabled: boolean) =>
  useQuery({
    queryKey: ["signing-wallets"],
    queryFn: async () => {
      const response = await request<{ wallets: SigningWallet[] }>(
        "/signing/vault",
      );
      return response.wallets;
    },
    enabled,
  });
export const useSubscription = (enabled: boolean) =>
  useQuery({
    queryKey: ["subscription"],
    queryFn: () => request<Subscription>("/subscription"),
    enabled,
  });
export const useAgentPolicy = (agent: string, enabled: boolean) =>
  useQuery({
    queryKey: ["agent-policy", agent],
    queryFn: () =>
      request<Record<string, unknown>>(
        `/agents/${encodeURIComponent(agent)}/policy`,
      ),
    enabled: enabled && Boolean(agent),
  });
