import { useWallets } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  parseAbi,
  parseEther,
  parseUnits,
  type Address,
} from "viem";
import { configuration } from "../configuration";

export const POLICY_ENGINE_ABI = parseAbi([
  "struct SpendRequest { address agent; address merchant; uint256 amount; bytes32 category; uint256 timestamp; uint256 deadline; uint256 nonce; }",
  "struct PolicyDecision { bool allowed; uint256 allowedAmount; uint8 reasonCode; uint256 evaluatedAtTimestamp; }",
  "struct SpendPolicy { uint128 maxPerTx; uint128 maxPerWindow; uint32 windowSeconds; uint32 maxVelocity; bool killSwitch; bool whitelistEnabled; }",
  "function evaluate(SpendRequest calldata req) external view returns (PolicyDecision memory)",
  "function getAgentPolicy(address agent) external view returns (SpendPolicy memory)",
  "function getAgentState(address agent) external view returns (uint128 spentInWindow, uint32 windowStart, uint32 txCountInWindow, uint64 nonce)",
  "function setKillSwitch(address agent, bool active) external",
  "function tripCircuitBreaker(address agent) external",
  "function resetCircuitBreaker(address agent) external",
  "function isCircuitBroken(address agent) external view returns (bool)",
  "function circuitBroken(address agent) external view returns (bool)",
  "function agentAdmin(address agent) external view returns (address)",
  "function setAgentAdmin(address agent, address admin) external",
  "function setMerchantWhitelist(address agent, address merchant, bool allowed) external",
  "function isMerchantWhitelisted(address agent, address merchant) external view returns (bool)",
  "function setPolicy(address agent, SpendPolicy calldata policy) external",
  "event CircuitBreakerTripped(address indexed agent, address indexed admin)",
  "event CircuitBreakerReset(address indexed agent, address indexed admin)",
]);

export const ERC20_ABI = parseAbi([
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function mint(address to, uint256 amount) external",
  "function owner() external view returns (address)",
]);

export const ONCHAIN_REASON_CODES: Record<
  number,
  { code: string; title: string; desc: string; remediation: string }
> = {
  0: {
    code: "ERR_NONE",
    title: "Spend Approved",
    desc: "The transaction satisfies all configured spend invariants, budget caps, and cryptographic constraints.",
    remediation: "Proceed with settlement clearing.",
  },
  1: {
    code: "ERR_KILL_SWITCH",
    title: "Circuit Breaker Tripped (Kill-Switch Active)",
    desc: "Emergency halt active. The O(1) kill-switch bit is set to true for this agent address. Evaluation aborted without computing sliding window arithmetic.",
    remediation: "Reset the circuit breaker for this agent to resume spending authority.",
  },
  2: {
    code: "ERR_MAX_PER_TX",
    title: "Single Transaction Ceiling Exceeded",
    desc: "The requested spend amount exceeds the maxSpendPerTx slot configured in the agent's PackedPolicy.",
    remediation: "Lower the transaction value or increase the agent's maxPerTx ceiling in Policy Studio.",
  },
  3: {
    code: "ERR_MAX_PER_WINDOW",
    title: "Rolling Window Limit Exceeded",
    desc: "Cumulative window spend would exceed the agent's maxPerWindow ceiling.",
    remediation: "Wait for the current sliding epoch window to roll over or expand window capacity.",
  },
  4: {
    code: "ERR_VELOCITY_EXCEEDED",
    title: "Transaction Velocity Limit Reached",
    desc: "The agent has exceeded the maximum permitted number of transactions within the active sliding time window.",
    remediation: "Throttle autonomous dispatch frequency or increase maxVelocity.",
  },
  5: {
    code: "ERR_MERCHANT_NOT_ALLOWED",
    title: "Merchant Not Whitelisted",
    desc: "The recipient merchant contract address is not authorized in this agent's merchant whitelist mapping.",
    remediation: "Add the merchant address to the Approved Merchant Directory or disable whitelist enforcement.",
  },
  6: {
    code: "ERR_BUDGET_DEPLETED",
    title: "Shared Budget Pool Depleted",
    desc: "The organizational budget pool assigned to this agent has zero remaining unallocated balance.",
    remediation: "Top up the organizational budget pool or reassign the agent to a liquid pool.",
  },
  7: {
    code: "ERR_EXPIRED",
    title: "Request Deadline Expired",
    desc: "The transaction deadline timestamp has passed relative to the current block timestamp on Monad.",
    remediation: "Generate a refreshed spend intent with a valid forward-looking deadline timestamp.",
  },
  8: {
    code: "ERR_NONCE_REUSED",
    title: "Replay Protection Triggered (Nonce Reused)",
    desc: "The cryptographic nonce included in the spend request has already been recorded and executed.",
    remediation: "Increment the agent nonce to the next sequential unused value.",
  },
  9: {
    code: "ERR_SIGNATURE_INVALID",
    title: "EIP-712 Signature Verification Failed",
    desc: "Cryptographic signature validation failed against the recovered signer or domain separator.",
    remediation: "Verify that the agent keypair matches the registered agent address and EIP-712 domain.",
  },
};

export const monadLocalChain = {
  id: configuration.chainId,
  name: "Monad Local Devnet",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  rpcUrls: {
    default: {
      http: [configuration.rpcUrl || "http://127.0.0.1:8545"],
    },
  },
};

export function getPublicClient() {
  return createPublicClient({
    chain: monadLocalChain,
    transport: http(configuration.rpcUrl || "http://127.0.0.1:8545"),
  });
}

export type OnchainAgentState = {
  spentInWindow: bigint;
  windowStart: number;
  txCountInWindow: number;
  nonce: bigint;
};

export type OnchainPolicyDecision = {
  allowed: boolean;
  allowedAmount: bigint;
  reasonCode: number;
  evaluatedAtTimestamp: bigint;
  executionLatencyMs: number;
};

export async function evaluatePolicyOnchain(params: {
  agent: string;
  merchant: string;
  amountBaseUnits: bigint;
  category?: `0x${string}`;
  timestamp?: bigint;
  deadline?: bigint;
  nonce?: bigint;
}): Promise<OnchainPolicyDecision> {
  const policyEngineAddress = configuration.contracts.policyEngine;
  if (!policyEngineAddress || !isAddress(policyEngineAddress)) {
    throw new Error("PolicyEngine contract address is not configured.");
  }
  if (!isAddress(params.agent)) {
    throw new Error("Invalid agent address.");
  }
  if (!isAddress(params.merchant)) {
    throw new Error("Invalid merchant address.");
  }

  const client = getPublicClient();
  const category =
    params.category ||
    "0x696e666572656e63650000000000000000000000000000000000000000000000"; // "inference" padded
  const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
  const timestamp = params.timestamp ?? nowSeconds;
  const deadline = params.deadline ?? nowSeconds + 3600n;

  let nonce = params.nonce;
  if (nonce === undefined) {
    try {
      const state = await client.readContract({
        address: policyEngineAddress,
        abi: POLICY_ENGINE_ABI,
        functionName: "getAgentState",
        args: [params.agent as Address],
      });
      nonce = BigInt(state[3]);
    } catch {
      nonce = 0n;
    }
  }

  const startTime = performance.now();
  const decision = await client.readContract({
    address: policyEngineAddress,
    abi: POLICY_ENGINE_ABI,
    functionName: "evaluate",
    args: [
      {
        agent: params.agent as Address,
        merchant: params.merchant as Address,
        amount: params.amountBaseUnits,
        category,
        timestamp,
        deadline,
        nonce,
      },
    ],
  });
  const latency = Math.round((performance.now() - startTime) * 100) / 100;

  return {
    allowed: decision.allowed,
    allowedAmount: decision.allowedAmount,
    reasonCode: Number(decision.reasonCode),
    evaluatedAtTimestamp: decision.evaluatedAtTimestamp,
    executionLatencyMs: latency,
  };
}

export function useAgentRuntimeState(agentAddress: string, enabled = true) {
  return useQuery({
    queryKey: ["agent-runtime-state", agentAddress],
    queryFn: async (): Promise<OnchainAgentState | null> => {
      const policyEngineAddress = configuration.contracts.policyEngine;
      if (
        !policyEngineAddress ||
        !isAddress(policyEngineAddress) ||
        !isAddress(agentAddress)
      ) {
        return null;
      }
      const client = getPublicClient();
      const res = await client.readContract({
        address: policyEngineAddress,
        abi: POLICY_ENGINE_ABI,
        functionName: "getAgentState",
        args: [agentAddress as Address],
      });
      return {
        spentInWindow: res[0],
        windowStart: Number(res[1]),
        txCountInWindow: Number(res[2]),
        nonce: BigInt(res[3]),
      };
    },
    enabled: enabled && Boolean(agentAddress) && isAddress(agentAddress),
    refetchInterval: 4000,
  });
}

export function useIsMerchantWhitelisted(
  agentAddress: string,
  merchantAddress: string,
  enabled = true,
) {
  return useQuery({
    queryKey: ["merchant-whitelisted", agentAddress, merchantAddress],
    queryFn: async (): Promise<boolean> => {
      const policyEngineAddress = configuration.contracts.policyEngine;
      if (
        !policyEngineAddress ||
        !isAddress(policyEngineAddress) ||
        !isAddress(agentAddress) ||
        !isAddress(merchantAddress)
      ) {
        return false;
      }
      const client = getPublicClient();
      return client.readContract({
        address: policyEngineAddress,
        abi: POLICY_ENGINE_ABI,
        functionName: "isMerchantWhitelisted",
        args: [agentAddress as Address, merchantAddress as Address],
      });
    },
    enabled:
      enabled &&
      Boolean(agentAddress) &&
      isAddress(agentAddress) &&
      Boolean(merchantAddress) &&
      isAddress(merchantAddress),
  });
}

async function waitForReceipt(
  provider: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> },
  transactionHash: string,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const receipt = (await provider.request({
      method: "eth_getTransactionReceipt",
      params: [transactionHash],
    })) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") {
        throw new Error("The transaction was rejected onchain by the network.");
      }
      return receipt;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 750));
  }
  throw new Error("Transaction did not reach finality in time.");
}

export function useTripKillSwitch(onSuccess?: () => void) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      agentAddress,
      active,
    }: {
      agentAddress: string;
      active: boolean;
    }) => {
      const policyEngineAddress = configuration.contracts.policyEngine;
      if (!policyEngineAddress || !isAddress(policyEngineAddress)) {
        throw new Error("PolicyEngine contract address is not configured.");
      }
      const wallet = wallets[0];
      if (!wallet) {
        throw new Error("Connect your administrator Web3 wallet to manage the circuit breaker.");
      }
      const provider = await wallet.getEthereumProvider();
      const callData = encodeFunctionData({
        abi: POLICY_ENGINE_ABI,
        functionName: "setKillSwitch",
        args: [agentAddress as Address, active],
      });

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: policyEngineAddress,
            data: callData,
          },
        ],
      })) as string;

      await waitForReceipt(provider, hash);
      return hash;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({
        queryKey: ["agent-policy", variables.agentAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: ["agent-runtime-state", variables.agentAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: ["circuit-broken", variables.agentAddress],
      });
      onSuccess?.();
    },
  });
}

export function useIsCircuitBroken(agentAddress: string, enabled = true) {
  return useQuery({
    queryKey: ["circuit-broken", agentAddress],
    queryFn: async (): Promise<boolean> => {
      const policyEngineAddress = configuration.contracts.policyEngine;
      if (
        !policyEngineAddress ||
        !isAddress(policyEngineAddress) ||
        !isAddress(agentAddress)
      ) {
        return false;
      }
      const client = getPublicClient();
      return await client.readContract({
        address: policyEngineAddress,
        abi: POLICY_ENGINE_ABI,
        functionName: "isCircuitBroken",
        args: [agentAddress as Address],
      });
    },
    enabled: enabled && Boolean(agentAddress) && isAddress(agentAddress),
    refetchInterval: 4000,
  });
}

export function useTripCircuitBreaker(onSuccess?: () => void) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ agentAddress }: { agentAddress: string }) => {
      const policyEngineAddress = configuration.contracts.policyEngine;
      if (!policyEngineAddress || !isAddress(policyEngineAddress)) {
        throw new Error("PolicyEngine contract address is not configured.");
      }
      const wallet = wallets[0];
      if (!wallet) {
        throw new Error("Connect your administrator Web3 wallet to manage the circuit breaker.");
      }
      const provider = await wallet.getEthereumProvider();
      const callData = encodeFunctionData({
        abi: POLICY_ENGINE_ABI,
        functionName: "tripCircuitBreaker",
        args: [agentAddress as Address],
      });

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: policyEngineAddress,
            data: callData,
          },
        ],
      })) as string;

      await waitForReceipt(provider, hash);
      return hash;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({
        queryKey: ["agent-policy", variables.agentAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: ["agent-runtime-state", variables.agentAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: ["circuit-broken", variables.agentAddress],
      });
      onSuccess?.();
    },
  });
}

export function useResetCircuitBreaker(onSuccess?: () => void) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ agentAddress }: { agentAddress: string }) => {
      const policyEngineAddress = configuration.contracts.policyEngine;
      if (!policyEngineAddress || !isAddress(policyEngineAddress)) {
        throw new Error("PolicyEngine contract address is not configured.");
      }
      const wallet = wallets[0];
      if (!wallet) {
        throw new Error("Connect your administrator Web3 wallet to manage the circuit breaker.");
      }
      const provider = await wallet.getEthereumProvider();
      const callData = encodeFunctionData({
        abi: POLICY_ENGINE_ABI,
        functionName: "resetCircuitBreaker",
        args: [agentAddress as Address],
      });

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: policyEngineAddress,
            data: callData,
          },
        ],
      })) as string;

      await waitForReceipt(provider, hash);
      return hash;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      void queryClient.invalidateQueries({
        queryKey: ["agent-policy", variables.agentAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: ["agent-runtime-state", variables.agentAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: ["circuit-broken", variables.agentAddress],
      });
      onSuccess?.();
    },
  });
}

export function useSetMerchantWhitelist(onSuccess?: () => void) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      agentAddress,
      merchantAddress,
      allowed,
    }: {
      agentAddress: string;
      merchantAddress: string;
      allowed: boolean;
    }) => {
      const policyEngineAddress = configuration.contracts.policyEngine;
      if (!policyEngineAddress || !isAddress(policyEngineAddress)) {
        throw new Error("PolicyEngine contract address is not configured.");
      }
      const wallet = wallets[0];
      if (!wallet) {
        throw new Error("Connect your administrator Web3 wallet to manage merchant authorization.");
      }
      const provider = await wallet.getEthereumProvider();
      const callData = encodeFunctionData({
        abi: POLICY_ENGINE_ABI,
        functionName: "setMerchantWhitelist",
        args: [agentAddress as Address, merchantAddress as Address, allowed],
      });

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: policyEngineAddress,
            data: callData,
          },
        ],
      })) as string;

      await waitForReceipt(provider, hash);
      return hash;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: [
          "merchant-whitelisted",
          variables.agentAddress,
          variables.merchantAddress,
        ],
      });
      onSuccess?.();
    },
  });
}

export function useDevnetFaucet(onSuccess?: () => void) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      targetAddress,
      monAmount = "10.0",
      usdcAmount = "500.0",
    }: {
      targetAddress: string;
      monAmount?: string;
      usdcAmount?: string;
    }) => {
      if (!isAddress(targetAddress)) {
        throw new Error("Target address is not a valid EVM address.");
      }
      const rpcUrl = configuration.rpcUrl || "http://127.0.0.1:8545";

      // Set native MON balance directly via Anvil RPC
      const monWei = `0x${parseEther(monAmount).toString(16)}`;
      await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "anvil_setBalance",
          params: [targetAddress, monWei],
        }),
      }).catch(() => null);

      // If settlement token is deployed, dynamically discover owner and mint USDC
      const usdcAddress = configuration.contracts.settlementToken;
      if (usdcAddress && isAddress(usdcAddress)) {
        try {
          const client = getPublicClient();
          const tokenOwner = (await client.readContract({
            address: usdcAddress as Address,
            abi: ERC20_ABI,
            functionName: "owner",
          })) as Address;

          if (tokenOwner) {
            await fetch(rpcUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 2,
                method: "anvil_impersonateAccount",
                params: [tokenOwner],
              }),
            }).catch(() => null);

            const mintUnits = parseUnits(usdcAmount, 6);
            const mintData = encodeFunctionData({
              abi: ERC20_ABI,
              functionName: "mint",
              args: [targetAddress as Address, mintUnits],
            });

            await fetch(rpcUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 3,
                method: "eth_sendTransaction",
                params: [
                  {
                    from: tokenOwner,
                    to: usdcAddress,
                    data: mintData,
                  },
                ],
              }),
            }).catch(() => null);

            await fetch(rpcUrl, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                jsonrpc: "2.0",
                id: 4,
                method: "anvil_stopImpersonatingAccount",
                params: [tokenOwner],
              }),
            }).catch(() => null);
          }
        } catch {
          // Token owner or impersonation call optional on non-local RPC
        }
      }

      return true;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organization-wallets"] });
      void queryClient.invalidateQueries({ queryKey: ["agents"] });
      onSuccess?.();
    },
  });
}

export function useLiveTokenBalance(accountAddress: string, enabled = true) {
  return useQuery({
    queryKey: ["live-token-balance", accountAddress],
    queryFn: async (): Promise<bigint | null> => {
      const tokenAddress = configuration.contracts.settlementToken;
      if (!tokenAddress || !isAddress(tokenAddress) || !isAddress(accountAddress)) {
        return null;
      }
      const client = getPublicClient();
      return client.readContract({
        address: tokenAddress as Address,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [accountAddress as Address],
      });
    },
    enabled: enabled && Boolean(accountAddress) && isAddress(accountAddress),
    refetchInterval: 5000,
  });
}

export function useLiveNativeBalance(accountAddress: string, enabled = true) {
  return useQuery({
    queryKey: ["live-native-balance", accountAddress],
    queryFn: async (): Promise<bigint | null> => {
      if (!accountAddress || !isAddress(accountAddress)) return null;
      const client = getPublicClient();
      return client.getBalance({ address: accountAddress as Address });
    },
    enabled: enabled && Boolean(accountAddress) && isAddress(accountAddress),
    refetchInterval: 5000,
  });
}

export const CIRCUIT_PAYMASTER_ABI = parseAbi([
  "function isSponsorshipEligible(address agent, uint256 maxCost) external view returns (bool eligible, uint8 reasonCode)",
  "function treasuryBalances(address treasury) external view returns (uint256)",
  "function agentToTreasury(address agent) external view returns (address)",
  "function depositGas(address treasury) external payable",
  "function withdrawGas(address treasury, uint256 amount) external",
  "function setAgentTreasury(address agent, address treasury) external",
  "event GasSponsored(address indexed agent, address indexed treasury, uint256 actualGasCost)",
]);

export const AGENT_PASSPORT_NFT_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function tokenURI(uint256 tokenId) external view returns (string)",
  "function agentToken(address agent) external view returns (uint256)",
  "function tokenAgent(uint256 tokenId) external view returns (address)",
  "function mintPassport(address to, address agentAddress, string calldata uri) external returns (uint256)",
  "event PassportMinted(uint256 indexed tokenId, address indexed recipient, address indexed agentAddress, string uri)",
]);

export const ERC6551_REGISTRY_ABI = parseAbi([
  "function account(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external view returns (address)",
  "function createAccount(address implementation, bytes32 salt, uint256 chainId, address tokenContract, uint256 tokenId) external returns (address)",
  "event ERC6551AccountCreated(address account, address indexed implementation, bytes32 salt, uint256 chainId, address indexed tokenContract, uint256 indexed tokenId)",
]);

export function usePaymasterEligibility(agentAddress?: string, maxCost = 10000000000000000n) {
  return useQuery({
    queryKey: ["paymaster-eligibility", agentAddress, maxCost.toString()],
    queryFn: async () => {
      const pmAddress = configuration.contracts.circuitPaymaster;
      if (!pmAddress || !agentAddress || !isAddress(agentAddress)) return null;
      const client = getPublicClient();
      try {
        const [eligible, reasonCode] = await client.readContract({
          address: pmAddress,
          abi: CIRCUIT_PAYMASTER_ABI,
          functionName: "isSponsorshipEligible",
          args: [agentAddress as Address, maxCost],
        });
        return { eligible, reasonCode };
      } catch {
        return null;
      }
    },
    enabled: Boolean(agentAddress) && isAddress(agentAddress || ""),
    refetchInterval: 5000,
  });
}

export function usePaymasterTreasuryBalance(treasuryAddress?: string) {
  return useQuery({
    queryKey: ["paymaster-treasury-balance", treasuryAddress],
    queryFn: async (): Promise<bigint> => {
      const pmAddress = configuration.contracts.circuitPaymaster;
      if (!pmAddress || !treasuryAddress || !isAddress(treasuryAddress)) return 0n;
      const client = getPublicClient();
      try {
        const bal = await client.readContract({
          address: pmAddress,
          abi: CIRCUIT_PAYMASTER_ABI,
          functionName: "treasuryBalances",
          args: [treasuryAddress as Address],
        });
        return BigInt(bal);
      } catch {
        return 0n;
      }
    },
    enabled: Boolean(treasuryAddress) && isAddress(treasuryAddress || ""),
    refetchInterval: 5000,
  });
}

export function useDepositPaymasterGas(onSuccess?: () => void) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      treasuryAddress,
      amountWei,
    }: {
      treasuryAddress: string;
      amountWei: bigint;
    }) => {
      const pmAddress = configuration.contracts.circuitPaymaster;
      if (!pmAddress || !isAddress(pmAddress)) {
        throw new Error("Paymaster contract address is not configured.");
      }
      const wallet = wallets[0];
      if (!wallet) {
        throw new Error("Connect your administrator Web3 wallet to deposit gas float.");
      }
      const provider = await wallet.getEthereumProvider();
      const callData = encodeFunctionData({
        abi: CIRCUIT_PAYMASTER_ABI,
        functionName: "depositGas",
        args: [treasuryAddress as Address],
      });

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: pmAddress,
            data: callData,
            value: `0x${amountWei.toString(16)}`,
          },
        ],
      })) as string;

      await waitForReceipt(provider, hash);
      return hash;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["paymaster-treasury-balance", variables.treasuryAddress],
      });
      onSuccess?.();
    },
  });
}

export function useAgentPassport(agentAddress?: string) {
  return useQuery({
    queryKey: ["agent-passport", agentAddress],
    queryFn: async () => {
      const nftAddress = configuration.contracts.agentPassportNFT;
      if (!nftAddress || !agentAddress || !isAddress(agentAddress)) return null;
      const client = getPublicClient();
      try {
        const tokenId = await client.readContract({
          address: nftAddress,
          abi: AGENT_PASSPORT_NFT_ABI,
          functionName: "agentToken",
          args: [agentAddress as Address],
        });
        if (tokenId === 0n) return null;
        const owner = await client.readContract({
          address: nftAddress,
          abi: AGENT_PASSPORT_NFT_ABI,
          functionName: "ownerOf",
          args: [tokenId],
        });
        return { tokenId, owner };
      } catch {
        return null;
      }
    },
    enabled: Boolean(agentAddress) && isAddress(agentAddress || ""),
    refetchInterval: 5000,
  });
}

export function useAgentTba(agentAddress?: string) {
  return useQuery({
    queryKey: ["agent-tba", agentAddress],
    queryFn: async () => {
      const registryAddress = configuration.contracts.agentIdentityRegistry;
      const implAddress = configuration.contracts.agentAccountImplementation;
      const nftAddress = configuration.contracts.agentPassportNFT;
      if (!registryAddress || !implAddress || !nftAddress || !agentAddress || !isAddress(agentAddress)) {
        return null;
      }
      const client = getPublicClient();
      try {
        const tokenId = await client.readContract({
          address: nftAddress,
          abi: AGENT_PASSPORT_NFT_ABI,
          functionName: "agentToken",
          args: [agentAddress as Address],
        });
        if (tokenId === 0n) return null;
        const tbaAddress = await client.readContract({
          address: registryAddress,
          abi: ERC6551_REGISTRY_ABI,
          functionName: "account",
          args: [
            implAddress,
            "0x0000000000000000000000000000000000000000000000000000000000000000",
            BigInt(configuration.chainId),
            nftAddress,
            tokenId,
          ],
        });
        return { tokenId, tbaAddress };
      } catch {
        return null;
      }
    },
    enabled: Boolean(agentAddress) && isAddress(agentAddress || ""),
    refetchInterval: 5000,
  });
}

export * from "./useCircuitVault";
