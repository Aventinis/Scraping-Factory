// Issue #352: real-browser check of self-service accounts — a companion with
// authentication on and registration open (loopback, plain HTTP; the HTTPS
// rules themselves are covered by the companion's tests and the bundle check),
// the extension registering a user from Settings → Account, saving a
// configuration under that account, signing out (the data disappears and the
// token is gone), signing in again (it is back), a wrong password (one generic
// message), and the address rule: plain http:// to another machine is refused
// in the address field of the error screen.
//
// Runs its own companion on port 5062 with throwaway databases.
//
// Usage: node e2e/examples/issue-352-accounts-check.js
const os = require('os');
const path = require('path');

const stamp = Date.now();
const tmp = (name) => path.join(os.tmpdir(), `sf-e2e-accounts-${name}-${stamp}.db`);
Object.assign(process.env, {
  Companion__Auth__Enabled: 'true',
  Companion__Auth__Registration: 'Open',
  Companion__UsersDbPath: tmp('users'),
  Companion__SavedConfigsDbPath: tmp('configs'),
  Companion__OutputBlueprintsDbPath: tmp('blueprints'),
  Companion__TransformPresetsDbPath: tmp('presets'),
});

const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

const PASSWORD = 'correct horse battery';

(async () => {
  const companion = await startCompanion({ port: 5062 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5062 — stop it first.');
  const fixture = await startFixture('speisekarte');
  const browser = await launchBrowser();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5062' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    const health = await (await fetch('http://localhost:5062/health')).json();
    if (!health.authRequired || !health.registration) throw new Error(`unexpected /health: ${JSON.stringify(health)}`);

    // 1) Settings → Account is offered, with Register.
    await popupPage.click('#btn-open-settings');
    await popupPage.waitForSelector('#settings-account-section:not(.hidden)');
    if (await popupPage.locator('#btn-account-register.hidden').count()) throw new Error('Register should be offered');

    // 2) A too-short password is explained (the companion's own policy text), nothing is stored.
    await popupPage.fill('#input-account-name', 'carol');
    await popupPage.fill('#input-account-password', 'short');
    await popupPage.fill('#input-account-password-repeat', 'short');
    await popupPage.click('#btn-account-register');
    await popupPage.waitForSelector('#account-status:not(.hidden)');
    console.log('Short password →', await popupPage.locator('#account-status').textContent());
    if (await popupPage.evaluate(async () => (await chrome.storage.local.get('companionAccessKey')).companionAccessKey)) throw new Error('no token may be stored');

    // 3) A proper password registers and signs in.
    await popupPage.fill('#input-account-password', PASSWORD);
    await popupPage.fill('#input-account-password-repeat', PASSWORD);
    await popupPage.click('#btn-account-register');
    await popupPage.waitForSelector('#account-signed-in:not(.hidden)');
    console.log('Signed in →', await popupPage.locator('#account-signed-in-as').textContent());
    await popupPage.locator('#settings-account-section').screenshot({ path: path.join(__dirname, 'issue-352-accounts.png') });
    const token = await popupPage.evaluate(async () => (await chrome.storage.local.get('companionAccessKey')).companionAccessKey);
    if (!token || !token.startsWith('sf_')) throw new Error('a token should be stored');
    if (await popupPage.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null))).then((s) => s.includes(PASSWORD))) throw new Error('the password must never be stored');

    // 4) A configuration saved under this account.
    await popupPage.click('#btn-close-settings');
    await waitForIdleScreen(popupPage);
    await popupPage.click('#btn-add-field');
    await fixturePage.click('li.menu-item >> nth=0 >> .item-name');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Gericht');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);
    await popupPage.click('#btn-save-config');
    await popupPage.fill('#input-save-config-name', 'Carols Speisekarte');
    await popupPage.click('#btn-save-config-confirm');
    await popupPage.waitForFunction(() => document.querySelector('#saved-configs-list')?.textContent.includes('Carols Speisekarte'), null, { timeout: 15000 });

    // 5) Sign out: token forgotten here AND revoked on the companion.
    await popupPage.click('#btn-open-settings');
    await popupPage.click('#btn-account-logout');
    await popupPage.waitForSelector('#account-signed-out:not(.hidden)');
    if (await popupPage.evaluate(async () => (await chrome.storage.local.get('companionAccessKey')).companionAccessKey)) throw new Error('the token should be gone');
    const revoked = await fetch('http://localhost:5062/configs', { headers: { Authorization: `Bearer ${token}` } });
    if (revoked.status !== 401) throw new Error(`the old token should be revoked, got HTTP ${revoked.status}`);

    // 6) A wrong password: one generic message, whichever part was wrong.
    await popupPage.fill('#input-account-name', 'carol');
    await popupPage.fill('#input-account-password', 'wrong password here');
    await popupPage.click('#btn-account-login');
    await popupPage.waitForSelector('#account-status:not(.hidden)');
    const messageForWrongCredentials = await popupPage.locator('#account-status').textContent();
    await popupPage.fill('#input-account-name', 'nobody-by-that-name');
    await popupPage.click('#btn-account-login');
    await popupPage.waitForFunction((previous) => document.getElementById('account-status').textContent !== '' , null);
    const messageForUnknownUser = await popupPage.locator('#account-status').textContent();
    if (messageForWrongCredentials !== messageForUnknownUser) throw new Error('the two failures must look the same');
    console.log('Wrong password and unknown name show the same message.');

    // 7) The right password brings the account — and its data — back.
    await popupPage.fill('#input-account-name', 'carol');
    await popupPage.fill('#input-account-password', PASSWORD);
    await popupPage.click('#btn-account-login');
    await popupPage.waitForSelector('#account-signed-in:not(.hidden)');
    await popupPage.click('#btn-close-settings');
    await waitForIdleScreen(popupPage);
    await popupPage.waitForFunction(() => document.querySelector('#saved-configs-list')?.textContent.includes('Carols Speisekarte'), null, { timeout: 15000 });
    console.log('After signing in again the saved configuration is back.');

    // 8) Developer options exist in this (development) build.
    await popupPage.click('#btn-open-settings');
    if (!(await popupPage.locator('#settings-developer-section').count())) throw new Error('development build should show Developer options');

    // 9) The address rule: plain http to another machine is refused.
    await popupPage.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5999' }));
    await popupPage.reload();
    await popupPage.waitForSelector('#input-companion-url', { state: 'visible', timeout: 20000 });
    await popupPage.fill('#input-companion-url', 'http://192.168.1.5:5000');
    await popupPage.click('#btn-use-companion-url');
    await popupPage.waitForSelector('#error-toast:not(.hidden)');
    const refusal = await popupPage.locator('#error-toast-message').textContent();
    console.log('Plain http to another machine →', refusal);
    if (!/https/i.test(refusal)) throw new Error('expected the "use https" refusal');
    const stillStored = await popupPage.evaluate(async () => (await chrome.storage.local.get('companionUrlOverride')).companionUrlOverride);
    if (stillStored !== 'http://localhost:5999') throw new Error('the refused address must not be stored');

    console.log('OK — registered, saved, signed out (token revoked), generic login error, signed in again, address rule enforced.');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
