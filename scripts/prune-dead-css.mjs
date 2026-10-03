#!/usr/bin/env node
/**
 * Finds (and with --write removes) CSS rules in apps/web/src/globals.css whose class selectors
 * are never referenced by application source.
 *
 * Conservative by design:
 *  - a class counts as used if its name appears anywhere in .ts/.tsx/.html source, or starts
 *    with a prefix that precedes a template interpolation (`badge-${tone}`);
 *  - a rule is only dropped when every selector in its list needs an unused class;
 *  - selectors using :is()/:where()/:has() or attribute/tag-only selectors are always kept;
 *  - at-rules other than @media/@supports/@layer are kept (except @keyframes nobody references).
 *
 * Usage: node scripts/prune-dead-css.mjs [--write] [--check <maxDeadRules>]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webSrc = join(root, "apps/web/src");
const cssPath = join(webSrc, "globals.css");
const args = process.argv.slice(2);
const write = args.includes("--write");
const checkIndex = args.indexOf("--check");
const maxDead = checkIndex >= 0 ? Number(args[checkIndex + 1]) : null;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(tsx?|html)$/.test(name) ? [path] : [];
  });
}

const sourceFiles = [...walk(webSrc), join(root, "apps/web/index.html")];
const sourceText = sourceFiles.map((file) => readFileSync(file, "utf8")).join("\n");

const usedTokens = new Set(sourceText.match(/[A-Za-z_][\w-]*/g) ?? []);
const dynamicPrefixes = [...sourceText.matchAll(/([A-Za-z][\w-]*-)\$\{/g)].map((match) => match[1]);

function classIsUsed(name) {
  return usedTokens.has(name) || dynamicPrefixes.some((prefix) => name.startsWith(prefix));
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(" || char === "[") depth += 1;
    if (char === ")" || char === "]") depth -= 1;
    if (char === separator && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current.trim()) parts.push(current);
  return parts;
}

function selectorIsDead(selector) {
  if (/:(is|where|has)\(/.test(selector)) return false;
  const stripped = selector.replace(/:not\([^)]*\)/g, "");
  const classes = [...stripped.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((match) => match[1]);
  if (classes.length === 0) return false;
  return classes.some((name) => !classIsUsed(name));
}

/** Parses a block of CSS into [{ start, end, prelude, body|null }] top-level items, preserving offsets. */
function parseItems(css, from = 0, to = css.length) {
  const items = [];
  let i = from;
  while (i < to) {
    while (i < to && /\s/.test(css[i])) i += 1;
    if (i >= to) break;
    if (css.startsWith("/*", i)) {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? to : end + 2;
      continue;
    }
    const start = i;
    let preludeEnd = i;
    while (preludeEnd < to && css[preludeEnd] !== "{" && css[preludeEnd] !== ";") {
      if (css.startsWith("/*", preludeEnd)) {
        const end = css.indexOf("*/", preludeEnd + 2);
        preludeEnd = end === -1 ? to : end + 2;
      } else {
        preludeEnd += 1;
      }
    }
    if (preludeEnd >= to) break;
    if (css[preludeEnd] === ";") {
      items.push({ start, end: preludeEnd + 1, prelude: css.slice(start, preludeEnd).trim(), body: null });
      i = preludeEnd + 1;
      continue;
    }
    let depth = 1;
    let j = preludeEnd + 1;
    while (j < to && depth > 0) {
      if (css.startsWith("/*", j)) {
        const end = css.indexOf("*/", j + 2);
        j = end === -1 ? to : end + 2;
        continue;
      }
      if (css[j] === "{") depth += 1;
      if (css[j] === "}") depth -= 1;
      j += 1;
    }
    items.push({
      start,
      end: j,
      prelude: css.slice(start, preludeEnd).trim(),
      bodyStart: preludeEnd + 1,
      bodyEnd: j - 1,
      body: true,
    });
    i = j;
  }
  return items;
}

const css = readFileSync(cssPath, "utf8");
const removals = [];
let ruleCount = 0;

function scan(from, to) {
  for (const item of parseItems(css, from, to)) {
    if (!item.body) continue;
    const { prelude } = item;
    if (prelude.startsWith("@")) {
      if (/^@(media|supports|layer)\b/.test(prelude)) {
        scan(item.bodyStart, item.bodyEnd);
      } else if (/^@(-\w+-)?keyframes\b/.test(prelude)) {
        const name = prelude.split(/\s+/)[1];
        if (name && !usedTokens.has(name) && !new RegExp(`animation[^;{}]*\\b${name}\\b`).test(css.replace(css.slice(item.start, item.end), ""))) {
          removals.push({ start: item.start, end: item.end, label: prelude });
        }
      }
      continue;
    }
    ruleCount += 1;
    const selectors = splitTopLevel(prelude, ",").map((part) => part.trim()).filter(Boolean);
    if (selectors.length > 0 && selectors.every(selectorIsDead)) {
      removals.push({ start: item.start, end: item.end, label: prelude.replace(/\s+/g, " ").slice(0, 90) });
    }
  }
}

scan(0, css.length);

console.log(`globals.css: ${ruleCount} style rules scanned, ${removals.length} unused`);
if (!write && maxDead === null) {
  for (const removal of removals.slice(0, Number(process.env.PRUNE_LIST || 40))) console.log(`  - ${removal.label}`);
  if (removals.length > 40) console.log(`  … and ${removals.length - 40} more`);
}

if (write && removals.length) {
  let output = css;
  for (const removal of [...removals].sort((a, b) => b.start - a.start)) {
    output = output.slice(0, removal.start) + output.slice(removal.end);
  }
  output = output.replace(/\n{3,}/g, "\n\n");
  writeFileSync(cssPath, output);
  console.log(`Removed ${removals.length} unused rules (${css.length - output.length} bytes).`);
}

if (maxDead !== null && removals.length > maxDead) {
  console.error(`Unused CSS rules (${removals.length}) exceed the allowed ${maxDead}. Run: node scripts/prune-dead-css.mjs --write`);
  process.exit(1);
}
