#!/usr/bin/env node
/**
 * AgentGuard — Institutional Privy Role Provisioning Tool
 *
 * Secure CLI script to bootstrap or update user roles and permissions on Privy.
 * Calls Privy's Server REST API (POST https://auth.privy.io/api/v1/users/{did}/custom_metadata)
 * using the configured PRIVY_APP_ID and PRIVY_APP_SECRET.
 *
 * Usage:
 *   node scripts/set-privy-role.mjs <did:privy:...> <role> [app_secret]
 *   ./scripts/set-privy-role.sh <did:privy:...> <role>
 *   npm run admin:set-role -- <did:privy:...> <role>
 *
 * Example:
 *   node scripts/set-privy-role.mjs did:privy:cm1234567890abcdef super_admin
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = resolve(__dirname, '..');

const VALID_ROLES = ['super_admin', 'sec_ops', 'treasury', 'fleet_devops', 'auditor'];

// Minimal .env parser without external dependencies
function loadEnvFile(path) {
  if (!existsSync(path)) return {};
  const content = readFileSync(path, 'utf8');
  const env = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    env[key] = val;
  }
  return env;
}

// Load env files in priority order
const localEnv = loadEnvFile(resolve(rootDir, '.env.local'));
const baseEnv = loadEnvFile(resolve(rootDir, '.env'));
const dockerEnv = loadEnvFile(resolve(rootDir, 'docker/.env.production.example'));

function getEnv(key, fallback = '') {
  return process.env[key] || localEnv[key] || baseEnv[key] || dockerEnv[key] || fallback;
}

function printUsage() {
  console.log(`
AgentGuard Privy Role Provisioning CLI
---------------------------------------
Safely sets an operator's role and custom metadata on Privy via Server API.

Usage:
  node scripts/set-privy-role.mjs <did> <role> [app_secret]

Arguments:
  <did>          Privy User DID (e.g. did:privy:cm123abc456def)
  <role>         Role to assign. Allowed: ${VALID_ROLES.join(', ')}
  [app_secret]   Optional. Privy App Secret (defaults to PRIVY_APP_SECRET in env)

Options:
  --dry-run      Validate parameters and print API payload without sending request
  -h, --help     Show this help message

Environment Variables:
  PRIVY_APP_ID       Privy Application ID (default: cmton65ao004l0cl11tgmwiah)
  PRIVY_APP_SECRET   Privy Server API Secret Key (Settings -> Basics -> App Secret)

Examples:
  node scripts/set-privy-role.mjs did:privy:cm7xyz123 super_admin
  node scripts/set-privy-role.mjs did:privy:cm7xyz123 sec_ops
  npm run admin:set-role -- did:privy:cm7xyz123 super_admin
`);
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes('-h') || args.includes('--help') || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const isDryRun = args.includes('--dry-run');
  const positionalArgs = args.filter((a) => !a.startsWith('--'));

  const targetDid = positionalArgs[0]?.trim();
  const targetRole = positionalArgs[1]?.trim().toLowerCase();
  const cliSecret = positionalArgs[2]?.trim();

  if (!targetDid || !targetDid.startsWith('did:')) {
    console.error(`\x1b[31mError: Missing or invalid Privy DID: "${targetDid}". Must start with "did:privy:" or "did:".\x1b[0m`);
    printUsage();
    process.exit(1);
  }

  if (!targetRole || !VALID_ROLES.includes(targetRole)) {
    console.error(`\x1b[31mError: Invalid role "${targetRole}". Must be one of: ${VALID_ROLES.join(', ')}\x1b[0m`);
    process.exit(1);
  }

  const appId = getEnv('PRIVY_APP_ID', 'cmton65ao004l0cl11tgmwiah');
  const appSecret = cliSecret || getEnv('PRIVY_APP_SECRET');

  console.log('\n======================================================');
  console.log(' AgentGuard — Privy Custom Metadata Role Provisioner');
  console.log('======================================================');
  console.log(` Target User DID:   \x1b[36m${targetDid}\x1b[0m`);
  console.log(` Assigned Role:     \x1b[32m${targetRole.toUpperCase()}\x1b[0m`);
  console.log(` Privy App ID:      ${appId}`);
  console.log(` Privy App Secret:  ${appSecret ? '••••••••' + appSecret.slice(-4) : '\x1b[33mNot Configured\x1b[0m'}`);
  console.log(` Timestamp:         ${new Date().toISOString()}`);
  console.log('------------------------------------------------------');

  const customMetadataPayload = {
    custom_metadata: {
      role: targetRole,
      updatedAt: new Date().toISOString(),
      updatedBy: 'cli:admin-provisioner',
    },
  };

  if (isDryRun) {
    console.log('\x1b[33m[DRY RUN MODE] Request payload ready to send:\x1b[0m');
    console.log(JSON.stringify(customMetadataPayload, null, 2));
    console.log('Endpoint: POST https://auth.privy.io/api/v1/users/' + encodeURIComponent(targetDid) + '/custom_metadata');
    process.exit(0);
  }

  if (!appSecret) {
    console.error('\n\x1b[31mError: PRIVY_APP_SECRET is required to update data on Privy.\x1b[0m');
    console.error('Please provide PRIVY_APP_SECRET via environment variable, in .env, or as argument:');
    console.error(`  node scripts/set-privy-role.mjs ${targetDid} ${targetRole} <your_privy_app_secret>`);
    console.error('Or test in dry run mode with --dry-run');
    process.exit(1);
  }

  console.log('Dispatching HTTPS request to Privy Server API...');
  const basicAuth = Buffer.from(`${appId}:${appSecret}`).toString('base64');
  const endpoint = `https://auth.privy.io/api/v1/users/${encodeURIComponent(targetDid)}/custom_metadata`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'privy-app-id': appId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(customMetadataPayload),
    });

    const responseData = await res.json().catch(() => ({}));

    if (!res.ok) {
      console.error(`\x1b[31m✘ Privy API request failed with HTTP ${res.status}:\x1b[0m`);
      console.error(JSON.stringify(responseData, null, 2));
      process.exit(1);
    }

    console.log('\n\x1b[32m✔ SUCCESS: Role successfully committed to Privy custom metadata!\x1b[0m');
    console.log('Updated user record on Privy:');
    console.log(JSON.stringify(responseData, null, 2));
    console.log('======================================================\n');
  } catch (err) {
    console.error(`\x1b[31m✘ Network error communicating with Privy:\x1b[0m`, err.message);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal execution error:', err);
  process.exit(1);
});
