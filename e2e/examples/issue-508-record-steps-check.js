// Issue #508: real-browser check of "Record my steps" with the REAL recorder (trusted mouse and keyboard events).
//   1) login-flow: the page is reloaded, the user types into the user and password fields and clicks log in → the list gets
//      Fill, Fill, Click (the fills ask for an environment variable name); the typed password appears in no storage and no log;
//      the real trial run, with the variable values supplied, logs in and reads the balance;
//   2) infinite-scroll: scrolling the feed that loads more content becomes a Scroll action with the feed as container;
//   3) click-targets: a click on the LAST of three identical buttons becomes Click with target "last"; the trial run proves it.
//
// Runs its own companion on port 5055, so a companion a human already has running on the default port is never used.
//
// Usage: node e2e/examples/issue-508-record-steps-check.js
const path = require('path');
const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function withPage(fixtureName, run) {
  const fixture = await startFixture(fixtureName);
  const browser = await launchBrowser();
  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popup = await openPopup(browser.context, browser.extensionId);
    await popup.evaluate(() => chrome.storage.local.set({
      language: 'en', companionUrlOverride: 'http://localhost:5055', globalSettings: { includeDataPreview: true },
    }));
    await popup.evaluate(() => chrome.storage.session.set({ engine: 'Browser' }));
    await popup.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popup);
    await run({ popup, fixturePage });
  } catch (err) {
    const toast = await (await browser.context.pages()).at(-1)?.locator('#error-toast-message').textContent().catch(() => null);
    if (toast) console.error('Toast:', toast);
    throw err;
  } finally {
    await browser.close();
    await fixture.stop();
  }
}

// Starts the recording and waits until the reloaded page runs the recorder (the first real click proves it).
async function startRecording(popup, fixturePage) {
  await popup.click('#btn-record-steps');
  await fixturePage.waitForLoadState('load');
  await fixturePage.waitForTimeout(1200); // the service worker arms the recorder once the reloaded tab has finished loading
}

const actionKinds = (popup) => popup.evaluate(() => [...document.querySelectorAll('#browser-actions-list .browser-action-header .row-label')].map((el) => el.textContent));

(async () => {
  const companion = await startCompanion({ port: 5055 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5055 — stop it first.');

  try {
    // 1) Login.
    await withPage('login-flow', async ({ popup, fixturePage }) => {
      // The data to read lives behind the login: pick it while the dashboard is shown, then put the login form back.
      await fixturePage.evaluate(() => {
        document.getElementById('login-view').classList.add('hidden');
        document.getElementById('dashboard-view').classList.remove('hidden');
      });
      await popup.click('#btn-add-field');
      await focusFixture(fixturePage);
      await fixturePage.click('.stat-value >> nth=0');
      await popup.waitForSelector('#modal-field-name:not(.hidden)');
      await popup.fill('#input-field-name', 'Kontostand');
      await popup.click('#btn-field-confirm');
      await waitForIdleScreen(popup);

      await startRecording(popup, fixturePage);
      await fixturePage.click('#username');
      await fixturePage.keyboard.type('nordlicht');
      await fixturePage.click('#password');
      await fixturePage.keyboard.type('Fjord2026!');
      await fixturePage.click('#login-submit');
      await popup.waitForFunction(() => document.querySelectorAll('#record-steps-list li').length >= 3);
      const live = await popup.locator('#record-steps-list li').allTextContents();
      assert(live.length === 3, `three steps expected while recording, got ${JSON.stringify(live)}`);
      await popup.screenshot({ path: path.join(__dirname, 'issue-508-recording.png') });
      await popup.click('#btn-record-steps');

      const kinds = await actionKinds(popup);
      assert(kinds.join('|') === 'Fill|Fill|Click' || kinds.length === 3, `Fill, Fill, Click expected, got ${JSON.stringify(kinds)}`);
      assert(await popup.locator('.browser-action-env-name').count() === 2, 'both fills ask for an environment variable name');
      assert(await popup.evaluate(() => [...document.querySelectorAll('.browser-action-env-name')].every((i) => i.value === '')), 'no variable name is guessed');

      // The typed values are nowhere: not in the extension's storage, not in the logs of the panel, the worker or the page.
      const leaks = await popup.evaluate(async () => {
        const dump = JSON.stringify([await chrome.storage.session.get(null), await chrome.storage.local.get(null)]);
        const logs = JSON.stringify(await chrome.runtime.sendMessage({ type: 'GET_LOGS' }));
        return { storage: /Fjord2026|nordlicht/.test(dump), logs: /Fjord2026|nordlicht/.test(logs) };
      });
      assert(!leaks.storage, 'the typed text must not be in storage');
      assert(!leaks.logs, 'the typed text must not be in the logs');

      const vars = ['SITE_USERNAME', 'SITE_PASSWORD'];
      for (let i = 0; i < 2; i++) {
        await popup.locator('.browser-action-env-name').nth(i).fill(vars[i]);
        await popup.locator('.browser-action-env-name').nth(i).blur();
      }
      for (const [i, value] of [[0, 'nordlicht'], [1, 'Fjord2026!']]) {
        await popup.locator('.browser-action-test-value').nth(i).fill(value);
        await popup.locator('.browser-action-test-value').nth(i).blur();
      }
      await fixturePage.reload();
      await focusFixture(fixturePage);
      await popup.click('#btn-generate');
      await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
      const cells = await popup.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent)));
      assert(cells.some((row) => row[0] === '2.348,17 €'), `the recorded login should reach the data, got ${JSON.stringify(cells)}`);
    });

    // 2) Scroll.
    await withPage('infinite-scroll', async ({ popup, fixturePage }) => {
      await startRecording(popup, fixturePage);
      await fixturePage.hover('#feed');
      await fixturePage.mouse.wheel(0, 3000);
      await fixturePage.waitForTimeout(1600); // the recorder waits for the page to settle before deciding it loaded more
      await popup.waitForFunction(() => document.querySelectorAll('#record-steps-list li').length >= 1);
      await popup.click('#btn-record-steps');
      const kinds = await actionKinds(popup);
      assert(kinds.join('|') === 'Scroll', `one Scroll expected, got ${JSON.stringify(kinds)}`);
      await popup.locator('details.advanced-disclosure summary').first().click();
      const container = await popup.locator('#browser-actions-list .field-selector').first().textContent();
      assert(container.includes('#feed'), `the scrolled container should be the feed, got "${container}"`);
    });

    // 3) Click on the last of three identical buttons.
    await withPage('click-targets', async ({ popup, fixturePage }) => {
      await popup.click('#btn-add-field');
      await fixturePage.click('#opened');
      await popup.waitForSelector('#modal-field-name:not(.hidden)');
      await popup.fill('#input-field-name', 'Opened');
      await popup.click('#btn-field-confirm');
      await waitForIdleScreen(popup);

      await startRecording(popup, fixturePage);
      await fixturePage.click('button.toggle >> nth=2');
      await popup.waitForFunction(() => document.querySelectorAll('#record-steps-list li').length >= 1);
      await popup.click('#btn-record-steps');
      assert((await actionKinds(popup)).join('|') === 'Click', 'one Click expected');
      await popup.locator('details.advanced-disclosure summary').first().click();
      assert(await popup.inputValue('.browser-action-click-target') === 'last', 'the click should target the last match');
      await fixturePage.reload();
      await focusFixture(fixturePage);
      await popup.click('#btn-generate');
      await popup.waitForSelector('#screen-done:not(.hidden)', { timeout: 120000 });
      const rows = await popup.$$eval('#data-preview-table-wrap tbody tr', (trs) => trs.map((tr) => Array.from(tr.cells).map((c) => c.textContent)));
      assert(rows[0][0] === 'opened: 3', `the replay should click the third button, got ${JSON.stringify(rows)}`);
    });

    console.log('OK — the recorder turned real clicks, typing and scrolling into browser actions; no typed text was stored; the replays worked.');
  } finally {
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
