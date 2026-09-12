import { useState, useEffect, useCallback } from 'react';
import { formatMonAmount } from '../utils/financial';
import { usePrivy, useSignTypedData, useWallets } from '@privy-io/react-auth';
import { APP_CONFIG } from '../config/env';
import { MONAD_EXPLORER_URL } from '../config/contracts';

export const MONAD_CHAIN_ID_DECIMAL = APP_CONFIG.chainId;
export const MONAD_CHAIN_ID_HEX = '0x279f';

export interface Web3WalletState {
  address: `0x${string}` | null;
  balanceMon: string;
  isBrowserWallet: boolean;
  isSessionKey: boolean;
  chainId: number | null;
  isMonadNetwork: boolean;
  isConnecting: boolean;
  error: string | null;
}

export function useWeb3Wallet() {
  const { authenticated: privyAuthenticated } = usePrivy();
  const { wallets: privyWallets, ready: walletsReady } = useWallets();
  const { signTypedData } = useSignTypedData();
  const [walletState, setWalletState] = useState<Web3WalletState>({
    address: null,
    balanceMon: '0.0000',
    isBrowserWallet: false,
    isSessionKey: false,
    chainId: null,
    isMonadNetwork: false,
    isConnecting: false,
    error: null,
  });

  const embeddedWallet = privyWallets.find((wallet: any) => wallet.walletClientType === 'privy') || privyWallets[0];
  const embeddedChainId = typeof embeddedWallet?.chainId === 'string'
    ? Number(embeddedWallet.chainId.split(':').pop())
    : Number(embeddedWallet?.chainId || MONAD_CHAIN_ID_DECIMAL);

  useEffect(() => {
    if (!privyAuthenticated || !walletsReady || walletState.address || !embeddedWallet?.address) return;
    setWalletState((previous) => ({
      ...previous,
      address: embeddedWallet.address as `0x${string}`,
      isBrowserWallet: false,
      isSessionKey: true,
      chainId: Number.isFinite(embeddedChainId) ? embeddedChainId : MONAD_CHAIN_ID_DECIMAL,
      isMonadNetwork: embeddedChainId === MONAD_CHAIN_ID_DECIMAL,
      error: null,
    }));
  }, [embeddedWallet, privyAuthenticated, walletState.address, walletsReady]);

  const connectBrowserWallet = useCallback(async () => {
    setWalletState((prev) => ({ ...prev, isConnecting: true, error: null }));

    if (typeof window === 'undefined' || !(window as any).ethereum) {
      const error = 'A supported wallet is required. Connect MetaMask, Rabby, or your institutional wallet to continue.';
      setWalletState((prev) => ({ ...prev, isConnecting: false, error }));
      throw new Error(error);
    }

    const ethereum = (window as any).ethereum;

    try {
      const accounts = await ethereum.request({ method: 'eth_requestAccounts' });
      const address = (accounts[0] as `0x${string}`) || null;

      const chainIdHex = await ethereum.request({ method: 'eth_chainId' });
      const chainId = parseInt(chainIdHex, 16);

      let isMonad = chainId === MONAD_CHAIN_ID_DECIMAL;

      if (!isMonad) {
        try {
          await ethereum.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: MONAD_CHAIN_ID_HEX }],
          });
          isMonad = true;
        } catch (switchError: any) {
          // If network is not added yet, add Monad Devnet/Testnet
          if (switchError.code === 4902) {
            await ethereum.request({
              method: 'wallet_addEthereumChain',
              params: [
                {
                  chainId: MONAD_CHAIN_ID_HEX,
                  chainName: 'Monad Testnet',
                  nativeCurrency: { name: 'MONAD', symbol: 'MON', decimals: 18 },
                  rpcUrls: [APP_CONFIG.rpcUrl],
                  blockExplorerUrls: [MONAD_EXPLORER_URL],
                },
              ],
            });
            isMonad = true;
          }
        }
      }

      // Fetch live native balance
      let balanceMon = '0.0000';
      if (address) {
        try {
          const balanceHex = await ethereum.request({
            method: 'eth_getBalance',
            params: [address, 'latest'],
          });
          balanceMon = formatMonAmount(BigInt(balanceHex));
        } catch {
          balanceMon = '0.0000';
        }
      }

      setWalletState({
        address,
        balanceMon,
        isBrowserWallet: true,
        isSessionKey: false,
        chainId: isMonad ? MONAD_CHAIN_ID_DECIMAL : chainId,
        isMonadNetwork: isMonad,
        isConnecting: false,
        error: null,
      });
    } catch (err: any) {
      setWalletState((prev) => ({ ...prev, isConnecting: false, error: err?.message || 'Wallet connection failed.' }));
      throw err;
    }
  }, []);

  useEffect(() => {
    // Initial auto-detection: if wallet already connected or session key
    if (typeof window !== 'undefined' && (window as any).ethereum?.selectedAddress) {
      connectBrowserWallet();
    }
  }, [connectBrowserWallet]);

  /**
   * Signs EIP-712 typed order data using browser wallet or session key.
   */
  const signTypedOrder = useCallback(
    async (payload: any): Promise<`0x${string}`> => {
      if (walletState.isBrowserWallet && typeof window !== 'undefined' && (window as any).ethereum) {
        const ethereum = (window as any).ethereum;
        return await ethereum.request({
          method: 'eth_signTypedData_v4',
          params: [walletState.address, JSON.stringify(payload)],
        });
      } else if (privyAuthenticated && embeddedWallet?.address) {
        const result = await signTypedData({
          domain: payload.domain,
          types: payload.types,
          primaryType: payload.primaryType,
          message: payload.message,
        } as any, { address: embeddedWallet.address });
        return result.signature as `0x${string}`;
      } else {
        throw new Error('A connected Web3 wallet is required to authorize an order.');
      }
    },
    [embeddedWallet, privyAuthenticated, signTypedData, walletState.address, walletState.isBrowserWallet]
  );

  return {
    ...walletState,
    connectBrowserWallet,
    signTypedOrder,
  };
}
