// Builds the loadable extension into dist/ (Issue #389).
//
//   npm run build          one-off build
//   npm run build:watch    rebuild on every source change
//
// "Load unpacked" points at extension/dist/, not at this folder. Four bundles
// (one per JS context, so each is a plain script a manifest can load), plus the
// static files copied next to them with the same relative paths the sources
// use — the manifest, the popup's HTML/CSS and its screen partials, which
// popup.js fetches at runtime via chrome.runtime.getURL('popup/screens/…').
// The i18n dictionaries are not copied: i18n.js requires them, so they are
// bundled into the popup.
//
// Source maps are written next to each bundle. `process.env.NODE_ENV` is
// replaced by a constant, which is how the few Jest-only branches in the
// sources (they check for 'test') stay out of the real extension.
const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DIST = path.join(ROOT, 'dist');

const ENTRY_POINTS = [
  'popup/popup.js',                // side panel
  'content/content-script.js',     // isolated world, every frame
  'content/api-capture.js',        // MAIN world network recorder
  'background/service-worker.js',  // relay
];

const STATIC_FILES = [
  'manifest.json',
  'popup/popup.html',
  'popup/popup.css',
  ...fs.readdirSync(path.join(ROOT, 'popup/screens')).map((f) => `popup/screens/${f}`),
];

const buildOptions = {
  entryPoints: ENTRY_POINTS.map((f) => path.join(ROOT, f)),
  outdir: DIST,
  outbase: ROOT,
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: 'chrome114',   // manifest.json's minimum_chrome_version
  sourcemap: true,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'info',
};

function copyStaticFiles() {
  for (const file of STATIC_FILES) {
    const target = path.join(DIST, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), target);
  }
}

async function main() {
  const watch = process.argv.includes('--watch');
  fs.rmSync(DIST, { recursive: true, force: true });
  copyStaticFiles();

  if (!watch) {
    await esbuild.build(buildOptions);
    console.log(`Built extension into ${path.relative(process.cwd(), DIST) || DIST}`);
    return;
  }

  const context = await esbuild.context(buildOptions);
  await context.watch();
  // esbuild watches the bundled sources; the copied files need their own watcher.
  for (const file of STATIC_FILES) {
    fs.watchFile(path.join(ROOT, file), { interval: 300 }, () => {
      copyStaticFiles();
      console.log(`Copied ${file}`);
    });
  }
  console.log(`Watching… extension is in ${DIST}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
