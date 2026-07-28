#!/usr/bin/env node
/* Bundle the game into one self-contained HTML file at dist/warden.html.
   No dependencies, no toolchain — it just inlines the scripts in order.
   Useful for sharing a single file, or uploading to itch.io.

   Usage: node build.js
*/
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Pull the script list straight out of index.html so the two can't drift apart.
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
if (!srcs.length) throw new Error('no <script src> tags found in index.html');

const bundle = srcs.map((src) => {
  const code = fs.readFileSync(path.join(ROOT, src), 'utf8');
  return `/* ===== ${src} ${'='.repeat(Math.max(0, 66 - src.length))} */\n${code}`;
}).join('\n');

// `const STATE` in game.js is top-level; wrapping the bundle in an IIFE keeps
// it out of the global scope and avoids collisions with a host page.
const out = html.replace(
  /<!--[\s\S]*?-->\s*(?:<script src="[^"]+"><\/script>\s*)+/,
  `<script>\n(function () {\n${bundle}\n})();\n</script>\n`
);

fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
const dest = path.join(ROOT, 'dist', 'warden.html');
fs.writeFileSync(dest, out);

const kb = (Buffer.byteLength(out) / 1024).toFixed(1);
console.log(`built ${dest} (${kb} KB, ${srcs.length} sources inlined)`);
