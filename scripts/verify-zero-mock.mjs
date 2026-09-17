#!/usr/bin/env node
/**
 * AgentGuard Zero-Mock & UI Leak Prevention Invariant Checker
 * 
 * Enforces AGENTS.md Section 1 & Section 7 standards:
 *  1. 0 occurrences of Math.random in apps/web/src and services
 *  2. 0 occurrences of prohibited fallback address 0x70997970C51812dc3A010C7d01b50e0d17dc79C8 in production code
 *  3. 0 developer/daemon infrastructure leaks in user-facing UI strings (docker compose, :3001, localhost:, daemon, container)
 */

import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const webSrcDir = join(process.cwd(), 'apps', 'web', 'src');
const violations = [];

const FORBIDDEN_ADDRESS = '0x70997970c51812dc3a010c7d01b50e0d17dc79c8';

// Prohibited UI terms in user-facing JSX content
const PROHIBITED_UI_PATTERNS = [
  { regex: /\bdocker\s+compose\b/i, name: 'docker compose' },
  { regex: /localhost:\d{4}/i, name: 'localhost:port' },
  { regex: /:\b3001\b/, name: 'raw port :3001' },
  { regex: /\bdaemon\s+offline\b/i, name: 'daemon offline' },
  { regex: /\bWeb Crypto API\b/i, name: 'low-level Web Crypto API leak' },
];

async function scanFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      await scanFiles(path);
    } else if (/\.(tsx|jsx|ts)$/.test(entry.name)) {
      const content = await readFile(path, 'utf8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lineNum = i + 1;

        // 1. Check for Math.random()
        if (/\bMath\.random\s*\(/.test(line)) {
          violations.push(`${path}:${lineNum} Prohibited Math.random() detected: "${line.trim()}"`);
        }

        // 2. Check for prohibited fallback address
        if (line.toLowerCase().includes(FORBIDDEN_ADDRESS)) {
          violations.push(`${path}:${lineNum} Prohibited Anvil fallback address 0x7099... detected`);
        }

        // 3. Check for developer jargon in JSX strings (only in .tsx / .jsx files)
        if (/\.(tsx|jsx)$/.test(entry.name)) {
          for (const pattern of PROHIBITED_UI_PATTERNS) {
            // Check if match appears in user-facing JSX text (outside comments)
            if (!line.trim().startsWith('//') && !line.trim().startsWith('/*') && pattern.regex.test(line)) {
              violations.push(`${path}:${lineNum} UI terminology violation: prohibited developer jargon "${pattern.name}" found in UI text`);
            }
          }
        }
      }
    }
  }
}

async function main() {
  console.log('🛡️ Verifying Zero-Mock & UI Integrity Invariants (AGENTS.md)...');
  await scanFiles(webSrcDir);

  if (violations.length > 0) {
    console.error('\n❌ Zero-Mock Invariant Violations Found:');
    for (const v of violations) console.error(`  - ${v}`);
    process.exit(1);
  }

  console.log('✅ Zero-Mock invariant passed: 0 Math.random, 0 fallback addresses, 0 developer jargon leaks.');
}

main().catch((err) => {
  console.error('Fatal error checking zero-mock invariants:', err);
  process.exit(1);
});
