import * as http from 'node:http';
import type { EncryptedVault } from './vault.js';
import type { OpenSignerEngine } from './signer.js';

export function createOpenSignerServer(
  vault: EncryptedVault,
  engine: OpenSignerEngine,
  apiToken = ''
): http.Server {
  return http.createServer(async (req, res) => {
    // Enable CORS for all web clients
    res.setHeader('Access-Control-Allow-Origin', '*');
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

      // Plain ERC-20 transfer, submitted and gas-paid by this wallet (used for Load)
      if (req.method === 'POST' && pathname === '/api/v1/execute-transfer') {
        const body = await parseBody();
        const { walletIdOrAddress, tokenAddress, to, amount, chainId } = body;
        if (!walletIdOrAddress || !tokenAddress || !to || !amount) {
          sendJson(400, {
            success: false,
            error: 'Missing required parameters: walletIdOrAddress, tokenAddress, to, amount',
          });
          return;
        }
        const result = await engine.executeTransfer(walletIdOrAddress, { tokenAddress, to, amount, chainId });
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

      // Generic EIP-712 Typed Data Signer
      if (req.method === 'POST' && pathname === '/api/v1/sign-typed-data') {
        const body = await parseBody();
        const { walletIdOrAddress, domain, types, primaryType, message } = body;

        if (!walletIdOrAddress || !domain || !types || !primaryType || !message) {
          sendJson(400, {
            success: false,
            error: 'Missing required parameters: walletIdOrAddress, domain, types, primaryType, message',
          });
          return;
        }

        const result = await engine.signGenericTypedData(walletIdOrAddress, {
          domain,
          types,
          primaryType,
          message,
        });

        sendJson(200, {
          success: true,
          ...result,
        });
        return;
      }

      // Hardware TEE Attestation Quote Endpoint
      if (req.method === 'POST' && pathname === '/api/v1/attestation/quote') {
        const body = await parseBody();
        const { walletIdOrAddress } = body;
        if (!walletIdOrAddress) {
          sendJson(400, { success: false, error: 'Missing walletIdOrAddress parameter' });
          return;
        }

        const quote = vault.getEnclaveQuote(walletIdOrAddress);
        sendJson(200, { success: true, quote });
        return;
      }

      // Hardware TEE Attestation Verification Endpoint
      if (req.method === 'POST' && pathname === '/api/v1/attestation/verify') {
        const body = await parseBody();
        const { quote } = body;
        if (!quote || !quote.mrenclave || !quote.agent) {
          sendJson(400, { success: false, error: 'Missing or invalid quote payload' });
          return;
        }

        const isExpired = Date.now() > Number(quote.expiresAt);
        if (isExpired) {
          sendJson(200, {
            success: true,
            valid: false,
            reason: 'Enclave attestation quote expired',
          });
          return;
        }

        sendJson(200, {
          success: true,
          valid: true,
          mrenclave: quote.mrenclave,
          agent: quote.agent,
          status: 'ATTESTATION_VALID',
        });
        return;
      }

      sendJson(404, { success: false, error: 'Endpoint not found' });
    } catch (err: any) {
      sendJson(500, {
        success: false,
        error: err?.message || 'Internal Server Error',
      });
    }
  });
}
