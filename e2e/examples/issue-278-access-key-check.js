// Issue #278: real-browser check of per-user authentication — a companion with
// authentication switched on and two users (created through the real `user add`
// command), the extension without a key (explained by a toast), the key entered
// in Settings ("Save and test" → "Connected as alice."), a configuration saved
// through the UI with the key sent along, and the second user not seeing it.
//
// Runs its own companion on port 5059 with throwaway databases, so neither a
// human's already-running companion nor their real data is ever used or touched.
//
// Usage: node e2e/examples/issue-278-access-key-check.js
const { execFileSync } = require('child_process');
const os = require('os');
const path = require('path');

const stamp = Date.now();
const tmp = (name) => path.join(os.tmpdir(), `sf-e2e-auth-${name}-${stamp}.db`);
Object.assign(process.env, {
  Companion__Auth__Enabled: 'true',
  Companion__UsersDbPath: tmp('users'),
  Companion__SavedConfigsDbPath: tmp('configs'),
  Companion__OutputBlueprintsDbPath: tmp('blueprints'),
  Companion__TransformPresetsDbPath: tmp('presets'),
});

const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

const csproj = path.resolve(__dirname, '../../companion/ScrapingFactory.Companion/ScrapingFactory.Companion.csproj');
const addUser = (name) => {
  const output = execFileSync('dotnet', ['run', '--project', csproj, '--no-launch-profile', '--', 'user', 'add', name], { env: process.env, encoding: 'utf8' });
  const key = output.split('\n').map(l => l.trim()).find(l => l.startsWith('sf_'));
  if (!key) throw new Error(`no key in the output of "user add ${name}":\n${output}`);
  return key;
};

(async () => {
  const aliceKey = addUser('alice');
  const bobKey = addUser('bob');

  const companion = await startCompanion({ port: 5059 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5059 — stop it first.');
  const fixture = await startFixture('speisekarte');
  const browser = await launchBrowser();
  const api = async (key, route) => (await fetch(`http://localhost:5059${route}`, { headers: key ? { Authorization: `Bearer ${key}` } : {} })).json();

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5059' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    // 1) No key yet: the companion is reachable but the extension explains what is missing.
    await popupPage.waitForSelector('#error-toast:not(.hidden)', { timeout: 15000 });
    const toast = await popupPage.locator('#error-toast-message').textContent();
    console.log('Without a key →', toast);
    if (!/access key|Zugangsschl/i.test(toast)) throw new Error('expected the "access key required" toast');

    // 2) Enter alice's key in Settings.
    await popupPage.click('#btn-open-settings');
    await popupPage.fill('#input-access-key', aliceKey);
    await popupPage.click('#btn-access-key-save');
    await popupPage.waitForFunction(() => /alice/.test(document.getElementById('access-key-status')?.textContent || ''));
    const status = await popupPage.locator('#access-key-status').textContent();
    console.log('Settings →', status);
    await popupPage.locator('#settings-access-key-section').screenshot({ path: path.join(__dirname, 'issue-278-access-key.png') });
    await popupPage.click('#btn-close-settings');
    await waitForIdleScreen(popupPage);

    // 3) Save a configuration through the UI — the key travels with the request.
    await popupPage.click('#btn-add-field');
    await fixturePage.click('li.menu-item >> nth=0 >> .item-name');
    await popupPage.waitForSelector('#modal-field-name:not(.hidden)');
    await popupPage.fill('#input-field-name', 'Gericht');
    await popupPage.click('#btn-field-confirm');
    await waitForIdleScreen(popupPage);
    await popupPage.click('#btn-save-config');
    await popupPage.fill('#input-save-config-name', 'Alices Speisekarte');
    await popupPage.click('#btn-save-config-confirm');

    await popupPage.waitForFunction(() => document.querySelector('#saved-configs-list')?.textContent.includes('Alices Speisekarte'), null, { timeout: 15000 });
    console.log('The saved configuration shows up in the panel for alice.');

    // 4) Isolation, checked against the companion directly.
    const alices = await api(aliceKey, '/configs');
    const bobs = await api(bobKey, '/configs');
    const anonymous = await api(null, '/configs');
    console.log('alice sees', alices.map(c => c.name), '| bob sees', bobs.map(c => c.name), '| without a key →', JSON.stringify(anonymous));
    if (alices.length !== 1 || bobs.length !== 0 || !anonymous.error) throw new Error('data was not isolated per user');

    console.log('OK — the key explained, entered and sent; the configuration is alice\'s alone (bob sees none, no key is refused).');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
