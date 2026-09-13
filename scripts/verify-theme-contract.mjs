import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const sourceRoot = join(process.cwd(), 'apps', 'web', 'src');
const violations = [];

// Allowable exceptions (e.g. theme configuration file that declares tokens)
const ALLOWED_FILES = new Set([
  'theme.ts',
  'globals.css',
  'env.ts',
]);

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
    } else if (/\.(tsx|jsx|ts)$/.test(entry.name)) {
      if (ALLOWED_FILES.has(entry.name)) continue;

      const source = await readFile(path, 'utf8');
      const lines = source.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // 1. Detect arbitrary hex classes: e.g. bg-[#14151a], text-[#9a9cae]
        const arbitraryHexMatch = line.match(/(?:bg|text|border|ring|fill|stroke|shadow)-\[#[0-9a-fA-F]{3,8}\]/);
        if (arbitraryHexMatch) {
          violations.push(
            `${path}:${i + 1} - Arbitrary hex class "${arbitraryHexMatch[0]}" violates config-driven design system. Use semantic tokens (e.g. bg-card, text-fg-muted, border-card-border).`
          );
        }

        // 2. Detect legacy hardcoded blue
        if (/#1b84ff|#056ee9/i.test(line)) {
          violations.push(
            `${path}:${i + 1} - Deprecated hardcoded blue hex found. Use theme primary tokens (bg-primary, text-primary).`
          );
        }
      }
    }
  }
}

await walk(sourceRoot);

if (violations.length > 0) {
  console.error('\n❌ Design System Contract Violation: Components must use config-driven design tokens.');
  console.error('Do NOT use arbitrary hex classes like bg-[#...] or hardcoded colors in JSX.\n');
  for (const violation of violations) {
    console.error(`  - ${violation}`);
  }
  console.error(`\nTotal violations found: ${violations.length}`);
  process.exit(1);
}

console.log('✅ Design system contract passed: 100% token-driven components, zero arbitrary hex literals.');
