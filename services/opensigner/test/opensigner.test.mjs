import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { EventEmitter } from 'node:events';
import { recoverTypedDataAddress } from 'viem';

import { EncryptedVault } from '../dist/vault.js';
import { OpenSignerEngine, SPEND_REQUEST_TYPES } from '../dist/signer.js';
import { createOpenSignerServer } from '../dist/server.js';

import * as os from 'node:os';

const TEST_DIR = path.join(os.tmpdir(), 'agentguard-test-opensigner-' + process.pid);
const TEST_VAULT_PATH = path.join(TEST_DIR, 'test.vault.json');
const TEST_MASTER_KEY = 'test-enclave-master-key-xyz-2026';

function cleanup() {
  if (fs.existsSync(TEST_DIR)) {
    fs.rmSync(TEST_DIR, { recursive: true, force: true });
  }
}

// Helper to simulate HTTP requests without opening physical TCP sockets
function simulateRequest(server, options, bodyData) {
  return new Promise((resolve, reject) => {
    const req = new EventEmitter();
    req.method = options.method || 'GET';
    req.url = options.path || '/';
    req.headers = options.headers || {};

    let responseData = '';
    const res = new EventEmitter();
    res.setHeader = () => {};
    res.writeHead = (status, headers) => {
      res.statusCode = status;
      res.headers = headers;
    };
    res.end = (chunk) => {
      if (chunk) responseData += chunk;
      resolve({
        statusCode: res.statusCode || 200,
        headers: res.headers,
        body: responseData ? JSON.parse(responseData) : null,
      });
    };

    server.emit('request', req, res);

    if (bodyData) {
      req.emit('data', JSON.stringify(bodyData));
    }
    req.emit('end');
  });
}

test('OpenSigner Vault: AES-256-GCM encryption and atomic persistence', () => {
  cleanup();
  const vault = new EncryptedVault(TEST_VAULT_PATH, TEST_MASTER_KEY);
  
  // Create two wallets
  const w1 = vault.createWallet('agent_finance_01');
  const w2 = vault.createWallet('agent_risk_02');

  assert.ok(w1.walletId.startsWith('wallet_'));
  assert.ok(w1.address.startsWith('0x'));
  assert.equal(w1.label, 'agent_finance_01');
  assert.equal(vault.count(), 2);

  // Confirm private key can be decrypted in memory
  const privKey = vault.getDecryptedPrivateKey(w1.walletId);
  assert.ok(privKey.startsWith('0x'));
  assert.equal(privKey.length, 66); // 0x + 64 hex chars

  // Read raw file on disk: ensure raw private key is NEVER in plain text
  const fileRaw = fs.readFileSync(TEST_VAULT_PATH, 'utf8');
  assert.ok(!fileRaw.includes(privKey), 'Raw private key must not appear on disk');
  const parsed = JSON.parse(fileRaw);
  assert.ok(parsed.wallets[w1.walletId].encryptedPrivateKey, 'Encrypted private key present');
  assert.ok(parsed.wallets[w1.walletId].iv, 'IV present');
  assert.ok(parsed.wallets[w1.walletId].authTag, 'Auth tag present');

  // Reload vault from disk with same master key
  const reloadedVault = new EncryptedVault(TEST_VAULT_PATH, TEST_MASTER_KEY);
  assert.equal(reloadedVault.count(), 2);
  const fetched = reloadedVault.getWallet(w1.address);
  assert.equal(fetched.walletId, w1.walletId);
  assert.equal(fetched.address.toLowerCase(), w1.address.toLowerCase());

  // Reloaded vault can decrypt
  const reloadedPrivKey = reloadedVault.getDecryptedPrivateKey(w1.walletId);
  assert.equal(reloadedPrivKey, privKey);
});

test('OpenSigner Signer: EIP-712 SpendRequest signing and cryptographic recovery', async () => {
  cleanup();
  const vault = new EncryptedVault(TEST_VAULT_PATH, TEST_MASTER_KEY);
  const w = vault.createWallet('signing_agent');
  const engine = new OpenSignerEngine(vault);

  const verifyingContract = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0';
  const merchant = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';

  const spendRequest = {
    agent: w.address,
    merchant,
    amount: '1000000000000000000', // 1 MON
    category: '0x0000000000000000000000000000000000000000000000000000000000000000',
    timestamp: 1741500000,
    deadline: 1741503600,
    nonce: 1,
  };

  const signResult = await engine.signSpendRequest(w.walletId, {
    request: spendRequest,
    verifyingContract,
    chainId: 10143,
  });

  assert.ok(signResult.signature.startsWith('0x'));
  assert.equal(signResult.signer.toLowerCase(), w.address.toLowerCase());

  // Verify that the signature recovers on Monad EIP-712 typed domain
  const recoveredAddress = await recoverTypedDataAddress({
    domain: signResult.domain,
    types: SPEND_REQUEST_TYPES,
    primaryType: 'SpendRequest',
    message: {
      agent: spendRequest.agent,
      merchant: spendRequest.merchant,
      amount: BigInt(spendRequest.amount),
      category: spendRequest.category,
      timestamp: BigInt(spendRequest.timestamp),
      deadline: BigInt(spendRequest.deadline),
      nonce: BigInt(spendRequest.nonce),
    },
    signature: signResult.signature,
  });

  assert.equal(recoveredAddress.toLowerCase(), w.address.toLowerCase());
});

test('OpenSigner Signer: Rejects unauthorized signing attempt for a foreign address', async () => {
  cleanup();
  const vault = new EncryptedVault(TEST_VAULT_PATH, TEST_MASTER_KEY);
  const w = vault.createWallet('honest_agent');
  const engine = new OpenSignerEngine(vault);

  const foreignAddress = '0x1111111111111111111111111111111111111111';

  await assert.rejects(
    async () => {
      await engine.signSpendRequest(w.walletId, {
        request: {
          agent: foreignAddress,
          merchant: '0x2222222222222222222222222222222222222222',
          amount: '500',
          timestamp: 1000,
          deadline: 2000,
          nonce: 1,
        },
        verifyingContract: '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
      });
    },
    /Agent address mismatch/
  );
});

test('OpenSigner HTTP Server: Probes and API routes simulation', async () => {
  cleanup();
  const vault = new EncryptedVault(TEST_VAULT_PATH, TEST_MASTER_KEY);
  const engine = new OpenSignerEngine(vault);
  const server = createOpenSignerServer(vault, engine);

  try {
    // 1. Health check
    const health = await simulateRequest(server, { method: 'GET', path: '/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.body.status, 'healthy');
    assert.equal(health.body.service, 'agentguard-opensigner');

    // 2. Readiness check
    const ready = await simulateRequest(server, { method: 'GET', path: '/ready' });
    assert.equal(ready.statusCode, 200);
    assert.equal(ready.body.status, 'ready');

    // 3. Provision new wallet via API
    const create = await simulateRequest(
      server,
      { method: 'POST', path: '/api/v1/wallets' },
      { label: 'api_agent_01' }
    );
    assert.equal(create.statusCode, 201);
    assert.equal(create.body.success, true);
    assert.ok(create.body.wallet.address.startsWith('0x'));
    assert.ok(create.body.wallet.walletId.startsWith('wallet_'));

    const agentAddress = create.body.wallet.address;

    // 4. List wallets via API
    const list = await simulateRequest(server, { method: 'GET', path: '/api/v1/wallets' });
    assert.equal(list.statusCode, 200);
    assert.equal(list.body.count, 1);
    assert.equal(list.body.wallets[0].address, agentAddress);

    // 5. Request EIP-712 signature via API
    const sign = await simulateRequest(
      server,
      { method: 'POST', path: '/api/v1/sign-spend-request' },
      {
        walletIdOrAddress: agentAddress,
        verifyingContract: '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0',
        request: {
          agent: agentAddress,
          merchant: '0x3333333333333333333333333333333333333333',
          amount: '2500000000000000000',
          category: '0x0000000000000000000000000000000000000000000000000000000000000000',
          timestamp: 1741500000,
          deadline: 1741503600,
          nonce: 1,
        },
      }
    );
    // 6. Request TEE Enclave Attestation Quote via API
    const quoteRes = await simulateRequest(
      server,
      { method: 'POST', path: '/api/v1/attestation/quote' },
      { walletIdOrAddress: agentAddress }
    );
    assert.equal(quoteRes.statusCode, 200);
    assert.equal(quoteRes.body.success, true);
    assert.equal(quoteRes.body.quote.agent, agentAddress);
    assert.equal(quoteRes.body.quote.enclaveType, 'AWS_NITRO');
    assert.ok(quoteRes.body.quote.mrenclave.startsWith('0x'));

    // 7. Verify TEE Attestation Quote via API
    const verifyRes = await simulateRequest(
      server,
      { method: 'POST', path: '/api/v1/attestation/verify' },
      { quote: quoteRes.body.quote }
    );
    assert.equal(verifyRes.statusCode, 200);
    assert.equal(verifyRes.body.success, true);
    assert.equal(verifyRes.body.valid, true);
    assert.equal(verifyRes.body.status, 'ATTESTATION_VALID');
  } finally {
    cleanup();
  }
});

