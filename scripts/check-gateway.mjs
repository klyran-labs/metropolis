#!/usr/bin/env node
/**
 * AgentGuard Rust Gateway Verification Harness
 * 
 * Modes:
 *   --check  : Executes cargo check
 *   --clippy : Executes cargo clippy with -D warnings
 *   --all    : Executes both check and clippy
 */

import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, '..');
const gatewayDir = join(rootDir, 'services', 'gateway');
const manifestPath = join(gatewayDir, 'Cargo.toml');

const mode = process.argv[2] || '--check';

function isCargoAvailable() {
  try {
    const res = spawnSync('cargo', ['--version'], { stdio: 'pipe', encoding: 'utf8' });
    return res.status === 0;
  } catch {
    return false;
  }
}

function runCargo(args, description) {
  console.log(`🦀 Running ${description}...`);
  const res = spawnSync('cargo', args, {
    cwd: gatewayDir,
    encoding: 'utf8',
  });

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);

  if (res.status !== 0) {
    const output = (res.stdout || '') + (res.stderr || '');
    const isNetworkError =
      output.includes('unable to update registry') ||
      output.includes('SSL certificate problem') ||
      output.includes('failed to get') ||
      output.includes('download of config.json failed');

    if (isNetworkError) {
      console.warn(`\n⚠️ Cargo crates registry is unreachable (isolated sandbox or offline environment).`);
      console.warn(`   Run "cargo fetch" with network access or build via Docker: "docker compose build gateway".`);
      return;
    }

    console.error(`❌ ${description} failed with exit code ${res.status}.`);
    process.exit(res.status || 1);
  }
  console.log(`✅ ${description} passed.`);
}

function main() {
  if (!isCargoAvailable()) {
    console.log('⚠️ Rust "cargo" toolchain not found in PATH. Skipping gateway verification.');
    console.log('   (To verify the gateway, install Rust from https://rustup.rs/)');
    return;
  }

  if (mode === '--check' || mode === '--all') {
    runCargo(['check', '--manifest-path', manifestPath], 'cargo check');
  }

  if (mode === '--clippy' || mode === '--all') {
    runCargo(
      ['clippy', '--manifest-path', manifestPath, '--all-targets', '--', '-D', 'warnings'],
      'cargo clippy'
    );
  }
}

main();
