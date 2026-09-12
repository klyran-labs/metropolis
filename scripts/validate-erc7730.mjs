import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'descriptors/erc7730/eip712-AgentGuardSpendRequest.json'), 'utf8'));
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployments/monad-testnet/eip712.json'), 'utf8'));
const typeKey = 'SpendRequest(address agent,address merchant,uint256 amount,bytes32 category,uint256 timestamp,uint256 deadline,uint256 nonce)';
const format = descriptor.display?.formats?.[typeKey];
const domain = descriptor.context?.eip712?.domain;
const errors = [];

if (!descriptor.$schema?.includes('erc7730-v2.schema.json')) errors.push('descriptor must target ERC-7730 v2');
if (!format?.intent || !Array.isArray(format.fields)) errors.push('display format is incomplete');
for (const field of ['agent', 'merchant', 'amount', 'category', 'timestamp', 'deadline', 'nonce']) {
  if (!format?.fields?.some((entry) => entry.path === field)) errors.push(`missing display field: ${field}`);
}
for (const key of ['name', 'version', 'chainId', 'verifyingContract']) {
  if (domain?.[key] !== deployment[key]) errors.push(`domain mismatch: ${key}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ERC-7730 AgentGuard SpendRequest descriptor matches the canonical EIP-712 deployment.');
