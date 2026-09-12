import React, { createContext, useContext, useState, useEffect } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWeb3Wallet } from '../hooks/useWeb3Wallet';

export interface AgentGuardContextValue {
  isAuthenticated: boolean;
  userEmail: string | null;
  userAddress: `0x${string}` | null;
  logout: () => void;
}

const AgentGuardContext = createContext<AgentGuardContextValue | null>(null);

export const AgentGuardProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const wallet = useWeb3Wallet();
  const { authenticated: privyAuthenticated, user: privyUser, logout: privyLogout } = usePrivy();

  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);

  useEffect(() => {
    setIsAuthenticated(privyAuthenticated);
    setUserEmail(privyUser?.email?.address || (privyUser?.wallet?.address as string | undefined) || null);
  }, [privyAuthenticated, privyUser]);

  const value: AgentGuardContextValue = {
    isAuthenticated,
    userEmail,
    userAddress: wallet.address,
    logout: privyLogout,
  };

  return <AgentGuardContext.Provider value={value}>{children}</AgentGuardContext.Provider>;
};

export const useAgentGuard = () => {
  const ctx = useContext(AgentGuardContext);
  if (!ctx) {
    throw new Error('useAgentGuard must be used within an AgentGuardProvider');
  }
  return ctx;
};
