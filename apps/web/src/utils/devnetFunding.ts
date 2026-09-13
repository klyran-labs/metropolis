import { type Address, parseEther } from 'viem';
import { APP_CONFIG } from '../config/env';

/**
 * Checks whether the active RPC URL points to a local Anvil devnet instance.
 */
export const isLocalDevnetRpc = (): boolean => {
  const rpc = APP_CONFIG.rpcUrl.toLowerCase();
  return rpc.includes('127.0.0.1') || rpc.includes('localhost') || rpc.includes(':8545');
};

/**
 * Funds an address on a local Anvil devnet node using anvil_setBalance.
 * Returns true if the RPC accepted the call, false otherwise (e.g. on public testnets).
 */
export async function fundDevnetAccount(address: Address, amountMon = '100'): Promise<boolean> {
  if (!isLocalDevnetRpc()) return false;
  try {
    const amountWei = parseEther(amountMon);
    const hexBalance = `0x${amountWei.toString(16)}`;
    const response = await fetch(APP_CONFIG.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'anvil_setBalance',
        params: [address, hexBalance],
        id: Date.now(),
      }),
    });
    const data = await response.json();
    return !data.error;
  } catch {
    return false;
  }
}
