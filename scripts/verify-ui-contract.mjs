import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

const sourceRoot = join(process.cwd(), 'apps', 'web', 'src');
const violations = [];
let inlineStyleCount = 0;

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await walk(path);
    } else if (/\.(tsx|jsx)$/.test(entry.name)) {
      const source = await readFile(path, 'utf8');
      const openingTags = source.matchAll(/<button\b[\s\S]*?>/g);
      for (const match of openingTags) {
        const tag = match[0];
        if (!/\btype\s*=/.test(tag)) {
          const line = source.slice(0, match.index).split('\n').length;
          violations.push(`${path}:${line}`);
        }
      }
      inlineStyleCount += (source.match(/style=\{\{/g) ?? []).length;
      const externalLinks = source.matchAll(/<a\b[\s\S]*?target\s*=\s*["']_blank["'][\s\S]*?>/g);
      for (const match of externalLinks) {
        if (!/\brel\s*=\s*["'][^"']*(?:noreferrer|noopener)[^"']*["']/.test(match[0])) {
          const line = source.slice(0, match.index).split('\n').length;
          violations.push(`${path}:${line} (external link requires rel="noreferrer" or rel="noopener")`);
        }
      }
    }
  }
}

await walk(sourceRoot);

if (violations.length > 0) {
  console.error('UI contract violation: interactive controls must satisfy production safety semantics.');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

// Inline styles bypass the design tokens and theme. New ones are blocked; remove existing ones
// and lower the baseline in scripts/inline-style-baseline.json as screens migrate to classes.
const baselinePath = join(process.cwd(), 'scripts', 'inline-style-baseline.json');
const { count: inlineStyleBaseline } = JSON.parse(await readFile(baselinePath, 'utf8'));
if (inlineStyleCount > inlineStyleBaseline) {
  console.error(`UI contract violation: ${inlineStyleCount} inline styles exceed the baseline of ${inlineStyleBaseline}. Use classes and design tokens instead.`);
  process.exit(1);
}
if (inlineStyleCount < inlineStyleBaseline) {
  console.log(`Inline styles dropped to ${inlineStyleCount}; lower scripts/inline-style-baseline.json from ${inlineStyleBaseline}.`);
}

console.log('UI interaction contract passed: all buttons declare an explicit type.');
