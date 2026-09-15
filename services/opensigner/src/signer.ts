import { privateKeyToAccount } from 'viem/accounts';
import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbi,
  type Chain,
} from 'viem';
import type { EncryptedVault } from './vault.js';

export const MONAD_TESTNET_CHAIN_ID = 10143;

const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

const AGENT_WALLET_GUARD_ABI = parseAbi([
  'function executeGatedPayment((address agent,address merchant,uint256 amount,bytes32 category,uint256 timestamp,uint256 deadline,uint256 nonce) req, bytes signature, address token, bytes extraCallData) returns (bool success)',
]);

const POLICY_ENGINE_ABI = parseAbi([
  'function setMerchantWhitelist(address agent, address merchant, bool allowed) external',
]);

export interface ChainConnection {
  rpcUrl: string;
  chainId: number;
}

function chainFor(chainId: number): Chain {
  return {
    id: chainId,
    name: `monad-${chainId}`,
    nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
    rpcUrls: { default: { http: [] } },
  };
}

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
  private connection?: ChainConnection;

  constructor(vault: EncryptedVault, connection?: ChainConnection) {
    this.vault = vault;
    this.connection = connection;
  }

  private clients(chainId?: number) {
    if (!this.connection) {
      throw new Error('OpenSigner is not configured with an RPC connection; transaction submission is unavailable.');
    }
    const chain = chainFor(chainId || this.connection.chainId);
    const transport = http(this.connection.rpcUrl);
    return {
      publicClient: createPublicClient({ chain, transport }),
      walletClient: createWalletClient({ chain, transport }),
    };
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

  /**
   * Plain ERC-20 transfer submitted and paid for by this wallet's own MON balance. Used for
   * Load into a sovereign wallet. Deliberately narrow: the only calldata this method will ever
   * construct is `transfer(to, amount)` on the caller-specified token.
   */
  public async executeTransfer(
    walletIdOrAddress: string,
    params: { tokenAddress: `0x${string}`; to: `0x${string}`; amount: string | bigint; chainId?: number }
  ): Promise<{ transactionHash: `0x${string}`; from: `0x${string}` }> {
    const privKey = this.vault.getDecryptedPrivateKey(walletIdOrAddress);
    const account = privateKeyToAccount(privKey);
    const { publicClient, walletClient } = this.clients(params.chainId);

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [params.to, BigInt(params.amount)],
    });
    const transactionHash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: params.tokenAddress,
      data,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== 'success') {
      throw new Error(`Transfer transaction reverted: ${transactionHash}`);
    }
    return { transactionHash, from: account.address };
  }

  /**
   * Signs and submits a policy-gated sweep: approve() then executeGatedPayment() on the
   * AgentWalletGuard, using this wallet's own MON for gas. Used for Unload. The spend is still
   * evaluated by PolicyEngine on execution — this method never bypasses it, it only removes the
   * need for a human to hold the agent's key in order to submit the resulting transaction.
   */
  public async executeGatedPayment(
    walletIdOrAddress: string,
    params: {
      request: SpendRequestPayload;
      signature?: `0x${string}`;
      verifyingContract: `0x${string}`;
      tokenAddress: `0x${string}`;
      chainId?: number;
      /** If set, submits setMerchantWhitelist(agent, merchant, true) on PolicyEngine first —
       * the agent whitelisting its own sweep destination, same as any other policy change it's
       * entitled to make for itself. Only ever called when the caller has confirmed onchain
       * that the merchant isn't already whitelisted. */
      whitelistMerchant?: { policyEngineAddress: `0x${string}` };
    }
  ): Promise<{ whitelistHash?: `0x${string}`; approvalHash: `0x${string}`; transactionHash: `0x${string}` }> {
    const privKey = this.vault.getDecryptedPrivateKey(walletIdOrAddress);
    const account = privateKeyToAccount(privKey);
    const { publicClient, walletClient } = this.clients(params.chainId);

    let whitelistHash: `0x${string}` | undefined;
    if (params.whitelistMerchant) {
      const whitelistData = encodeFunctionData({
        abi: POLICY_ENGINE_ABI,
        functionName: 'setMerchantWhitelist',
        args: [params.request.agent, params.request.merchant, true],
      });
      whitelistHash = await walletClient.sendTransaction({
        account,
        chain: null,
        to: params.whitelistMerchant.policyEngineAddress,
        data: whitelistData,
      });
      const whitelistReceipt = await publicClient.waitForTransactionReceipt({ hash: whitelistHash });
      if (whitelistReceipt.status !== 'success') {
        throw new Error(`Merchant whitelist transaction reverted: ${whitelistHash}`);
      }
    }

    const signed = params.signature
      ? {
          signature: params.signature,
          request: {
            agent: params.request.agent,
            merchant: params.request.merchant,
            amount: BigInt(params.request.amount).toString(),
            category:
              params.request.category ||
              ('0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`),
            timestamp: BigInt(params.request.timestamp).toString(),
            deadline: BigInt(params.request.deadline).toString(),
            nonce: BigInt(params.request.nonce).toString(),
          },
        }
      : await this.signSpendRequest(walletIdOrAddress, {
          request: params.request,
          verifyingContract: params.verifyingContract,
          chainId: params.chainId,
        });

    const approvalData = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [params.verifyingContract, BigInt(signed.request.amount)],
    });
    const approvalHash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: params.tokenAddress,
      data: approvalData,
    });
    const approvalReceipt = await publicClient.waitForTransactionReceipt({ hash: approvalHash });
    if (approvalReceipt.status !== 'success') {
      throw new Error(`Approval transaction reverted: ${approvalHash}`);
    }

    const executeData = encodeFunctionData({
      abi: AGENT_WALLET_GUARD_ABI,
      functionName: 'executeGatedPayment',
      args: [
        {
          agent: signed.request.agent,
          merchant: signed.request.merchant,
          amount: BigInt(signed.request.amount),
          category: signed.request.category,
          timestamp: BigInt(signed.request.timestamp),
          deadline: BigInt(signed.request.deadline),
          nonce: BigInt(signed.request.nonce),
        },
        signed.signature,
        params.tokenAddress,
        '0x',
      ],
    });
    const transactionHash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: params.verifyingContract,
      data: executeData,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash });
    if (receipt.status !== 'success') {
      throw new Error(`Gated payment transaction reverted: ${transactionHash}`);
    }

    return { whitelistHash, approvalHash, transactionHash };
  }
}
