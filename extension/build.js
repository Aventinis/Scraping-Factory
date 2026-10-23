// Builds the loadable extension into dist/ (Issue #389).
//
//   npm run build                     one-off build
//   npm run build:watch               rebuild on every source change
//   node build.js --channel release   release channel (install/build-bundle.sh)
//   node build.js --outdir <dir>      write somewhere other than dist/
//
// "Load unpacked" points at extension/dist/, not at this folder. Four bundles
// (one per JS context, so each is a plain script a manifest can load), plus the
// static files copied next to them with the same relative paths the sources
// use — the manifest, the popup's HTML/CSS and its screen partials, which
// popup.js fetches at runtime via chrome.runtime.getURL('popup/screens/…').
// The i18n dictionaries are not copied: i18n.ts imports them, so they are
// bundled into the popup.
//
// docs/user/*.md is turned into dist/docs/*.html too (docs-build.js, Issue #354).
//
// Source maps are written next to each bundle. Two `process.env.*` constants
// are replaced at build time (see defineFor): NODE_ENV, which is how the few
// Jest-only branches in the sources (they check for 'test') stay out of the
// real extension, and SF_CHANNEL, the release channel (shared/build-config.ts).
const esbuild = require('esbuild');
const { buildDocs } = require('./docs-build');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const DEFAULT_DIST = path.join(ROOT, 'dist');
const CHANNELS = ['development', 'release'];

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

// The compile-time constants. Always both defined: the browser has no
// `process`, so an undefined one would be a ReferenceError at runtime.
function defineFor(channel) {
  return {
    'process.env.NODE_ENV': '"production"',
    'process.env.SF_CHANNEL': JSON.stringify(channel),
  };
}

function buildOptions({ channel, outdir }) {
  return {
    entryPoints: ENTRY_POINTS.map((f) => path.join(ROOT, f)),
    outdir,
    outbase: ROOT,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome114',   // manifest.json's minimum_chrome_version
    sourcemap: true,
    legalComments: 'none',
    define: defineFor(channel),
    logLevel: 'info',
  };
}

// Issue #352: the channel decides whether development-only conveniences (plain
// http to another machine) exist at all, so a release build must never come out
// as a development one. Bundles shared/build-config.ts on its own with the very
// same defines and checks what it evaluates to.
function verifyChannel(channel) {
  const result = esbuild.buildSync({
    entryPoints: [path.join(ROOT, 'shared/build-config.ts')],
    bundle: true, format: 'iife', globalName: 'buildConfig', platform: 'browser', write: false,
    define: defineFor(channel), logLevel: 'silent',
  });
  const evaluated = new Function(`${result.outputFiles[0].text}; return buildConfig;`)();
  if (evaluated.CHANNEL !== channel) {
    throw new Error(`build.js: asked for the "${channel}" channel but shared/build-config.ts evaluates to "${evaluated.CHANNEL}"`);
  }
}

function copyStaticFiles(outdir) {
  for (const file of STATIC_FILES) {
    const target = path.join(outdir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(ROOT, file), target);
  }
}

// Issue #354 Part B: docs/user/*.md → <outdir>/docs/*.html, so "Learn more" in
// the side panel opens a bundled page and works offline.
const DOCS_DIR = path.join(ROOT, '..', 'docs', 'user');

async function copyDocs(outdir, docsDir = DOCS_DIR) {
  if (!fs.existsSync(docsDir)) {
    console.warn(`No ${docsDir} — the bundled documentation is skipped.`);
    return;
  }
  const pages = await buildDocs({ docsDir, outdir });
  console.log(`Built ${pages.length} documentation pages into ${path.join(outdir, 'docs')}`);
}

function parseArgs(argv) {
  const args = { watch: false, channel: 'development', outdir: DEFAULT_DIST, docsDir: DOCS_DIR };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--watch') args.watch = true;
    else if (argv[i] === '--channel') args.channel = argv[++i];
    else if (argv[i] === '--outdir') args.outdir = path.resolve(argv[++i]);
    else if (argv[i] === '--docs-dir') args.docsDir = path.resolve(argv[++i]);
    else throw new Error(`Unknown argument "${argv[i]}"`);
  }
  if (!CHANNELS.includes(args.channel)) throw new Error(`--channel must be one of: ${CHANNELS.join(', ')}`);
  return args;
}

// A one-off build is assembled next to the target and swapped in only when every
// part succeeded. Building straight into dist/ used to leave a half-written
// extension behind when a later step failed (for instance the documentation build
// without `npm install`): the manifest and popup.html were there, popup.js was
// not, and the side panel just kept loading.
async function buildOnce(args) {
  const staging = `${args.outdir}.building`;
  const previous = `${args.outdir}.previous`;
  fs.rmSync(staging, { recursive: true, force: true });
  try {
    copyStaticFiles(staging);
    await esbuild.build(buildOptions({ ...args, outdir: staging }));
    await copyDocs(staging, args.docsDir);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    console.error(`\nBuild failed — ${fs.existsSync(args.outdir) ? 'the previous build in ' + args.outdir + ' was left untouched' : 'nothing was written'}.`);
    throw err;
  }
  fs.rmSync(previous, { recursive: true, force: true });
  if (fs.existsSync(args.outdir)) fs.renameSync(args.outdir, previous);
  fs.renameSync(staging, args.outdir);
  fs.rmSync(previous, { recursive: true, force: true });
  console.log(`Built the ${args.channel} extension into ${args.outdir}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  verifyChannel(args.channel);

  if (!args.watch) {
    await buildOnce(args);
    return;
  }

  fs.rmSync(args.outdir, { recursive: true, force: true });
  copyStaticFiles(args.outdir);
  // In watch mode a documentation problem must not take the extension down with it.
  await copyDocs(args.outdir, args.docsDir).catch((err) => console.error(err.message));
  const options = buildOptions(args);

  const context = await esbuild.context(options);
  await context.watch();
  // esbuild watches the bundled sources; the copied files need their own watcher.
  for (const file of STATIC_FILES) {
    fs.watchFile(path.join(ROOT, file), { interval: 300 }, () => {
      copyStaticFiles(args.outdir);
      console.log(`Copied ${file}`);
    });
  }
  // The documentation pages: rebuilt (debounced) whenever a page or image changes.
  if (fs.existsSync(args.docsDir)) {
    let timer = null;
    fs.watch(args.docsDir, { recursive: true }, () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        copyDocs(args.outdir, args.docsDir).catch((err) => console.error(err.message));
      }, 200);
    });
  }
  console.log(`Watching… extension is in ${args.outdir}`);
}

module.exports = { defineFor, verifyChannel, ENTRY_POINTS, STATIC_FILES };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
