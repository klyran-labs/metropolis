import { useWallets } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createPublicClient,
  encodeFunctionData,
  http,
  isAddress,
  parseAbi,
  type Address,
} from "viem";
import { configuration } from "../configuration";

export const CIRCUIT_VAULT_ABI = parseAbi([
  "struct EpochBucket { uint128 allocatedCap; uint128 cumulativeSettled; uint32 epochStart; uint32 epochDuration; bool isClosed; }",
  "struct UnilateralChallenge { uint256 challengeBlock; uint128 proposedSettlement; bool active; }",
  "struct WithdrawalRequest { uint128 amount; uint64 unlockTimestamp; bool active; }",
  "function deposit(address agent, uint256 amount) external returns (uint256)",
  "function requestWithdrawal(address agent, uint128 amount) external",
  "function finalizeWithdrawal(address agent, address recipient) external returns (uint128)",
  "function allocateEpochBucket(address agent, address provider, uint256 epoch, uint128 amount, uint32 duration) external",
  "function settleVoucherDelta(address agent, address provider, uint256 epoch, uint128 cumulativeSpent, bytes calldata signature) external returns (uint128)",
  "function terminalClose(address agent, address provider, uint256 epoch, uint128 cumulativeSpent, bytes calldata signature) external returns (uint128, uint128)",
  "function rolloverEpochBucket(address agent, address provider, uint256 oldEpoch, uint128 oldCumulativeSpent, bytes calldata oldSignature, uint256 newEpoch, uint128 newAmount, uint32 newDuration) external returns (uint128, uint128)",
  "function requestUnilateralClose(address agent, address provider, uint256 epoch, bytes32 sessionId, uint128 claimedSpent) external",
  "function submitMerchantVoucher(address provider, bytes32 sessionId, uint128 voucherAmount, bytes calldata signature) external",
  "function finalizeUnilateralClose(address agent, address provider, uint256 epoch, bytes32 sessionId) external returns (uint128, uint128)",
  "function getVaultBalance(address agent) external view returns (uint128)",
  "function getEpochBucket(address agent, address provider, uint256 epoch) external view returns (EpochBucket memory)",
  "function getAgentChallenge(address agent, bytes32 sessionId) external view returns (UnilateralChallenge memory)",
  "function getMerchantSettlement(address provider, bytes32 sessionId) external view returns (uint128)",
  "event Deposited(address indexed agent, address indexed depositor, uint256 amount)",
  "event EpochBucketAllocated(address indexed agent, address indexed provider, uint256 indexed epoch, uint128 cap, uint32 duration)",
  "event VoucherDeltaSettled(address indexed agent, address indexed provider, uint256 indexed epoch, uint128 delta, uint128 cumulativeSettled)",
  "event TerminalClosed(address indexed agent, address indexed provider, uint256 indexed epoch, uint128 finalDelta, uint128 refundedFloat)",
  "event EpochRolledOver(address indexed agent, address indexed provider, uint256 indexed oldEpoch, uint256 newEpoch, uint128 deltaSettled, uint128 newCap)",
  "event UnilateralChallengeInitiated(address indexed agent, bytes32 indexed sessionId, uint256 challengeBlock, uint128 proposedSettlement)",
  "event UnilateralCloseFinalized(address indexed agent, address indexed provider, bytes32 indexed sessionId, uint128 providerPayout, uint128 agentRefund)",
]);

function getPublicClient() {
  return createPublicClient({
    transport: http(configuration.rpcUrl || undefined),
  });
}

async function waitForReceipt(provider: any, hash: string) {
  let attempts = 0;
  while (attempts < 30) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    try {
      const receipt = await provider.request({
        method: "eth_getTransactionReceipt",
        params: [hash],
      });
      if (receipt) return receipt;
    } catch {
      // Continue polling
    }
    attempts++;
  }
}

export function useVaultBalance(agentAddress: string, enabled = true) {
  return useQuery({
    queryKey: ["vault-balance", agentAddress],
    queryFn: async (): Promise<bigint> => {
      const vaultAddress = configuration.contracts.circuitVault;
      if (!vaultAddress || !isAddress(vaultAddress) || !isAddress(agentAddress)) {
        return 0n;
      }
      const client = getPublicClient();
      const bal = await client.readContract({
        address: vaultAddress,
        abi: CIRCUIT_VAULT_ABI,
        functionName: "getVaultBalance",
        args: [agentAddress as Address],
      });
      return BigInt(bal);
    },
    enabled: enabled && Boolean(agentAddress) && isAddress(agentAddress),
    refetchInterval: 5000,
  });
}

export function useEpochAllocation(
  agentAddress: string,
  providerAddress: string,
  epoch: bigint,
  enabled = true
) {
  return useQuery({
    queryKey: ["epoch-allocation", agentAddress, providerAddress, epoch.toString()],
    queryFn: async () => {
      const vaultAddress = configuration.contracts.circuitVault;
      if (
        !vaultAddress ||
        !isAddress(vaultAddress) ||
        !isAddress(agentAddress) ||
        !isAddress(providerAddress)
      ) {
        return null;
      }
      const client = getPublicClient();
      const res = await client.readContract({
        address: vaultAddress,
        abi: CIRCUIT_VAULT_ABI,
        functionName: "getEpochBucket",
        args: [agentAddress as Address, providerAddress as Address, epoch],
      });
      return {
        allocatedCap: res.allocatedCap,
        cumulativeSettled: res.cumulativeSettled,
        epochStart: res.epochStart,
        epochDuration: res.epochDuration,
        isClosed: res.isClosed,
      };
    },
    enabled:
      enabled &&
      Boolean(agentAddress) &&
      isAddress(agentAddress) &&
      Boolean(providerAddress) &&
      isAddress(providerAddress),
    refetchInterval: 5000,
  });
}

export function useAgentChallenge(
  agentAddress: string,
  sessionId: `0x${string}`,
  enabled = true
) {
  return useQuery({
    queryKey: ["agent-challenge", agentAddress, sessionId],
    queryFn: async () => {
      const vaultAddress = configuration.contracts.circuitVault;
      if (!vaultAddress || !isAddress(vaultAddress) || !isAddress(agentAddress)) {
        return null;
      }
      const client = getPublicClient();
      const res = await client.readContract({
        address: vaultAddress,
        abi: CIRCUIT_VAULT_ABI,
        functionName: "getAgentChallenge",
        args: [agentAddress as Address, sessionId],
      });
      return {
        challengeBlock: res.challengeBlock,
        proposedSettlement: res.proposedSettlement,
        active: res.active,
      };
    },
    enabled: enabled && Boolean(agentAddress) && isAddress(agentAddress) && Boolean(sessionId),
    refetchInterval: 5000,
  });
}

export function useAllocateBucket(onSuccess?: () => void) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      agentAddress,
      providerAddress,
      epoch,
      amount,
      durationSeconds,
    }: {
      agentAddress: string;
      providerAddress: string;
      epoch: bigint;
      amount: bigint;
      durationSeconds: number;
    }) => {
      const vaultAddress = configuration.contracts.circuitVault;
      if (!vaultAddress || !isAddress(vaultAddress)) {
        throw new Error("CircuitVault contract address is not configured.");
      }
      const wallet = wallets[0];
      if (!wallet) {
        throw new Error("Connect your administrator Web3 wallet to allocate credit.");
      }
      const provider = await wallet.getEthereumProvider();
      const callData = encodeFunctionData({
        abi: CIRCUIT_VAULT_ABI,
        functionName: "allocateEpochBucket",
        args: [
          agentAddress as Address,
          providerAddress as Address,
          epoch,
          amount,
          durationSeconds,
        ],
      });

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: vaultAddress,
            data: callData,
          },
        ],
      })) as string;

      await waitForReceipt(provider, hash);
      return hash;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["vault-balance", variables.agentAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: [
          "epoch-allocation",
          variables.agentAddress,
          variables.providerAddress,
          variables.epoch.toString(),
        ],
      });
      onSuccess?.();
    },
  });
}

export function useTerminalClose(onSuccess?: () => void) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      agentAddress,
      providerAddress,
      epoch,
      cumulativeSpent,
      signature,
    }: {
      agentAddress: string;
      providerAddress: string;
      epoch: bigint;
      cumulativeSpent: bigint;
      signature: `0x${string}`;
    }) => {
      const vaultAddress = configuration.contracts.circuitVault;
      if (!vaultAddress || !isAddress(vaultAddress)) {
        throw new Error("CircuitVault contract address is not configured.");
      }
      const wallet = wallets[0];
      if (!wallet) {
        throw new Error("Connect your administrator Web3 wallet to close session.");
      }
      const provider = await wallet.getEthereumProvider();
      const callData = encodeFunctionData({
        abi: CIRCUIT_VAULT_ABI,
        functionName: "terminalClose",
        args: [
          agentAddress as Address,
          providerAddress as Address,
          epoch,
          cumulativeSpent,
          signature,
        ],
      });

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: vaultAddress,
            data: callData,
          },
        ],
      })) as string;

      await waitForReceipt(provider, hash);
      return hash;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["vault-balance", variables.agentAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: [
          "epoch-allocation",
          variables.agentAddress,
          variables.providerAddress,
          variables.epoch.toString(),
        ],
      });
      onSuccess?.();
    },
  });
}

export function useRolloverEpochBucket(onSuccess?: () => void) {
  const { wallets } = useWallets();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      agentAddress,
      providerAddress,
      oldEpoch,
      oldCumulativeSpent,
      oldSignature,
      newEpoch,
      newAmount,
      newDurationSeconds,
    }: {
      agentAddress: string;
      providerAddress: string;
      oldEpoch: bigint;
      oldCumulativeSpent: bigint;
      oldSignature: `0x${string}`;
      newEpoch: bigint;
      newAmount: bigint;
      newDurationSeconds: number;
    }) => {
      const vaultAddress = configuration.contracts.circuitVault;
      if (!vaultAddress || !isAddress(vaultAddress)) {
        throw new Error("CircuitVault contract address is not configured.");
      }
      const wallet = wallets[0];
      if (!wallet) {
        throw new Error("Connect your administrator Web3 wallet to rollover epoch.");
      }
      const provider = await wallet.getEthereumProvider();
      const callData = encodeFunctionData({
        abi: CIRCUIT_VAULT_ABI,
        functionName: "rolloverEpochBucket",
        args: [
          agentAddress as Address,
          providerAddress as Address,
          oldEpoch,
          oldCumulativeSpent,
          oldSignature,
          newEpoch,
          newAmount,
          newDurationSeconds,
        ],
      });

      const hash = (await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: wallet.address,
            to: vaultAddress,
            data: callData,
          },
        ],
      })) as string;

      await waitForReceipt(provider, hash);
      return hash;
    },
    onSuccess: (_, variables) => {
      void queryClient.invalidateQueries({
        queryKey: ["vault-balance", variables.agentAddress],
      });
      void queryClient.invalidateQueries({
        queryKey: [
          "epoch-allocation",
          variables.agentAddress,
          variables.providerAddress,
        ],
      });
      onSuccess?.();
    },
  });
}
