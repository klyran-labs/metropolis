import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { generateMnemonic, english, mnemonicToAccount } from 'viem/accounts';

const envFilePath = process.argv[2] || '.env.local';

if (!existsSync(envFilePath)) {
  throw new Error(`Missing ${envFilePath}. Copy docker/.env.local.example first.`);
}

let envContent = readFileSync(envFilePath, 'utf8');

function readValue(key) {
  const match = envContent.match(new RegExp(`^${key}=(.*)$`, 'm'));
  return match?.[1]?.trim() || '';
}

function writeValue(key, value) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, 'm');
  envContent = pattern.test(envContent)
    ? envContent.replace(pattern, line)
    : `${envContent.trimEnd()}\n${line}\n`;
}

const existingMnemonic = readValue('ANVIL_MNEMONIC');
const mnemonic = existingMnemonic || generateMnemonic(english);
const account = mnemonicToAccount(mnemonic);
const derivedPrivateKey = `0x${Buffer.from(account.getHdKey().privateKey).toString('hex')}`;
const existingPrivateKey = readValue('DEPLOYER_PRIVATE_KEY');

if (existingPrivateKey && existingPrivateKey.toLowerCase() !== derivedPrivateKey.toLowerCase()) {
  throw new Error(
    'DEPLOYER_PRIVATE_KEY does not match the first account derived from ANVIL_MNEMONIC. Remove both values and rerun make docker-up to generate a local account.',
  );
}

const requiredDefaults = {
  PAYMASTER_VERIFICATION_GAS_LIMIT: '100000',
  PAYMASTER_POST_OP_GAS_LIMIT: '40000',
  TENANT_MAX_CONCURRENCY: '64',
  MAX_TRACKED_TENANTS: '10000',
  PROVIDER_MAX_CONCURRENCY: '32',
  RPC_MAX_CONCURRENCY: '128',
};

for (const [key, defaultValue] of Object.entries(requiredDefaults)) {
  if (!readValue(key)) {
    writeValue(key, defaultValue);
  }
}

writeValue('ANVIL_MNEMONIC', mnemonic);
writeValue('DEPLOYER_PRIVATE_KEY', derivedPrivateKey);
writeFileSync(envFilePath, envContent);

console.log(`Local Anvil deployer configured: ${account.address}`);
