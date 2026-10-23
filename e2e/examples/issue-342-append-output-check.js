// Issue #342: real-browser check of "Append to the existing output file".
// Flat mode on the dedup-listing fixture (a handful of job rows), the option ticked in
// the Settings section; the generated script is downloaded and then run for
// real, three times, in one scratch directory — the one thing the companion's
// always-fresh trial run can never exercise:
//   1) without the option every run replaces output.csv,
//   2) with it, the first run creates the file and the second and third
//      append: still one header, three times the rows in total.
//
// Runs its own companion on port 5059, so a companion a human already has
// running on the default port is never used or touched.
//
// Usage: node e2e/examples/issue-342-append-output-check.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

const runScript = (dir, scriptPath) => {
  for (const python of ['python3', 'python']) {
    try {
      return execFileSync(python, [scriptPath], { cwd: dir, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
  }
  throw new Error('No Python interpreter found.');
};

(async () => {
  const companion = await startCompanion({ port: 5059 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5059 — stop it first.');
  const fixture = await startFixture('dedup-listing');
  const browser = await launchBrowser();
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-e2e-append-'));

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5059' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    await popupPage.click('#btn-add-field');
    await fixturePage.click('li.job >> nth=0 >> .title');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Titel');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);

    const downloadScript = async (name) => {
      await focusFixture(fixturePage);
      await popupPage.click('#btn-generate');
      await popupPage.waitForSelector('#screen-done:not(.hidden)', { timeout: 90000 });
      const [download] = await Promise.all([popupPage.waitForEvent('download'), popupPage.click('#btn-download')]);
      const target = path.join(scratch, name);
      await download.saveAs(target);
      await popupPage.click('#btn-back-to-config');
      await waitForIdleScreen(popupPage);
      return target;
    };

    // Without the option first: every run replaces the file.
    const replacing = await downloadScript('replace.py');
    const replaceDir = fs.mkdtempSync(path.join(scratch, 'replace-'));
    runScript(replaceDir, replacing);
    runScript(replaceDir, replacing);
    const replaced = fs.readFileSync(path.join(replaceDir, 'output.csv'), 'utf-8').trim().split(/\r?\n/);
    const rowsPerRun = replaced.length - 1;
    console.log('Without the option, rows after two runs:', rowsPerRun);
    if (rowsPerRun < 2) throw new Error(`Expected several rows per run, got ${rowsPerRun}`);
    if (replaced.filter(l => l === 'Titel').length !== 1) throw new Error('The header must appear exactly once');

    // With the option: the file accumulates.
    await popupPage.click('#settings-section-toggle');
    await popupPage.check('#toggle-append-output');
    await popupPage.locator('#toggle-append-output').screenshot({ path: path.join(__dirname, 'issue-342-append-output.png') });
    const appending = await downloadScript('append.py');
    const appendDir = fs.mkdtempSync(path.join(scratch, 'append-'));
    const csv = () => fs.readFileSync(path.join(appendDir, 'output.csv'), 'utf-8').trim().split(/\r?\n/);
    runScript(appendDir, appending);
    console.log('After run 1:', csv().length - 1, 'rows');
    if (csv().length !== rowsPerRun + 1) throw new Error('The first run should create the file with one run\'s rows');
    runScript(appendDir, appending);
    const out = runScript(appendDir, appending);
    const lines = csv();
    console.log('After run 3:', lines.length - 1, 'rows —', out.trim());
    if (lines.length !== 3 * rowsPerRun + 1) throw new Error(`Expected header + ${3 * rowsPerRun} rows after three appending runs, got ${lines.length} lines`);
    if (lines.filter(l => l === 'Titel').length !== 1) throw new Error('The header must appear exactly once');
    if (!out.includes('appended to')) throw new Error('The script should say it appended');

    console.log(`OK — three runs accumulated ${3 * rowsPerRun} rows with one header; without the option the file was replaced each time.`);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
