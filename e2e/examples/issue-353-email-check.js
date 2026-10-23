// Issue #353: real-browser check of email addresses, verification and password
// reset — a companion with authentication, open registration, SMTP pointing at
// a tiny mail sink started by this script, and "verified email required". The
// extension registers a user with an address, the mailed code is typed in, the
// data endpoints open up once the address is verified, and a forgotten password
// is reset with a second mailed code (the old password stops working).
//
// Runs its own companion on port 5063 with throwaway databases.
//
// Usage: node e2e/examples/issue-353-email-check.js
const net = require('net');
const os = require('os');
const path = require('path');

const stamp = Date.now();
const tmp = (name) => path.join(os.tmpdir(), `sf-e2e-email-${name}-${stamp}.db`);
const MAIL_PORT = 2526;
Object.assign(process.env, {
  Companion__Auth__Enabled: 'true',
  Companion__Auth__Registration: 'Open',
  Companion__Auth__Email__RequireVerified: 'true',
  Companion__Email__Smtp__Host: '127.0.0.1',
  Companion__Email__Smtp__Port: String(MAIL_PORT),
  Companion__Email__Smtp__Security: 'None',
  Companion__Email__Smtp__From: 'noreply@example.com',
  Companion__UsersDbPath: tmp('users'),
  Companion__SavedConfigsDbPath: tmp('configs'),
  Companion__OutputBlueprintsDbPath: tmp('blueprints'),
  Companion__TransformPresetsDbPath: tmp('presets'),
});

const { launchBrowser, openPopup, focusFixture, waitForIdleScreen, startCompanion, startFixture } = require('../harness');

// A minimal SMTP server that just keeps what it is sent.
function startMailSink() {
  const messages = [];
  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let data = '';
    socket.write('220 sink ready\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('latin1');
      let index;
      while ((index = buffer.indexOf('\r\n')) >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        if (inData) {
          if (line === '.') { messages.push(data); data = ''; inData = false; socket.write('250 queued\r\n'); }
          else data += `${line}\n`;
          continue;
        }
        const command = line.split(' ')[0].toUpperCase();
        if (command === 'EHLO') socket.write('250-sink\r\n250 8BITMIME\r\n');
        else if (command === 'DATA') { inData = true; socket.write('354 go\r\n'); }
        else if (command === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => {});
  });
  return new Promise((resolve) => server.listen(MAIL_PORT, '127.0.0.1', () => resolve({
    messages,
    async waitForMessage(count) {
      for (let i = 0; i < 100 && messages.length < count; i++) await new Promise((r) => setTimeout(r, 100));
      if (messages.length < count) throw new Error(`expected ${count} mail(s), got ${messages.length}`);
      return messages[count - 1];
    },
    stop: () => new Promise((r) => server.close(r)),
  })));
}

const codeIn = (message) => {
  const match = message.match(/\b(\d{8})\b/);
  if (!match) throw new Error('no code in the mail');
  return match[1];
};

(async () => {
  const sink = await startMailSink();
  const companion = await startCompanion({ port: 5063 });
  if (companion.alreadyRunning) throw new Error('Something is already listening on port 5063 — stop it first.');
  const fixture = await startFixture('speisekarte');
  const browser = await launchBrowser();
  const storedToken = (page) => page.evaluate(async () => (await chrome.storage.local.get('companionAccessKey')).companionAccessKey);

  try {
    const fixturePage = await browser.context.newPage();
    await fixturePage.goto(fixture.url);
    const popupPage = await openPopup(browser.context, browser.extensionId);
    await popupPage.evaluate(() => chrome.storage.local.set({ companionUrlOverride: 'http://localhost:5063' }));
    await popupPage.reload();
    await focusFixture(fixturePage);
    await waitForIdleScreen(popupPage);

    const health = await (await fetch('http://localhost:5063/health')).json();
    if (health.email !== 'optional' || !health.passwordReset || !health.verifiedEmailRequired) throw new Error(`unexpected /health: ${JSON.stringify(health)}`);

    // 1) Register with an email address: the field is offered, a code is mailed.
    await popupPage.click('#btn-open-settings');
    await popupPage.waitForSelector('#settings-account-section:not(.hidden)');
    await popupPage.waitForSelector('#account-email-row:not(.hidden)');
    await popupPage.fill('#input-account-name', 'dora');
    await popupPage.fill('#input-account-password', 'first password 1');
    await popupPage.fill('#input-account-password-repeat', 'first password 1');
    await popupPage.fill('#input-account-email', 'dora@example.com');
    await popupPage.click('#btn-account-register');
    await popupPage.waitForSelector('#account-signed-in:not(.hidden)');
    const verification = await sink.waitForMessage(1);
    if (!/To: dora@example.com/i.test(verification)) throw new Error('the code went to the wrong address');
    console.log('Registered →', await popupPage.locator('#account-status').textContent());
    await popupPage.locator('#settings-account-section').screenshot({ path: path.join(__dirname, 'issue-353-verify.png') });

    // 2) "Verified email required": the data is closed until the code is entered.
    const token = await storedToken(popupPage);
    const blocked = await fetch('http://localhost:5063/configs', { headers: { Authorization: `Bearer ${token}` } });
    if (blocked.status !== 403 || (await blocked.json()).code !== 'email_unverified') throw new Error('data should be refused before verification');

    // 3) A wrong code is explained, the right one opens everything up.
    await popupPage.fill('#input-account-verify-code', '00000000');
    await popupPage.click('#btn-account-verify');
    await popupPage.waitForFunction(() => /wrong/i.test(document.getElementById('account-status').textContent));
    await popupPage.fill('#input-account-verify-code', codeIn(verification));
    await popupPage.click('#btn-account-verify');
    await popupPage.waitForSelector('#account-verify-row.hidden', { state: 'attached' });
    const opened = await fetch('http://localhost:5063/configs', { headers: { Authorization: `Bearer ${token}` } });
    if (opened.status !== 200) throw new Error(`data should be open after verification, got ${opened.status}`);
    console.log('Verified →', await popupPage.locator('#account-email-state').textContent());

    // 4) Forgot password: sign out, ask for a code, reset.
    await popupPage.click('#btn-account-logout');
    await popupPage.waitForSelector('#account-signed-out:not(.hidden)');
    await popupPage.click('#btn-account-forgot');
    await popupPage.fill('#input-account-forgot-account', 'dora@example.com');
    await popupPage.click('#btn-account-forgot-send');
    const reset = await sink.waitForMessage(2);
    if (!/password reset/i.test(reset)) throw new Error('the second mail should be the reset code');
    // A wrong code gets the generic message and does not reset anything.
    await popupPage.fill('#input-account-reset-code', '00000000');
    await popupPage.fill('#input-account-reset-password', 'second password 2');
    await popupPage.click('#btn-account-reset-confirm');
    await popupPage.waitForFunction(() => /wrong or has expired/i.test(document.getElementById('account-status').textContent));
    await popupPage.fill('#input-account-reset-code', codeIn(reset));
    await popupPage.click('#btn-account-reset-confirm');
    await popupPage.waitForFunction(() => document.getElementById('account-forgot-panel').classList.contains('hidden'));
    console.log('Reset →', await popupPage.locator('#account-status').textContent());

    // 5) The old password is gone, the new one works.
    const login = (password) => fetch('http://localhost:5063/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'dora', password }),
    });
    if ((await login('first password 1')).status !== 401) throw new Error('the old password must stop working');
    await popupPage.fill('#input-account-name', 'dora');
    await popupPage.fill('#input-account-password', 'second password 2');
    await popupPage.click('#btn-account-login');
    await popupPage.waitForSelector('#account-signed-in:not(.hidden)');
    console.log('Signed in with the new password.');

    // 6) The mailed code can't be used twice.
    const again = await fetch('http://localhost:5063/auth/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: 'dora', code: codeIn(reset), newPassword: 'third password 3' }),
    });
    if (again.status !== 400) throw new Error('a reset code must be single-use');

    console.log('OK — registered with an address, data closed until the code was entered, forgotten password reset by mailed code, old password and used code dead.');
  } finally {
    await browser.close();
    await fixture.stop();
    await companion.stop();
    await sink.stop();
  }
})().catch((err) => {
  console.error('CHECK FAILED:', err.message);
  process.exit(1);
});
