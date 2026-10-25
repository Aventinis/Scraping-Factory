// Issue #354: regenerates the screenshots used by docs/user/ from the real,
// unpacked extension running against the test-pages/ fixtures — so a UI
// change doesn't leave stale images behind; just rerun this.
//
// Manual/on-demand (like the rest of e2e/), not part of CI.
//
// Usage:
//   node e2e/screenshots/run.js                  # every scenario
//   node e2e/screenshots/run.js --only modes     # scenarios whose id contains "modes"
//   node e2e/screenshots/run.js --theme dark     # same scenarios, dark theme
//   node e2e/screenshots/run.js --language de    # the German UI, written to docs/user/de/images/
//   node e2e/screenshots/run.js --list           # print scenario ids and exit
//
// Runs its own companion on port 5056 (never touches one a human already has
// on the default port) and writes docs/user/images/*.png (docs/user/de/images/ with --language de).
const os = require('os');
const path = require('path');
const fs = require('fs');
const { launchBrowser, startCompanion, startFixture } = require('../harness');
const { openScenario } = require('./lib');

const SCENARIO_FILES = ['getting-started', 'modes', 'pagination', 'transforms', 'monitoring', 'network', 'output', 'browser-engine', 'troubleshooting'];
const COMPANION_PORT = 5056;
// The images are what this script makes: the extension build that precedes it must not fail on one that is still missing.
process.env.SF_DOCS_ALLOW_MISSING_IMAGES = '1';

function parseArgs(argv) {
  const args = { only: null, theme: 'light', language: 'en', list: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--only') args.only = argv[++i];
    else if (argv[i] === '--theme') args.theme = argv[++i];
    else if (argv[i] === '--language') args.language = argv[++i];
    else if (argv[i] === '--list') args.list = true;
    else throw new Error(`Unknown argument "${argv[i]}"`);
  }
  if (!['light', 'dark'].includes(args.theme)) throw new Error('--theme must be "light" or "dark"');
  if (!['en', 'de'].includes(args.language)) throw new Error('--language must be "en" or "de"');
  return args;
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const scenarios = SCENARIO_FILES.flatMap((f) => require(`./scenarios/${f}`));
  const selected = scenarios.filter((s) => !args.only || s.id.includes(args.only));

  if (args.list) {
    scenarios.forEach((s) => console.log(`${s.id}  (fixture: ${s.fixture})`));
    return;
  }
  if (selected.length === 0) throw new Error(`No scenario matches "${args.only}". Use --list.`);

  // Isolated stores: without this the companion would read (and could write)
  // the developer's own saved configurations, blueprints and presets, and they
  // would end up in the screenshots.
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-screenshots-data-'));
  process.env.Companion__SavedConfigsDbPath = path.join(dataDir, 'saved-configs.db');
  process.env.Companion__OutputBlueprintsDbPath = path.join(dataDir, 'output-blueprints.db');
  process.env.Companion__TransformPresetsDbPath = path.join(dataDir, 'transform-presets.db');
  process.env.Companion__UsersDbPath = path.join(dataDir, 'users.db');

  const companion = await startCompanion({ port: COMPANION_PORT });
  if (companion.alreadyRunning) throw new Error(`Something is already listening on port ${COMPANION_PORT} — stop it first.`);
  const browser = await launchBrowser();
  const fixtures = new Map();
  const ctx = {
    browser,
    companionPort: COMPANION_PORT,
    written: [],
    async fixture(name) {
      if (!fixtures.has(name)) fixtures.set(name, await startFixture(name));
      return fixtures.get(name);
    },
  };

  let failed = 0;
  try {
    for (const scenario of selected) {
      process.stdout.write(`${scenario.id} ... `);
      const session = await openScenario(ctx, {
        fixture: scenario.fixture,
        companionUrl: scenario.companionUrl,
        theme: args.theme,
        language: args.language,
      });
      try {
        await scenario.run(session);
        console.log('ok');
      } catch (err) {
        failed++;
        console.log(`FAILED: ${err.message}`);
        const toast = await session.popupPage.locator('#error-toast-message').textContent().catch(() => null);
        if (toast) console.log(`  (toast: ${toast})`);
        // A picture of where it got stuck beats guessing from the message.
        const debugFile = path.join(os.tmpdir(), `sf-screenshot-failed-${scenario.id}.png`);
        await session.popupPage.screenshot({ path: debugFile }).then(() => console.log(`  (popup state: ${debugFile})`)).catch(() => {});
      } finally {
        await session.close();
      }
    }
  } finally {
    await browser.close();
    for (const f of fixtures.values()) await f.stop();
    await companion.stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  console.log(`\nWrote ${ctx.written.length} image(s):`);
  ctx.written.forEach((p) => console.log(`  ${p}`));
  if (failed) {
    console.error(`${failed} scenario(s) failed.`);
    process.exit(1);
  }
})().catch((err) => {
  console.error('SCREENSHOT RUN FAILED:', err.message);
  process.exit(1);
});
