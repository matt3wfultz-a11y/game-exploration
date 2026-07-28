#!/usr/bin/env node
/* Bundle a game into one self-contained HTML file under dist/.
   No dependencies, no toolchain — it just inlines the scripts in order.
   Useful for sharing a single file, or uploading to itch.io.

   Usage:
     node build.js                      build every game in games/
     node build.js games/pest-control   build one
*/
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const GAMES_DIR = path.join(ROOT, 'games');

function build(gameDir) {
  const name = path.basename(gameDir);
  const indexPath = path.join(gameDir, 'index.html');
  if (!fs.existsSync(indexPath)) throw new Error(`no index.html in ${gameDir}`);
  const html = fs.readFileSync(indexPath, 'utf8');

  // Pull the script list out of index.html so the two can never drift apart.
  const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  if (!srcs.length) throw new Error(`no <script src> tags in ${indexPath}`);

  const bundle = srcs.map((src) => {
    const code = fs.readFileSync(path.join(gameDir, src), 'utf8');
    return `/* ===== ${src} ${'='.repeat(Math.max(0, 64 - src.length))} */\n${code}`;
  }).join('\n');

  // Top-level `const` in the game files would otherwise land in global scope;
  // the IIFE keeps a bundled game safe to drop into any host page.
  const out = html.replace(
    /(?:<!--[\s\S]*?-->\s*)?(?:<script src="[^"]+"><\/script>\s*)+/,
    `<script>\n(function () {\n${bundle}\n})();\n</script>\n`
  );

  fs.mkdirSync(path.join(ROOT, 'dist'), { recursive: true });
  const dest = path.join(ROOT, 'dist', `${name}.html`);
  fs.writeFileSync(dest, out);
  console.log(`built dist/${name}.html (${(Buffer.byteLength(out) / 1024).toFixed(1)} KB, ${srcs.length} sources)`);
  return dest;
}

const arg = process.argv[2];
if (arg) {
  build(path.resolve(ROOT, arg));
} else {
  for (const entry of fs.readdirSync(GAMES_DIR)) {
    const dir = path.join(GAMES_DIR, entry);
    if (fs.statSync(dir).isDirectory()) build(dir);
  }
}
