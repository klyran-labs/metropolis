import { privateKeyToAccount } from 'viem/accounts';
import type { EncryptedVault } from './vault.js';

export const MONAD_TESTNET_CHAIN_ID = 10143;

export const DEFAULT_EIP712_DOMAIN_NAME = 'AgentGuard_PolicyEngine';
export const DEFAULT_EIP712_DOMAIN_VERSION = '1';

export const SPEND_REQUEST_TYPES = {
  SpendRequest: [
    { name: 'agent', type: 'address' },
    { name: 'merchant', type: 'address' },
    { name: 'amount', type: 'uint256' },
    { name: 'category', type: 'bytes32' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export interface SpendRequestPayload {
  agent: `0x${string}`;
  merchant: `0x${string}`;
  amount: string | bigint;
  category?: `0x${string}`;
  timestamp: string | number | bigint;
  deadline: string | number | bigint;
  nonce: string | number | bigint;
}

export interface SpendRequestSignResult {
  signature: `0x${string}`;
  signer: `0x${string}`;
  domain: {
    name: string;
    version: string;
    chainId: number;
    verifyingContract: `0x${string}`;
  };
  request: {
    agent: `0x${string}`;
    merchant: `0x${string}`;
    amount: string;
    category: `0x${string}`;
    timestamp: string;
    deadline: string;
    nonce: string;
  };
}

export class OpenSignerEngine {
  private vault: EncryptedVault;

  constructor(vault: EncryptedVault) {
    this.vault = vault;
  }

  public async signSpendRequest(
    walletIdOrAddress: string,
    params: {
      request: SpendRequestPayload;
      verifyingContract: `0x${string}`;
      chainId?: number;
    }
  ): Promise<SpendRequestSignResult> {
    const privKey = this.vault.getDecryptedPrivateKey(walletIdOrAddress);
    const account = privateKeyToAccount(privKey);

    // Verify wallet owns the requested agent address
    if (account.address.toLowerCase() !== params.request.agent.toLowerCase()) {
      throw new Error(
        `Agent address mismatch: wallet ${account.address} cannot sign for agent ${params.request.agent}`
      );
    }

    const chainId = params.chainId || MONAD_TESTNET_CHAIN_ID;
    const domain = {
      name: DEFAULT_EIP712_DOMAIN_NAME,
      version: DEFAULT_EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract: params.verifyingContract,
    };

    const formattedRequest = {
      agent: params.request.agent,
      merchant: params.request.merchant,
      amount: BigInt(params.request.amount),
      category: params.request.category || ('0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`),
      timestamp: BigInt(params.request.timestamp),
      deadline: BigInt(params.request.deadline),
      nonce: BigInt(params.request.nonce),
    };

    const signature = await account.signTypedData({
      domain,
      types: SPEND_REQUEST_TYPES,
      primaryType: 'SpendRequest',
      message: formattedRequest,
    });

    return {
      signature,
      signer: account.address,
      domain,
      request: {
        agent: formattedRequest.agent,
        merchant: formattedRequest.merchant,
        amount: formattedRequest.amount.toString(),
        category: formattedRequest.category,
        timestamp: formattedRequest.timestamp.toString(),
        deadline: formattedRequest.deadline.toString(),
        nonce: formattedRequest.nonce.toString(),
      },
    };
  }

  public async signGenericTypedData(
    walletIdOrAddress: string,
    params: {
      domain: any;
      types: any;
      primaryType: string;
      message: any;
    }
  ): Promise<{ signature: `0x${string}`; signer: `0x${string}` }> {
    const privKey = this.vault.getDecryptedPrivateKey(walletIdOrAddress);
    const account = privateKeyToAccount(privKey);

    const signature = await account.signTypedData({
      domain: params.domain,
      types: params.types,
      primaryType: params.primaryType,
      message: params.message,
    });

    return {
      signature,
      signer: account.address,
    };
  }
}
