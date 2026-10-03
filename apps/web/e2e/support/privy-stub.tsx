import type { ReactNode } from "react";

const user = { id: "did:privy:e2e-operator", email: { address: "operator@acme.example" } };

export function PrivyProvider({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export function usePrivy() {
  return {
    ready: true,
    authenticated: true,
    user,
    login: () => {},
    logout: async () => {},
    getAccessToken: async () => "e2e-access-token",
  };
}

export function useWallets() {
  return { wallets: [] as unknown[], ready: true };
}

export function useConnectWallet() {
  return { connectWallet: () => {} };
}

export function useLoginWithEmail() {
  return {
    sendCode: async () => {},
    loginWithCode: async () => {},
    state: { status: "initial" as const },
  };
}
