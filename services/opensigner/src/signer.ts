import { privateKeyToAccount } from 'viem/accounts';
import {
  createWalletClient,
  createPublicClient,
  http,
  encodeFunctionData,
  parseAbi,
  verifyTypedData,
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
  'function agentAdmin(address agent) external view returns (address)',
]);

export interface ChainConnection {
  rpcUrl: string;
  chainId: number;
  policyEngineAddress: `0x${string}`;
  agentWalletGuardAddress: `0x${string}`;
  allowedTokenAddress: `0x${string}`;
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
    if (!this.connection) {
      throw new Error('OpenSigner is not configured with an authoritative chain contract set.');
    }
    const privKey = this.vault.getDecryptedPrivateKey(walletIdOrAddress);
    const account = privateKeyToAccount(privKey);

    // Verify wallet owns the requested agent address
    if (account.address.toLowerCase() !== params.request.agent.toLowerCase()) {
      throw new Error(
        `Agent address mismatch: wallet ${account.address} cannot sign for agent ${params.request.agent}`
      );
    }

    const chainId = params.chainId || this.connection.chainId;
    if (chainId !== this.connection.chainId) {
      throw new Error('Spend request chain does not match the configured signing chain.');
    }
    if (params.verifyingContract.toLowerCase() !== this.connection.agentWalletGuardAddress.toLowerCase()) {
      throw new Error('Spend request verifier is not the configured AgentWalletGuard.');
    }
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

  /**
   * Executes the only non-policy-gated transfer allowed by OpenSigner: a configured settlement
   * token transfer from a registered sovereign treasury to a registered AgentGuard agent.
   * The token, chain, and destination are verified against service configuration and PolicyEngine
   * before any transaction is constructed.
   */
  public async executeTreasuryLoad(
    walletIdOrAddress: string,
    params: { tokenAddress: `0x${string}`; to: `0x${string}`; amount: string | bigint; chainId?: number }
  ): Promise<{ transactionHash: `0x${string}`; from: `0x${string}` }> {
    const privKey = this.vault.getDecryptedPrivateKey(walletIdOrAddress);
    const account = privateKeyToAccount(privKey);
    const { publicClient, walletClient } = this.clients(params.chainId);
    if (!this.connection) {
      throw new Error('OpenSigner chain configuration is unavailable.');
    }
    if (params.chainId !== undefined && params.chainId !== this.connection.chainId) {
      throw new Error('Treasury load chain does not match the configured signing chain.');
    }
    if (params.tokenAddress.toLowerCase() !== this.connection.allowedTokenAddress.toLowerCase()) {
      throw new Error('Treasury load token is not the configured settlement token.');
    }
    if (BigInt(params.amount) <= 0n) {
      throw new Error('Treasury load amount must be positive.');
    }

    const registeredAdmin = await publicClient.readContract({
      address: this.connection.policyEngineAddress,
      abi: POLICY_ENGINE_ABI,
      functionName: 'agentAdmin',
      args: [params.to],
    });
    if (registeredAdmin === '0x0000000000000000000000000000000000000000') {
      throw new Error('Treasury load destination is not a registered AgentGuard agent.');
    }

    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [params.to, BigInt(params.amount)],
    });
    const transactionHash = await walletClient.sendTransaction({
      account,
      chain: null,
      to: this.connection.allowedTokenAddress,
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
    if (!this.connection) {
      throw new Error('OpenSigner chain configuration is unavailable.');
    }
    if (params.chainId !== undefined && params.chainId !== this.connection.chainId) {
      throw new Error('Gated payment chain does not match the configured signing chain.');
    }
    if (params.verifyingContract.toLowerCase() !== this.connection.agentWalletGuardAddress.toLowerCase()) {
      throw new Error('Gated payment verifier is not the configured AgentWalletGuard.');
    }
    if (params.tokenAddress.toLowerCase() !== this.connection.allowedTokenAddress.toLowerCase()) {
      throw new Error('Gated payment token is not the configured settlement token.');
    }
    if (params.request.agent.toLowerCase() !== account.address.toLowerCase()) {
      throw new Error(
        `Agent address mismatch: wallet ${account.address} cannot submit for agent ${params.request.agent}`,
      );
    }

    const chainId = params.chainId ?? this.connection.chainId;
    const formattedRequest = {
      agent: params.request.agent,
      merchant: params.request.merchant,
      amount: BigInt(params.request.amount),
      category:
        params.request.category ||
        ('0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`),
      timestamp: BigInt(params.request.timestamp),
      deadline: BigInt(params.request.deadline),
      nonce: BigInt(params.request.nonce),
    };
    const domain = {
      name: DEFAULT_EIP712_DOMAIN_NAME,
      version: DEFAULT_EIP712_DOMAIN_VERSION,
      chainId,
      verifyingContract: params.verifyingContract,
    };
    const signed = params.signature
      ? {
          signature: params.signature,
          request: formattedRequest,
        }
      : await this.signSpendRequest(walletIdOrAddress, {
          request: params.request,
          verifyingContract: params.verifyingContract,
          chainId,
        });
    if (params.signature) {
      const valid = await verifyTypedData({
        address: account.address,
        domain,
        types: SPEND_REQUEST_TYPES,
        primaryType: 'SpendRequest',
        message: formattedRequest,
        signature: params.signature,
      });
      if (!valid) {
        throw new Error('The supplied SpendRequest signature does not match the configured wallet.');
      }
    }

    let whitelistHash: `0x${string}` | undefined;
    if (params.whitelistMerchant) {
      if (
        params.whitelistMerchant.policyEngineAddress.toLowerCase() !==
        this.connection.policyEngineAddress.toLowerCase()
      ) {
        throw new Error('Whitelist target is not the configured PolicyEngine.');
      }
      const whitelistData = encodeFunctionData({
        abi: POLICY_ENGINE_ABI,
        functionName: 'setMerchantWhitelist',
        args: [params.request.agent, params.request.merchant, true],
      });
      whitelistHash = await walletClient.sendTransaction({
        account,
        chain: null,
        to: this.connection.policyEngineAddress,
        data: whitelistData,
      });
      const whitelistReceipt = await publicClient.waitForTransactionReceipt({ hash: whitelistHash });
      if (whitelistReceipt.status !== 'success') {
        throw new Error(`Merchant whitelist transaction reverted: ${whitelistHash}`);
      }
    }

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
