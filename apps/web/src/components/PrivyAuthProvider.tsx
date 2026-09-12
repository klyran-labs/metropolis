import React from 'react';
import { PrivyProvider } from '@privy-io/react-auth';
import { APP_CONFIG } from '../config/env';
import { MONAD_EXPLORER_URL } from '../config/contracts';

export const monadTestnet = {
  id: 10143,
  name: 'Monad Testnet',
  network: 'monad-testnet',
  nativeCurrency: {
    name: 'Monad',
    symbol: 'MON',
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [APP_CONFIG.rpcUrl],
    },
    public: {
      http: [APP_CONFIG.rpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: 'Monad Explorer',
      url: MONAD_EXPLORER_URL,
    },
  },
};

export const PrivyAuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <PrivyProvider
      appId={APP_CONFIG.privyAppId}
      config={{
        appearance: {
          theme: 'dark',
          accentColor: '#06b6d4',
        },
        defaultChain: monadTestnet as any,
        supportedChains: [monadTestnet as any],
        embeddedWallets: {
          ethereum: {
            createOnLogin: 'users-without-wallets',
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
};

export default PrivyAuthProvider;
