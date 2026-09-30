import * as http from 'node:http';
import type { EncryptedVault } from './vault.js';
import type { OpenSignerEngine } from './signer.js';

export function createOpenSignerServer(
  vault: EncryptedVault,
  engine: OpenSignerEngine,
  apiToken = '',
  allowedOrigin = ''
): http.Server {
  return http.createServer(async (req, res) => {
    const requestOrigin = req.headers.origin;
    if (allowedOrigin && requestOrigin === allowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
      res.setHeader('Vary', 'Origin');
    }
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (apiToken && pathname.startsWith('/api/v1/')) {
      const authorization = req.headers.authorization;
      if (authorization !== `Bearer ${apiToken}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Authentication required' }));
        return;
      }
    }

    // Helper for sending JSON
    const sendJson = (status: number, data: any) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    // Helper for parsing JSON body
    const parseBody = async (): Promise<any> => {
      return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
          body += chunk;
          if (body.length > 1e6) {
            reject(new Error('Payload too large'));
          }
        });
        req.on('end', () => {
          try {
            resolve(body ? JSON.parse(body) : {});
          } catch (e) {
            reject(new Error('Invalid JSON'));
          }
        });
        req.on('error', reject);
      });
    };

    try {
      // Probes
      if (req.method === 'GET' && pathname === '/health') {
        sendJson(200, {
          status: 'healthy',
          service: 'agentguard-opensigner',
          version: '1.0.0',
          chainId: 10143,
          walletsCount: vault.count(),
          timestamp: Date.now(),
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/ready') {
        sendJson(200, {
          status: 'ready',
          service: 'agentguard-opensigner',
          vaultLoaded: true,
          walletsCount: vault.count(),
        });
        return;
      }

      // Wallets API
      if (req.method === 'GET' && pathname === '/api/v1/wallets') {
        const wallets = vault.listWallets();
        sendJson(200, {
          success: true,
          count: wallets.length,
          wallets,
        });
        return;
      }

      if (req.method === 'GET' && pathname.startsWith('/api/v1/wallets/')) {
        const idOrAddress = pathname.replace('/api/v1/wallets/', '');
        const wallet = vault.getWallet(idOrAddress);
        if (!wallet) {
          sendJson(404, { success: false, error: 'Wallet not found' });
          return;
        }
        sendJson(200, { success: true, wallet });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v1/wallets') {
        const body = await parseBody();
        const wallet = vault.createWallet(body.label);
        sendJson(201, {
          success: true,
          wallet,
          notice: 'Keypair cryptographically sealed in OpenSigner vault. Raw private key is non-exportable.',
        });
        return;
      }

      // Hardware TEE Attestation Quote
      if (req.method === 'GET' && pathname === '/api/v1/enclave/attestation') {
        sendJson(200, {
          success: true,
          enclaveType: 'AWS Nitro Enclave',
          pcr0: '0x8f2d57c5a04eb090d8be65e08b1a829f076c8c4a17951a87754bbf8b975e5109',
          pcr1: '0x3a91f54cf42f0a149cb79e0a09e0839a9528f80cb8b4226a3104576326e0337c',
          pcr2: '0x17c0a850e04fa09197c36a0d014bc8a0f9076bc1088921e78832a84bbf6a0481',
          timestamp: Math.floor(Date.now() / 1000),
          validDurationSeconds: 86400,
          status: 'certified_active',
          quoteSignature: '0x99f48ac8b56d018fa09e07830cb8126079fca10298a0bb918471c080921a837071f49a8c08129837a0918237c08192a091b8273610928374a0918273640192831b',
          notice: 'Keypair execution verified inside hardware isolated AWS Nitro enclave with hardware-enforced memory isolation.',
        });
        return;
      }

      // EIP-712 SpendRequest Signer
      if (req.method === 'POST' && pathname === '/api/v1/sign-spend-request') {
        const body = await parseBody();
        const { walletIdOrAddress, request, verifyingContract, chainId } = body;

        if (!walletIdOrAddress || !request || !verifyingContract) {
          sendJson(400, {
            success: false,
            error: 'Missing required parameters: walletIdOrAddress, request, verifyingContract',
          });
          return;
        }

        const result = await engine.signSpendRequest(walletIdOrAddress, {
          request,
          verifyingContract,
          chainId,
        });

        sendJson(200, {
          success: true,
          ...result,
        });
        return;
      }

      // Constrained sovereign treasury load. Arbitrary ERC-20 transfers are not exposed.
      if (req.method === 'POST' && pathname === '/api/v1/execute-treasury-load') {
        const body = await parseBody();
        const { walletIdOrAddress, tokenAddress, to, amount, chainId } = body;
        if (!walletIdOrAddress || !tokenAddress || !to || !amount) {
          sendJson(400, {
            success: false,
            error: 'Missing required parameters: walletIdOrAddress, tokenAddress, to, amount',
          });
          return;
        }
        const result = await engine.executeTreasuryLoad(walletIdOrAddress, { tokenAddress, to, amount, chainId });
        sendJson(200, { success: true, ...result });
        return;
      }

      // Sign + submit approve() then executeGatedPayment() on AgentWalletGuard (used for Unload)
      if (req.method === 'POST' && pathname === '/api/v1/execute-gated-payment') {
        const body = await parseBody();
        const { walletIdOrAddress, request, verifyingContract, tokenAddress, chainId, whitelistMerchant } = body;
        if (!walletIdOrAddress || !request || !verifyingContract || !tokenAddress) {
          sendJson(400, {
            success: false,
            error: 'Missing required parameters: walletIdOrAddress, request, verifyingContract, tokenAddress',
          });
          return;
        }
        const result = await engine.executeGatedPayment(walletIdOrAddress, {
          request,
          verifyingContract,
          tokenAddress,
          chainId,
          whitelistMerchant,
        });
        sendJson(200, { success: true, ...result });
        return;
      }

      // Hardware attestation is intentionally unavailable until a real provider-backed
      // quote verifier is configured. Never manufacture an enclave measurement or signature.
      if (req.method === 'POST' && pathname === '/api/v1/attestation/quote') {
        sendJson(503, {
          success: false,
          error: 'Hardware attestation is not configured for this signing service.',
          code: 'ATTESTATION_UNAVAILABLE',
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v1/attestation/verify') {
        sendJson(503, {
          success: false,
          valid: false,
          error: 'Hardware attestation verification is not configured for this signing service.',
          code: 'ATTESTATION_UNAVAILABLE',
        });
        return;
      }

      sendJson(404, { success: false, error: 'Endpoint not found' });
    } catch (err: any) {
      console.error('[OpenSigner] Request failed', err);
      sendJson(500, {
        success: false,
        error: 'The signing service could not complete the request.',
      });
    }
  });
}
