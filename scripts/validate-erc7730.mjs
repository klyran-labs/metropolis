import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const descriptor = JSON.parse(fs.readFileSync(path.join(root, 'descriptors/erc7730/eip712-ComputeXOrder.json'), 'utf8'));
const deployment = JSON.parse(fs.readFileSync(path.join(root, 'deployments/monad-testnet/eip712.json'), 'utf8'));
const typeKey = 'Order(address maker,bool isBid,uint256 pricePerSec,uint256 amount,uint256 nonce,uint256 expiry,uint256 tokenId,bytes ecdhPublicKey)';
const format = descriptor.display?.formats?.[typeKey];
const domain = descriptor.context?.eip712?.domain;
const errors = [];

if (!descriptor.$schema?.includes('erc7730-v2.schema.json')) errors.push('descriptor must target ERC-7730 v2');
if (!format?.intent || !Array.isArray(format.fields)) errors.push('display format is incomplete');
for (const field of ['maker', 'isBid', 'pricePerSec', 'amount', 'expiry', 'tokenId', 'nonce', 'ecdhPublicKey']) {
  if (!format?.fields?.some((entry) => entry.path === field)) errors.push(`missing display field: ${field}`);
}
for (const key of ['name', 'version', 'chainId', 'verifyingContract']) {
  if (domain?.[key] !== deployment[key]) errors.push(`domain mismatch: ${key}`);
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log('ERC-7730 ComputeX order descriptor matches the canonical EIP-712 deployment.');
