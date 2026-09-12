/**
 * AgentGuard x402 / AP2 Payment Gateway — real implementation.
 *
 * Replaces the previous docker/Dockerfile.gateway runtime, which was a
 * one-line inline `http.createServer` that unconditionally returned 402 for
 * every route and never imported @agentguard/x402-middleware, verified a
 * signature, called PolicyEngine, or touched Monad at all (see
 * docs/GAP_ANALYSIS.md, finding 1.4 — "the gateway is not implemented, it's
 * a stub"). This file is the real thing: it issues x402 challenges, verifies
 * EIP-712 SpendRequest signatures, pre-flight simulates against
 * PolicyEngine.evaluate (a free view call — denies fail fast, before any gas
 * is spent), and, when a relayer key is configured, submits
 * AgentWalletGuard.executeGatedPayment to actually settle on Monad.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createPublicClient, createWalletClient, http as viemHttp } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import {
  createX402Challenge,
  parseX402Authorization,
  verifySpendRequestSignature,
  createPolicyRejectionResponse,
} from '@agentguard/x402-middleware';
import { ReasonCode } from '@agentguard/shared-types';
import { loadConfig, type GatewayConfig } from './config.js';
import { POLICY_ENGINE_ABI, AGENT_WALLET_GUARD_ABI } from './abi.js';

interface ProtectedRoute {
  amountWei: bigint;
  category: string;
  description: string;
}

// Example paywalled resource, mirroring the narrative in
// scripts/agentguard-live-demo.mjs's "/v1/deepseek-r1" — served for real here
// instead of simulated in a CLI script.
const PROTECTED_ROUTES: Record<string, ProtectedRoute> = {
  '/v1/inference': {
    amountWei: 100_000_000_000_000_000n, // 0.10 MON / USDC(6dp equivalent handled by token decimals upstream)
    category: 'AI_INFERENCE',
    description: 'AgentGuard-gated LLM inference endpoint',
  },
};

function sendJson(res: ServerResponse, statusCode: number, headers: Record<string, string>, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}

export function createGatewayServer(config: GatewayConfig) {
  const publicClient = createPublicClient({ transport: viemHttp(config.rpcUrl) });

  const relayerAccount = config.relayerPrivateKey ? privateKeyToAccount(config.relayerPrivateKey) : null;
  const walletClient = relayerAccount
    ? createWalletClient({ account: relayerAccount, transport: viemHttp(config.rpcUrl) })
    : null;

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? '/';

    if (url === '/health') {
      sendJson(res, 200, {}, { status: 'ok', chainId: config.chainId, relayerConfigured: Boolean(walletClient) });
      return;
    }

    const route = PROTECTED_ROUTES[url];
    if (!route) {
      sendJson(res, 404, {}, { error: 'Not Found', knownRoutes: Object.keys(PROTECTED_ROUTES) });
      return;
    }

    const authHeader = (req.headers['payment-signature'] as string | undefined) ?? undefined;
    const payload = parseX402Authorization(authHeader);

    if (!payload) {
      const challenge = createX402Challenge({
        payTo: config.merchantAddress,
        amountWei: route.amountWei.toString(),
        token: config.usdcTokenAddress,
        serviceId: url,
        category: route.category,
        description: route.description,
      });
      res.writeHead(challenge.statusCode, challenge.headers);
      res.end(JSON.stringify(challenge.body));
      return;
    }

    // Requests must target this gateway's own configured merchant address.
    // PolicyEngine's per-agent whitelist protects the *agent*; this check
    // protects against the gateway being (ab)used as an open relay for
    // arbitrary third-party merchant payments it never advertised.
    if (payload.request.merchant.toLowerCase() !== config.merchantAddress.toLowerCase()) {
      sendJson(res, 400, {}, { error: 'Merchant mismatch: this gateway only settles payments to its own configured address' });
      return;
    }

    if (payload.request.deadline > 0n && BigInt(Math.floor(Date.now() / 1000)) > payload.request.deadline) {
      const rejection = createPolicyRejectionResponse(ReasonCode.ERR_EXPIRED, payload.request.agent);
      res.writeHead(rejection.statusCode, rejection.headers);
      res.end(JSON.stringify(rejection.body));
      return;
    }

    const signatureValid = await verifySpendRequestSignature(payload, config.agentWalletGuardAddress);
    if (!signatureValid) {
      const rejection = createPolicyRejectionResponse(ReasonCode.ERR_SIGNATURE_INVALID, payload.request.agent);
      res.writeHead(rejection.statusCode, rejection.headers);
      res.end(JSON.stringify(rejection.body));
      return;
    }

    // Pre-flight simulation: a free view call. Denies fail here, before any
    // gas is spent submitting a transaction that PolicyEngine would revert.
    let decision: { allowed: boolean; allowedAmount: bigint; reasonCode: number; evaluatedAtTimestamp: bigint };
    try {
      decision = (await publicClient.readContract({
        address: config.policyEngineAddress,
        abi: POLICY_ENGINE_ABI,
        functionName: 'evaluate',
        args: [payload.request],
      })) as typeof decision;
    } catch (err) {
      sendJson(res, 502, {}, { error: 'Failed to reach PolicyEngine on Monad', detail: (err as Error).message });
      return;
    }

    if (!decision.allowed) {
      const rejection = createPolicyRejectionResponse(decision.reasonCode as ReasonCode, payload.request.agent);
      res.writeHead(rejection.statusCode, rejection.headers);
      res.end(JSON.stringify(rejection.body));
      return;
    }

    if (!walletClient || !relayerAccount) {
      sendJson(res, 503, {}, {
        error: 'Settlement unavailable',
        detail: 'PolicyEngine allows this request, but no GATEWAY_RELAYER_PRIVATE_KEY is configured to submit the settlement transaction.',
      });
      return;
    }

    try {
      const txHash = await walletClient.writeContract({
        address: config.agentWalletGuardAddress,
        abi: AGENT_WALLET_GUARD_ABI,
        functionName: 'executeGatedPayment',
        args: [payload.request, payload.signature, config.usdcTokenAddress, '0x'],
        chain: null,
        account: relayerAccount,
      });

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      sendJson(
        res,
        200,
        { 'X-AgentGuard-Tx-Hash': txHash, 'X-AgentGuard-Decision': 'SETTLED' },
        {
          result: `settled:${url}`,
          txHash,
          blockNumber: receipt.blockNumber.toString(),
          status: receipt.status,
        }
      );
    } catch (err) {
      sendJson(res, 502, {}, { error: 'Onchain settlement failed', detail: (err as Error).message });
    }
  }

  return createServer((req, res) => {
    handleRequest(req, res).catch((err: unknown) => {
      sendJson(res, 500, {}, { error: 'Internal gateway error', detail: (err as Error)?.message });
    });
  });
}

// Only boot an actual listening server when this module is the process
// entrypoint (not when imported by tests).
const isMainModule = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMainModule) {
  const config = loadConfig();
  const server = createGatewayServer(config);
  server.listen(config.port, () => {
    console.log(`AgentGuard x402 Gateway listening on :${config.port} (Monad chain ${config.chainId})`);
    console.log(`Relayer configured: ${Boolean(config.relayerPrivateKey)}`);
  });
}
