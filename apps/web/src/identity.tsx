import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { configuration, networkLabel } from "./configuration";
import { RequestError, request, setAccessTokenProvider } from "./api";

const chain = {
  id: configuration.chainId,
  name: networkLabel,
  network:
    configuration.profile === "local"
      ? "monad-local"
      : configuration.profile === "testnet"
        ? "monad-testnet"
        : "monad-mainnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: { http: [configuration.rpcUrl] },
    public: { http: [configuration.rpcUrl] },
  },
};

export function IdentityProvider({ children }: { children: React.ReactNode }) {
  return (
    <PrivyProvider
      appId={configuration.privyAppId}
      config={{
        appearance: { theme: "dark", accentColor: "#6750A4" },
        defaultChain: chain as never,
        supportedChains: [chain as never],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: false,
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}

export function IdentityBridge() {
  const { getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  useEffect(() => {
    setAccessTokenProvider(async () => getAccessToken());
  }, [getAccessToken]);
  return <>{wallets.length > 0 ? null : null}</>;
}

function useIdentityQuery() {
  const privy = usePrivy();
  const queryClient = useQueryClient();
  const subject = privy.user?.id;
  const previousSubject = useRef<string | undefined>(subject);
  const role = useQuery({
    queryKey: ["role", subject],
    queryFn: ({ signal }) =>
      request<{ role: string; org_id: string; tenant_name?: string }>(
        `/users/${encodeURIComponent(subject ?? "")}/role`,
        { signal },
      ),
    enabled: Boolean(privy.authenticated && subject),
    retry: false,
  });
  const platform = useQuery({
    queryKey: ["platform-access", subject],
    queryFn: ({ signal }) => request<unknown>("/platform/plans", { signal }),
    enabled: Boolean(privy.authenticated && subject),
    retry: false,
  });
  const needsOnboarding =
    Boolean(privy.authenticated) &&
    role.isError &&
    role.error instanceof RequestError &&
    role.error.status === 403 &&
    role.error.reasonCode === "ERR_TENANT_SCOPE";
  // A disabled query (subject not yet resolved by Privy) reports isLoading=false,
  // which is indistinguishable from "we know you have no tenant" unless callers
  // also check membershipResolved — otherwise routing guards can act on a false
  // negative before the role fetch has even started.
  const membershipResolved = role.isSuccess || role.isError;
  const membershipLoading = Boolean(privy.authenticated) && !membershipResolved;

  useEffect(() => {
    if (previousSubject.current && previousSubject.current !== subject) {
      void queryClient.removeQueries({ queryKey: ["role", previousSubject.current] });
      void queryClient.removeQueries({ queryKey: ["platform-access", previousSubject.current] });
      try {
        localStorage.removeItem(`agentguard_tenant_name:${previousSubject.current}`);
      } catch {
        // Ignore storage errors in restricted contexts
      }
    }
    previousSubject.current = subject;
  }, [queryClient, subject]);

  // Persist and resolve the human-readable tenant name only within the authenticated subject.
  const tenantStorageKey = subject ? `agentguard_tenant_name:${subject}` : null;
  const serverTenantName = role.data?.tenant_name?.trim();
  if (serverTenantName && tenantStorageKey) {
    try {
      localStorage.setItem(tenantStorageKey, serverTenantName);
    } catch {
      // Ignore storage errors in restricted contexts
    }
  }
  const cachedTenantName = typeof window !== "undefined" && tenantStorageKey
    ? localStorage.getItem(tenantStorageKey)
    : null;
  const tenantName = serverTenantName || cachedTenantName || "Workspace";

  return {
    ...privy,
    subject,
    role: role.data?.role ?? "",
    tenantId: role.data?.org_id ?? "",
    tenantName,
    platformAccess: platform.isSuccess,
    platformAccessLoading: platform.isLoading,
    membershipLoading,
    membershipError: role.error,
    membershipUnavailable: Boolean(privy.authenticated) && role.isError && !needsOnboarding,
    needsOnboarding,
    refreshIdentity: () => {
      void queryClient.invalidateQueries({ queryKey: ["role", subject] });
      void queryClient.invalidateQueries({ queryKey: ["platform-access", subject] });
    },
  };
}

export type Identity = ReturnType<typeof useIdentityQuery>;

const IdentityContext = createContext<Identity | null>(null);

// Every screen/layout needs identity, and layouts nest their own child
// screens (AppLayout -> Overview, OnboardingScreen -> TenantOnboarding,
// etc.). Each calling useIdentity()'s underlying useQuery independently
// mounted a second observer on the same query key while it was mid-retry,
// which sent the role query into a permanent pending/refetch cycle -
// hundreds of requests/second and a screen that never resolved. Computing
// identity exactly once here and reading it via context everywhere else
// guarantees a single observer per query key regardless of nesting depth.
export function IdentityStateProvider({ children }: { children: ReactNode }) {
  const value = useIdentityQuery();
  return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>;
}

export function useIdentity(): Identity {
  const context = useContext(IdentityContext);
  if (!context) {
    throw new Error("useIdentity must be used within IdentityStateProvider");
  }
  return context;
}
