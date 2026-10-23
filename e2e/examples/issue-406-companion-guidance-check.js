// Issue #406: real-browser check of the guidance on the "Companion app
// unreachable" screen. No companion is running for most of it:
//   - first run (flag unset): the long explanation — what the companion is, the
//     three situations with this OS's installer command and program path — with
//     the right situation marked "Most likely" (a custom address → situation 3;
//     the default address → 1 and 2, only checked when nothing is listening on
//     :5000 on this machine);
//   - the "Why can't it connect?" popover opens with mouse and keyboard and lists
//     the four causes;
//   - the custom-address flow still works: pointing at a freshly started companion
//     reaches the idle screen, which records that a companion has answered;
//   - afterwards (companion gone again) only the one-line hint is shown;
//   - the long form in German and Spanish;
//   - side-panel widths 280/320/400 px: no horizontal overflow added by the screen
//     (screenshots next to this file).
//
// Runs its own companion only for the "reached" step, on port 5057.
//
// Usage: node e2e/examples/issue-406-companion-guidance-check.js
const path = require('path');
const { launchBrowser, openPopup, startCompanion } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const UNUSED = 'http://localhost:5999';

(async () => {
  const defaultPortFree = await fetch('http://localhost:5000/health').then(() => false).catch(() => true);
  const browser = await launchBrowser();
  let companion = null;

  try {
    const popup = await openPopup(browser.context, browser.extensionId);
    const setStorage = (values, remove = []) => popup.evaluate(async ({ values, remove }) => {
      await chrome.storage.session.clear();
      if (remove.length) await chrome.storage.local.remove(remove);
      await chrome.storage.local.set(values);
    }, { values, remove });
    const openErrorScreen = async (values, remove = ['companionReached', 'companionUrlOverride']) => {
      await setStorage(values, remove);
      await popup.reload();
      await popup.waitForSelector('#screen-error:not(.hidden)', { timeout: 15000 });
    };
    const text = (selector) => popup.locator(selector).textContent();
    const visible = (selector) => popup.locator(selector).isVisible();
    const likely = () => popup.$$eval('.error-situation', (els) => els.filter((e) => e.classList.contains('likely')).map((e) => e.id.replace('error-situation-', '')));

    // 1) First run, custom address that nothing listens on → long form, "address" most likely.
    await openErrorScreen({ language: 'en', companionUrlOverride: UNUSED });
    assert(await visible('#error-guidance-long'), 'the long explanation should show on the first run');
    assert(!(await visible('#error-hint-short')), 'the short hint should be hidden on the first run');
    assert(/small helper program on your computer/.test(await text('.error-intro')), 'missing the "what is the companion" explanation');
    const titles = await popup.$$eval('.error-situation h3 > span:first-child', (els) => els.map((e) => e.textContent));
    assert(titles.length === 3 && /Not installed yet/.test(titles[0]) && /not running/.test(titles[1]) && /another address or port/.test(titles[2]), `unexpected situations: ${titles}`);
    // Playwright's Chromium on this machine: the Linux instructions, unless it is macOS/Windows.
    const platform = await popup.evaluate(() => (/Windows/.test(navigator.userAgent) ? 'windows' : /Macintosh/.test(navigator.userAgent) ? 'mac' : 'linux'));
    const expectedCommand = platform === 'windows' ? 'powershell -ExecutionPolicy Bypass -File .\\install.ps1 -Autostart' : './install.sh --autostart';
    assert(await text('#error-install-command') === expectedCommand, `unexpected install command: ${await text('#error-install-command')}`);
    assert((await text('#error-install-text')).includes(platform === 'windows' ? 'install.ps1' : 'install.sh'), 'the installer name is missing from the text');
    assert(/ScrapingFactory\/app\/companion\/ScrapingFactory\.Companion/.test((await text('#error-start-path')).replace(/\\/g, '/')), `unexpected program path: ${await text('#error-start-path')}`);
    assert(JSON.stringify(await likely()) === '["address"]', `custom address should mark situation 3, got ${JSON.stringify(await likely())}`);
    assert(/Address tried: http:\/\/localhost:5999/.test(await text('#error-current-url')), 'the tried address should still be shown');
    console.log(`first run, custom address: long form, ${platform} instructions, "address" marked`);

    // 2) Default address (only when nothing runs on :5000 here).
    if (defaultPortFree) {
      await openErrorScreen({ language: 'en' });
      assert(JSON.stringify(await likely()) === '["install","start"]', `default address should mark situations 1+2, got ${JSON.stringify(await likely())}`);
      console.log('first run, default address: "not installed" and "not running" marked');
    } else {
      console.log('(a companion answers on :5000 here — skipping the default-address case)');
      await openErrorScreen({ language: 'en', companionUrlOverride: UNUSED });
    }

    // 3) The popover: mouse, then keyboard; four causes.
    const why = popup.locator('.error-why .help-btn');
    await why.click();
    const panel = popup.locator(`#${await why.getAttribute('aria-controls')}`);
    assert(await panel.isVisible(), 'the popover should open on click');
    const lines = (await panel.locator('.help-popover-text').textContent()).split('\n');
    assert(lines.length === 4 && /Not started/.test(lines[0]) && /https:\/\//.test(lines[2]) && /access key/.test(lines[3]), `unexpected causes: ${JSON.stringify(lines)}`);
    const rendered = await panel.locator('.help-popover-text').evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
    assert(rendered >= 3.9, `the four causes should render on separate lines (about ${rendered.toFixed(1)} line heights tall)`);
    await popup.keyboard.press('Escape');
    assert(!(await panel.isVisible()), 'Escape should close the popover');
    await why.focus();
    await popup.keyboard.press('Enter');
    assert(await panel.isVisible(), 'Enter should open the popover');
    await popup.keyboard.press('Escape');
    console.log('popover: mouse + keyboard, four causes on separate lines');

    // 4) Side-panel widths.
    for (const width of [280, 320, 400]) {
      await popup.setViewportSize({ width, height: 1000 });
      await why.click();
      const overflow = await popup.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      console.log(`width ${width}px: horizontal overflow ${overflow}px`);
      assert(overflow <= (width === 280 ? 44 : width === 320 ? 4 : 0), `the error screen adds horizontal scrolling at ${width}px (${overflow}px)`);
      await popup.screenshot({ path: path.join(__dirname, `issue-406-companion-guidance-${width}.png`), fullPage: true });
      await popup.keyboard.press('Escape');
    }
    await popup.setViewportSize({ width: 420, height: 1000 });

    // 5) German and Spanish long forms.
    for (const [language, intro, install] of [['de', /kleines Hilfsprogramm/, /Entpacke den Scraping-Factory-Download/], ['es', /pequeño programa auxiliar/, /Descomprime la descarga/]]) {
      await openErrorScreen({ language, companionUrlOverride: UNUSED });
      assert(intro.test(await text('.error-intro')), `${language}: intro text missing`);
      assert(install.test(await text('#error-install-text')), `${language}: install text missing`);
      await popup.locator('.error-why .help-btn').click();
      assert(await popup.locator('.help-popover:not(.hidden)').count() === 1, `${language}: popover did not open`);
    }
    console.log('german and spanish long forms ok');

    // 6) The custom-address flow still works, and reaching a companion ends the first-run state.
    companion = await startCompanion({ port: 5057 });
    if (companion.alreadyRunning) throw new Error('Something is already listening on port 5057 — stop it first.');
    await openErrorScreen({ language: 'en', companionUrlOverride: UNUSED });
    await popup.fill('#input-companion-url', 'http://localhost:5057');
    await popup.click('#btn-use-companion-url');
    await popup.waitForSelector('#screen-idle:not(.hidden)', { timeout: 20000 });
    const reached = await popup.evaluate(() => chrome.storage.local.get('companionReached'));
    assert(reached.companionReached === true, 'reaching the companion should record the flag');
    console.log('custom address -> idle screen; first-run flag recorded');

    // 7) Companion gone again → short form only.
    await companion.stop();
    companion = null;
    await popup.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5999' }));
    await popup.reload();
    await popup.waitForSelector('#screen-error:not(.hidden)', { timeout: 15000 });
    assert(!(await visible('#error-guidance-long')), 'the long explanation should be gone once a companion has answered');
    assert(await visible('#error-hint-short'), 'the one-line hint should show');
    assert(/Start the companion app and try again/.test(await text('#error-hint-short')), 'unexpected short hint');
    assert(await visible('.error-why .help-btn'), 'the "Why can\'t it connect?" popover should stay available');
    await popup.screenshot({ path: path.join(__dirname, 'issue-406-companion-guidance-short.png'), fullPage: true });
    console.log('returning user: short form + popover');

    console.log('OK — long first-run guidance with the likely cause marked, popover, custom-address flow, short form afterwards.');
  } finally {
    await browser.close();
    if (companion) await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
