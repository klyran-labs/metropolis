import { type Address, isAddress } from 'viem';

export interface StoredAgentCredential {
  address: Address;
  name: string;
  role: string;
  privateKey?: `0x${string}`;
  createdAt: string;
}

const AGENTS_KEY_PREFIX = 'AGENTGUARD_USER_AGENTS_';
const VAULT_KEY_PREFIX = 'AGENTGUARD_CREDENTIALS_VAULT_';

/**
 * Retrieves the list of agent addresses provisioned by a specific user wallet.
 */
export function getUserProvisionedAgents(userAddress?: string | null): Address[] {
  if (!userAddress || typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return [];
  }
  try {
    const raw = localStorage.getItem(`${AGENTS_KEY_PREFIX}${userAddress.toLowerCase()}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((addr): addr is Address => typeof addr === 'string' && isAddress(addr));
  } catch {
    return [];
  }
}

/**
 * Adds an agent address to the user's provisioned agents list.
 */
export function addUserProvisionedAgent(userAddress: string, agentAddress: Address): void {
  if (!userAddress || !agentAddress || typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    const existing = getUserProvisionedAgents(userAddress);
    const key = agentAddress.toLowerCase() as Address;
    if (!existing.some((a) => a.toLowerCase() === key)) {
      const updated = [agentAddress, ...existing];
      localStorage.setItem(`${AGENTS_KEY_PREFIX}${userAddress.toLowerCase()}`, JSON.stringify(updated));
    }
  } catch {
    // quiet fallback
  }
}

/**
 * Saves generated agent credentials to the user's browser vault if opted-in.
 */
export function saveAgentCredentials(
  userAddress: string,
  credential: StoredAgentCredential
): void {
  if (!userAddress || !credential.address || typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return;
  }
  try {
    const storageKey = `${VAULT_KEY_PREFIX}${userAddress.toLowerCase()}`;
    const raw = localStorage.getItem(storageKey);
    const vault: Record<string, StoredAgentCredential> = raw ? JSON.parse(raw) : {};
    vault[credential.address.toLowerCase()] = credential;
    localStorage.setItem(storageKey, JSON.stringify(vault));
  } catch {
    // quiet fallback
  }
}

/**
 * Retrieves stored credentials for a specific agent from the browser vault.
 */
export function getAgentCredentials(
  userAddress?: string | null,
  agentAddress?: string | null
): StoredAgentCredential | null {
  if (!userAddress || !agentAddress || typeof window === 'undefined' || typeof localStorage === 'undefined') {
    return null;
  }
  try {
    const storageKey = `${VAULT_KEY_PREFIX}${userAddress.toLowerCase()}`;
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const vault: Record<string, StoredAgentCredential> = JSON.parse(raw);
    return vault[agentAddress.toLowerCase()] || null;
  } catch {
    return null;
  }
}
