#!/usr/bin/env node
/**
 * Inline the engine, the component and the demo into one HTML file in docs/,
 * so the demo opens straight off disk or from GitHub Pages with no build step,
 * no bundler and no dependencies.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODULES = ['src/flap.js', 'src/board.js', 'src/element.js', 'demo/app.js'];

/** The page's own boot code, which no longer needs to import anything. */
const BOOT = [
  "const board = document.querySelector('#board');",
  'start({',
  '  board,',
  "  clock: document.querySelector('#clock'),",
  "  header: document.querySelector('#header'),",
  '});',
  '',
  "const toggle = document.querySelector('#sound');",
  "toggle.addEventListener('click', () => {",
  "  const on = board.toggleAttribute('sound');",
  "  toggle.textContent = 'clack: ' + (on ? 'on' : 'off');",
  '});',
].join('\n');

/** Drop relative imports and export keywords; the modules become one scope. */
function flatten(source) {
  return source
    .replace(/^import\s+[^;]*?from\s+['"]\.\.?\/[^'"]+['"];\s*$/gm, '')
    .replace(/^import\s+['"]\.\.?\/[^'"]+['"];\s*$/gm, '')
    .replace(/^export\s+(?=const|let|var|function|class|async)/gm, '')
    .trim();
}

const parts = [];
for (const file of MODULES) {
  parts.push(`// ---- ${file} ----\n${flatten(await readFile(resolve(root, file), 'utf8'))}`);
}

const html = await readFile(resolve(root, 'demo/index.html'), 'utf8');
const script = ['<script type="module">', parts.join('\n\n'), '', BOOT, '</script>'].join('\n');
const inlined = html.replace(/<script type="module">[\s\S]*?<\/script>/, () => script);

await mkdir(resolve(root, 'docs'), { recursive: true });
await writeFile(resolve(root, 'docs/index.html'), inlined);
console.log(`docs/index.html — ${(inlined.length / 1024).toFixed(1)} kB, no dependencies`);
