/**
 * Real integration tests against the actual gateway HTTP server (not a JS
 * simulation of it — this imports and boots the same createGatewayServer
 * used in production). Covers everything verifiable without a live chain;
 * see README.md for what's intentionally out of scope here (on-chain
 * settlement needs a running Monad node / anvil).
 *
 * Run after building: `npm run build` (tsc) then `node --test test/gateway.test.mjs`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGatewayServer } from '../dist/index.js';

const POLICY_ENGINE_ADDRESS = '0x2222222222222222222222222222222222222222';
const REPUTATION_REGISTRY_ADDRESS = '0x3333333333333333333333333333333333333333';
const AGENT_WALLET_GUARD_ADDRESS = '0x4444444444444444444444444444444444444444';
const USDC_TOKEN_ADDRESS = '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea';
const MERCHANT_ADDRESS = '0x5555555555555555555555555555555555555555';

function baseConfig() {
  return {
    port: 0,
    chainId: 10143,
    rpcUrl: 'https://testnet-rpc.monad.xyz',
    policyEngineAddress: POLICY_ENGINE_ADDRESS,
    reputationRegistryAddress: REPUTATION_REGISTRY_ADDRESS,
    agentWalletGuardAddress: AGENT_WALLET_GUARD_ADDRESS,
    usdcTokenAddress: USDC_TOKEN_ADDRESS,
    merchantAddress: MERCHANT_ADDRESS,
    relayerPrivateKey: null,
  };
}

async function withServer(config, fn) {
  const server = createGatewayServer(config);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('gateway: /health reports chain id and relayer configuration', async () => {
  await withServer(baseConfig(), async (base) => {
    const res = await fetch(`${base}/health`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.chainId, 10143);
    assert.equal(body.relayerConfigured, false);
  });
});

test('gateway: unknown route returns 404 with known routes listed', async () => {
  await withServer(baseConfig(), async (base) => {
    const res = await fetch(`${base}/v1/does-not-exist`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.ok(Array.isArray(body.knownRoutes));
    assert.ok(body.knownRoutes.includes('/v1/inference'));
  });
});

test('gateway: protected route without a payment header returns a real x402 challenge', async () => {
  await withServer(baseConfig(), async (base) => {
    const res = await fetch(`${base}/v1/inference`);
    assert.equal(res.status, 402);
    assert.ok(res.headers.get('www-authenticate')?.startsWith('x402 '));
    const body = await res.json();
    assert.equal(body.challenge.payTo.toLowerCase(), MERCHANT_ADDRESS.toLowerCase());
    assert.equal(body.challenge.category, 'AI_INFERENCE');
  });
});

test('gateway: rejects a request whose signed merchant does not match this gateway', async () => {
  await withServer(baseConfig(), async (base) => {
    const forgedPayload = Buffer.from(JSON.stringify({
      request: {
        agent: '0x1111111111111111111111111111111111111111',
        merchant: '0x9999999999999999999999999999999999999999', // wrong merchant
        amount: '1000',
        category: '0x00',
        timestamp: '1',
        deadline: '99999999999',
        nonce: '1',
      },
      signature: '0x' + '11'.repeat(65),
    })).toString('base64');

    const res = await fetch(`${base}/v1/inference`, {
      headers: { 'Payment-Signature': `x402 ${forgedPayload}` },
    });
    assert.equal(res.status, 400);
  });
});

test('gateway: rejects a syntactically-invalid payment header as if no header were sent', async () => {
  await withServer(baseConfig(), async (base) => {
    const res = await fetch(`${base}/v1/inference`, {
      headers: { 'Payment-Signature': 'not-a-valid-x402-header' },
    });
    // parseX402Authorization returns null for anything not starting with "x402 ",
    // which the gateway treats as "no payment presented yet" and re-challenges.
    assert.equal(res.status, 402);
  });
});
