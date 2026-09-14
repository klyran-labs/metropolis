import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { configuration, networkLabel } from "./configuration";
import { request, setAccessTokenProvider } from "./api";

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

export function useIdentity() {
  const privy = usePrivy();
  const subject = privy.user?.id;
  const role = useQuery({
    queryKey: ["role", subject],
    queryFn: () =>
      request<{ role: string; org_id: string }>(
        `/users/${encodeURIComponent(subject ?? "")}/role`,
      ),
    enabled: Boolean(privy.authenticated && subject),
    retry: false,
  });
  const platform = useQuery({
    queryKey: ["platform-access"],
    queryFn: () => request<unknown>("/platform/plans"),
    enabled: Boolean(privy.authenticated),
    retry: false,
  });
  return {
    ...privy,
    subject,
    role: role.data?.role ?? "",
    tenantId: role.data?.org_id ?? "",
    platformAccess: platform.isSuccess,
  };
}
