Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

// Issue #353: the email parts of the Account section — the address at
// registration, verifying it with the mailed code, changing it, and "Forgot
// password?". Texts are compared with the English dictionary's own strings.
const en = require('../i18n/en.json');
// An English string by key, with {placeholders} filled in.
const tx = (key, params = {}) => key.split('.').reduce((node, part) => node[part], en)
  .replace(/\{(\w+)\}/g, (_, name) => params[name]);

const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

const html = `
  <div id="header-bar"><button id="btn-open-settings"></button></div>
  <section id="screen-idle" class="hidden">
    <div id="url-display"></div><div id="fields-list"></div><button id="btn-generate" disabled></button>
  </section>
  <section id="screen-generating" class="hidden"></section>
  <section id="screen-settings" class="hidden">
    <button id="btn-close-settings"></button>
    <div id="settings-account-section" class="hidden">
      <div id="account-signed-out">
        <input type="text" id="input-account-name" />
        <input type="password" id="input-account-password" />
        <div id="account-repeat-row" class="hidden"><input type="password" id="input-account-password-repeat" /></div>
        <div id="account-email-row" class="hidden"><label id="label-account-email"></label><input type="email" id="input-account-email" /></div>
        <button id="btn-account-login"></button><button id="btn-account-register" class="hidden"></button>
        <button id="btn-account-forgot" class="hidden"></button>
        <p id="account-no-registration" class="hidden"></p>
        <div id="account-forgot-panel" class="hidden">
          <input type="text" id="input-account-forgot-account" /><button id="btn-account-forgot-send"></button>
          <input type="text" id="input-account-reset-code" /><input type="password" id="input-account-reset-password" />
          <button id="btn-account-reset-confirm"></button>
        </div>
      </div>
      <div id="account-signed-in" class="hidden">
        <p id="account-signed-in-as"></p>
        <div id="account-email-section" class="hidden">
          <p id="account-email-state"></p>
          <div id="account-verify-row" class="hidden">
            <input type="text" id="input-account-verify-code" /><button id="btn-account-verify"></button><button id="btn-account-resend"></button>
          </div>
          <input type="email" id="input-account-new-email" /><input type="password" id="input-account-email-password" />
          <button id="btn-account-set-email"></button>
        </div>
        <button id="btn-account-logout"></button><button id="btn-account-logout-all"></button>
        <input type="password" id="input-account-current-password" /><input type="password" id="input-account-new-password" />
        <button id="btn-account-change-password"></button>
      </div>
      <p id="account-status" class="hidden"></p>
    </div>
    <input type="password" id="input-access-key" />
    <button id="btn-access-key-save"></button><button id="btn-access-key-clear"></button><p id="access-key-status" class="hidden"></p>
    <div id="settings-developer-section">
      <input type="checkbox" id="toggle-dev-insecure-http" /><button id="btn-dev-open-companion"></button>
    </div>
    <div id="manage-blueprints-list"></div><p id="manage-blueprints-empty" class="hidden"></p>
    <div id="all-saved-configs-list"></div><p id="all-saved-configs-empty" class="hidden"></p>
  </section>
  <div id="error-toast" class="hidden"><span id="error-toast-message"></span><button id="btn-report-bug-toast" class="hidden"></button></div>
`;

const jsonResponse = (status, body, headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => { if (body === undefined) throw new Error('no body'); return body; },
  headers: { get: (name) => headers[name] ?? null },
});

const HEALTH = { authRequired: true, registration: true, email: 'optional', passwordReset: true, verifiedEmailRequired: false };

async function openSettings({ health = HEALTH, stored = {}, routes = {} } = {}) {
  jest.resetModules();
  document.body.innerHTML = html;
  const storedLocal = { ...stored };
  global.chrome = {
    runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
    tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])), create: jest.fn() },
    storage: {
      session: { get: jest.fn().mockResolvedValue({ fields: [], url: 'https://example.com' }), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
      local: {
        get: jest.fn(async (key) => (key in storedLocal ? { [key]: storedLocal[key] } : {})),
        set: jest.fn(async (obj) => { Object.assign(storedLocal, obj); }),
        remove: jest.fn(async (key) => { delete storedLocal[key]; }),
      },
    },
  };
  const calls = [];
  global.fetch = jest.fn(async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, init });
    if (path === '/health') return jsonResponse(200, health);
    if (routes[path]) return routes[path](init);
    return jsonResponse(200, []);
  });
  require('./popup');
  await flush();
  document.getElementById('btn-open-settings').click();
  await flush();
  return { storedLocal, calls };
}

const hidden = (id) => document.getElementById(id).classList.contains('hidden');
const fill = (id, value) => { document.getElementById(id).value = value; };
const click = async (id) => { document.getElementById(id).click(); await flush(); };
const status = () => document.getElementById('account-status').textContent;
const whoami = (extra = {}) => async () => jsonResponse(200, { name: 'alice', authRequired: true, email: 'alice@example.com', emailVerified: false, ...extra });

afterEach(() => { delete global.chrome; });

describe('registration with an email address', () => {
  test('the field appears when the companion collects addresses and registration is open', async () => {
    await openSettings();
    expect(hidden('account-email-row')).toBe(false);
    expect(document.getElementById('label-account-email').textContent).toBe(tx('settings.account.emailLabelOptional'));
  });

  test('the label says required when the operator requires it; the field is gone when email is off', async () => {
    await openSettings({ health: { ...HEALTH, email: 'required' } });
    expect(document.getElementById('label-account-email').textContent).toBe(tx('settings.account.emailLabelRequired'));
    await openSettings({ health: { ...HEALTH, email: 'off', passwordReset: false } });
    expect(hidden('account-email-row')).toBe(true);
    expect(hidden('account-email-section')).toBe(true);
  });

  test('a required address is checked before anything is sent', async () => {
    const { calls } = await openSettings({ health: { ...HEALTH, email: 'required' } });
    fill('input-account-name', 'carol'); fill('input-account-password', 'pw-long-enough-1'); fill('input-account-password-repeat', 'pw-long-enough-1');
    await click('btn-account-register');
    expect(status()).toBe(tx('settings.account.emailMissing'));
    fill('input-account-email', 'not-an-address');
    await click('btn-account-register');
    expect(status()).toBe(tx('settings.account.emailInvalid'));
    expect(calls.some((c) => c.path === '/auth/register')).toBe(false);
  });

  test('registering sends the address and says where the code went; the verify box shows', async () => {
    const { calls } = await openSettings({
      routes: { '/auth/register': async () => jsonResponse(201, { name: 'carol', token: 'sf_c', email: 'carol@example.com', emailVerified: false, verificationSent: true }) },
    });
    fill('input-account-name', 'carol'); fill('input-account-password', 'pw-long-enough-1'); fill('input-account-password-repeat', 'pw-long-enough-1');
    fill('input-account-email', 'carol@example.com');
    await click('btn-account-register');

    expect(JSON.parse(calls.find((c) => c.path === '/auth/register').init.body).email).toBe('carol@example.com');
    expect(status()).toBe(tx('settings.account.registeredCodeSent', { email: 'carol@example.com' }));
    expect(hidden('account-verify-row')).toBe(false);
    expect(document.getElementById('account-email-state').textContent).toBe(tx('settings.account.emailUnverifiedState', { email: 'carol@example.com' }));
  });

  test('a mail that could not be sent is a warning, not a failure', async () => {
    await openSettings({
      routes: { '/auth/register': async () => jsonResponse(201, { name: 'carol', token: 'sf_c', email: 'carol@example.com', emailVerified: false, verificationSent: false }) },
    });
    fill('input-account-name', 'carol'); fill('input-account-password', 'pw-long-enough-1'); fill('input-account-password-repeat', 'pw-long-enough-1');
    fill('input-account-email', 'carol@example.com');
    await click('btn-account-register');
    expect(status()).toBe(tx('settings.account.registeredNoCode', { email: 'carol@example.com' }));
    expect(document.getElementById('account-status').classList.contains('warn')).toBe(true);
    expect(hidden('account-signed-in')).toBe(false);
  });
});

describe('verifying the address', () => {
  const signedIn = (extra = {}) => ({ stored: { companionAccessKey: 'sf_tok' }, routes: { '/whoami': whoami(extra) } });

  test('an unverified address shows the code box; a verified one does not', async () => {
    await openSettings(signedIn());
    expect(hidden('account-verify-row')).toBe(false);
    await openSettings(signedIn({ emailVerified: true }));
    expect(hidden('account-verify-row')).toBe(true);
    expect(document.getElementById('account-email-state').textContent).toBe(tx('settings.account.emailVerifiedState', { email: 'alice@example.com' }));
  });

  test('no code box without a mail server (nothing could be sent)', async () => {
    await openSettings({ ...signedIn(), health: { ...HEALTH, passwordReset: false } });
    expect(hidden('account-verify-row')).toBe(true);
  });

  test('a malformed code is explained locally', async () => {
    const { calls } = await openSettings(signedIn());
    fill('input-account-verify-code', '12');
    await click('btn-account-verify');
    expect(status()).toBe(tx('settings.account.codeInvalid', { digits: 8 }));
    expect(calls.some((c) => c.path === '/auth/verify-email')).toBe(false);
  });

  test('the right code verifies and hides the box', async () => {
    const { calls } = await openSettings({ ...signedIn(), routes: { '/whoami': whoami(), '/auth/verify-email': async () => jsonResponse(200, { emailVerified: true }) } });
    fill('input-account-verify-code', '1234 5678');
    await click('btn-account-verify');
    expect(JSON.parse(calls.find((c) => c.path === '/auth/verify-email').init.body)).toEqual({ code: '12345678' });
    expect(status()).toBe(tx('settings.account.emailVerifiedNow'));
    expect(hidden('account-verify-row')).toBe(true);
  });

  test("a wrong code shows the companion's message", async () => {
    await openSettings({ ...signedIn(), routes: { '/whoami': whoami(), '/auth/verify-email': async () => jsonResponse(400, { error: 'The code is wrong.' }) } });
    fill('input-account-verify-code', '12345678');
    await click('btn-account-verify');
    expect(status()).toBe('The code is wrong.');
  });

  test('"send the code again" reports success and the cooldown', async () => {
    await openSettings({ ...signedIn(), routes: { '/whoami': whoami(), '/auth/resend-verification': async () => jsonResponse(202, { sent: true }) } });
    await click('btn-account-resend');
    expect(status()).toBe(tx('settings.account.codeResent'));

    await openSettings({ ...signedIn(), routes: { '/whoami': whoami(), '/auth/resend-verification': async () => jsonResponse(429, { error: 'Please wait 40 seconds before asking for another email.' }, { 'Retry-After': '40' }) } });
    await click('btn-account-resend');
    expect(status()).toBe(tx('settings.account.throttled', { seconds: 40 }));
  });
});

describe('changing the address', () => {
  test('needs a plausible address; sends it with the password and shows the new state', async () => {
    const { calls } = await openSettings({
      stored: { companionAccessKey: 'sf_tok' },
      routes: {
        '/whoami': whoami({ emailVerified: true }),
        '/auth/set-email': async () => jsonResponse(200, { name: 'alice', email: 'new@example.com', emailVerified: false, verificationSent: true }),
      },
    });
    fill('input-account-new-email', 'nonsense');
    await click('btn-account-set-email');
    expect(status()).toBe(tx('settings.account.emailInvalid'));

    fill('input-account-new-email', 'new@example.com');
    fill('input-account-email-password', 'my-password-1');
    await click('btn-account-set-email');
    expect(JSON.parse(calls.find((c) => c.path === '/auth/set-email').init.body)).toEqual({ email: 'new@example.com', currentPassword: 'my-password-1' });
    expect(hidden('account-verify-row')).toBe(false);
    expect(document.getElementById('account-email-state').textContent).toBe(tx('settings.account.emailUnverifiedState', { email: 'new@example.com' }));
  });

  test('a wrong password shows the companion message and keeps the old address', async () => {
    await openSettings({
      stored: { companionAccessKey: 'sf_tok' },
      routes: { '/whoami': whoami(), '/auth/set-email': async () => jsonResponse(401, { error: 'The current password is wrong.' }) },
    });
    fill('input-account-new-email', 'new@example.com');
    await click('btn-account-set-email');
    expect(status()).toBe('The current password is wrong.');
    expect(document.getElementById('account-email-state').textContent).toBe(tx('settings.account.emailUnverifiedState', { email: 'alice@example.com' }));
  });
});

describe('forgot password', () => {
  test('the link only exists when the companion can send mail', async () => {
    await openSettings();
    expect(hidden('btn-account-forgot')).toBe(false);
    await openSettings({ health: { ...HEALTH, passwordReset: false } });
    expect(hidden('btn-account-forgot')).toBe(true);
  });

  test('the panel toggles; sending a code gives the same neutral answer', async () => {
    const { calls } = await openSettings({ routes: { '/auth/forgot-password': async () => jsonResponse(202, { message: 'x' }) } });
    await click('btn-account-forgot');
    expect(hidden('account-forgot-panel')).toBe(false);

    await click('btn-account-forgot-send');
    expect(status()).toBe(tx('settings.account.forgotAccountMissing'));
    fill('input-account-forgot-account', ' alice ');
    await click('btn-account-forgot-send');
    expect(JSON.parse(calls.find((c) => c.path === '/auth/forgot-password').init.body)).toEqual({ account: 'alice' });
    expect(status()).toBe(tx('settings.account.forgotSent'));

    await click('btn-account-forgot');
    expect(hidden('account-forgot-panel')).toBe(true);
  });

  test('resetting needs a well-formed code and a password, then closes the panel', async () => {
    const { calls } = await openSettings({ routes: { '/auth/reset-password': async () => jsonResponse(204) } });
    await click('btn-account-forgot');
    fill('input-account-forgot-account', 'alice');
    fill('input-account-reset-code', '12');
    await click('btn-account-reset-confirm');
    expect(status()).toBe(tx('settings.account.codeInvalid', { digits: 8 }));
    fill('input-account-reset-code', '1234 5678');
    await click('btn-account-reset-confirm');
    expect(status()).toBe(tx('settings.account.passwordMissing'));

    fill('input-account-reset-password', 'a-new-long-password');
    await click('btn-account-reset-confirm');
    expect(JSON.parse(calls.find((c) => c.path === '/auth/reset-password').init.body)).toEqual({ account: 'alice', code: '12345678', newPassword: 'a-new-long-password' });
    expect(status()).toBe(tx('settings.account.resetDone'));
    expect(hidden('account-forgot-panel')).toBe(true);
    expect(document.getElementById('input-account-reset-password').value).toBe('');
  });

  test("a failed reset shows the companion's generic message and keeps the panel open", async () => {
    await openSettings({ routes: { '/auth/reset-password': async () => jsonResponse(400, { error: 'The code is wrong or has expired.' }) } });
    await click('btn-account-forgot');
    fill('input-account-forgot-account', 'alice');
    fill('input-account-reset-code', '12345678');
    fill('input-account-reset-password', 'a-new-long-password');
    await click('btn-account-reset-confirm');
    expect(status()).toBe('The code is wrong or has expired.');
    expect(hidden('account-forgot-panel')).toBe(false);
  });
});

describe('the verified-email rule', () => {
  test('connecting while signed in with an unverified address shows a warning', async () => {
    await openSettings({
      health: { ...HEALTH, verifiedEmailRequired: true },
      stored: { companionAccessKey: 'sf_tok' },
      routes: { '/whoami': whoami() },
    });
    expect(document.getElementById('error-toast-message').textContent).toBe(tx('toast.emailUnverified'));
  });

  test('no warning for a verified address or without the rule', async () => {
    await openSettings({ health: { ...HEALTH, verifiedEmailRequired: true }, stored: { companionAccessKey: 'sf_tok' }, routes: { '/whoami': whoami({ emailVerified: true }) } });
    expect(document.getElementById('error-toast-message').textContent).toBe('');
    await openSettings({ stored: { companionAccessKey: 'sf_tok' }, routes: { '/whoami': whoami() } });
    expect(document.getElementById('error-toast-message').textContent).toBe('');
  });
});
