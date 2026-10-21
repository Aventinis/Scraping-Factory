Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

// Issue #352: the Settings screen's Account section (sign in / register /
// sign out / change password) and the development-only options.
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
        <button id="btn-account-login"></button><button id="btn-account-register" class="hidden"></button>
        <p id="account-no-registration" class="hidden"></p>
      </div>
      <div id="account-signed-in" class="hidden">
        <p id="account-signed-in-as"></p>
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

async function openSettings({ channel = 'development', health = { authRequired: true, registration: true }, stored = {}, routes = {} } = {}) {
  jest.resetModules();
  jest.doMock('../shared/build-config', () => ({ CHANNEL: channel, isDevelopmentBuild: () => channel === 'development' }));
  const storedLocal = { ...stored };
  document.body.innerHTML = html;
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

afterEach(() => { delete global.chrome; jest.dontMock('../shared/build-config'); });

describe('Account section visibility', () => {
  test('hidden when the companion does not use authentication', async () => {
    await openSettings({ health: { authRequired: false, registration: false } });
    expect(hidden('settings-account-section')).toBe(true);
  });

  test('shown signed out when authentication is on; Register only when the operator allows it', async () => {
    await openSettings();
    expect(hidden('settings-account-section')).toBe(false);
    expect(hidden('account-signed-out')).toBe(false);
    expect(hidden('account-signed-in')).toBe(true);
    expect(hidden('btn-account-register')).toBe(false);
    expect(hidden('account-repeat-row')).toBe(false);
    expect(hidden('account-no-registration')).toBe(true);
  });

  test('without open registration there is no Register button, only the explanation', async () => {
    await openSettings({ health: { authRequired: true, registration: false } });
    expect(hidden('btn-account-register')).toBe(true);
    expect(hidden('account-repeat-row')).toBe(true);
    expect(hidden('account-no-registration')).toBe(false);
  });

  test('a stored valid token shows the signed-in view', async () => {
    await openSettings({
      stored: { companionAccessKey: 'sf_tok' },
      routes: { '/whoami': async () => jsonResponse(200, { name: 'alice', authRequired: true }) },
    });
    expect(hidden('account-signed-in')).toBe(false);
    expect(document.getElementById('account-signed-in-as').textContent).toContain('alice');
  });
});

describe('signing in and out', () => {
  test('login stores the returned token, sends it afterwards and shows the signed-in view', async () => {
    const { storedLocal, calls } = await openSettings({
      routes: { '/auth/login': async () => jsonResponse(200, { name: 'alice', token: 'sf_new' }) },
    });
    fill('input-account-name', 'alice');
    fill('input-account-password', 'correct horse');
    await click('btn-account-login');

    const login = calls.find((c) => c.path === '/auth/login');
    expect(JSON.parse(login.init.body)).toMatchObject({ name: 'alice', password: 'correct horse' });
    expect(storedLocal.companionAccessKey).toBe('sf_new');
    expect(hidden('account-signed-in')).toBe(false);
    expect(document.getElementById('input-account-password').value).toBe('');
  });

  test('a wrong password shows the companion message and stores nothing', async () => {
    const { storedLocal } = await openSettings({
      routes: { '/auth/login': async () => jsonResponse(401, { error: 'Invalid user name or password.' }) },
    });
    fill('input-account-name', 'alice');
    fill('input-account-password', 'nope');
    await click('btn-account-login');

    expect(storedLocal.companionAccessKey).toBeUndefined();
    expect(document.getElementById('account-status').textContent).toBe('Invalid user name or password.');
    expect(hidden('account-signed-in')).toBe(true);
  });

  test('register needs the repeated password to match before anything is sent', async () => {
    const { calls } = await openSettings();
    fill('input-account-name', 'bob');
    fill('input-account-password', 'pw-one');
    fill('input-account-password-repeat', 'pw-two');
    await click('btn-account-register');

    expect(calls.some((c) => c.path === '/auth/register')).toBe(false);
    expect(document.getElementById('account-status').classList.contains('hidden')).toBe(false);
  });

  test('register with matching passwords signs the new user in', async () => {
    const { storedLocal } = await openSettings({
      routes: { '/auth/register': async () => jsonResponse(201, { name: 'bob', token: 'sf_bob' }) },
    });
    fill('input-account-name', 'bob');
    fill('input-account-password', 'long enough pw');
    fill('input-account-password-repeat', 'long enough pw');
    await click('btn-account-register');

    expect(storedLocal.companionAccessKey).toBe('sf_bob');
    expect(hidden('account-signed-in')).toBe(false);
  });

  test('sign out revokes the token and forgets it — even when the companion is unreachable', async () => {
    const { storedLocal, calls } = await openSettings({
      stored: { companionAccessKey: 'sf_tok' },
      routes: {
        '/whoami': async () => jsonResponse(200, { name: 'alice', authRequired: true }),
        '/auth/logout': async () => { throw new TypeError('Failed to fetch'); },
      },
    });
    await click('btn-account-logout');

    expect(calls.some((c) => c.path === '/auth/logout')).toBe(true);
    expect(storedLocal.companionAccessKey).toBeUndefined();
    expect(hidden('account-signed-out')).toBe(false);
  });

  test('sign out everywhere calls logout-all and forgets the token', async () => {
    const { storedLocal, calls } = await openSettings({
      stored: { companionAccessKey: 'sf_tok' },
      routes: {
        '/whoami': async () => jsonResponse(200, { name: 'alice', authRequired: true }),
        '/auth/logout-all': async () => jsonResponse(204),
      },
    });
    await click('btn-account-logout-all');

    expect(calls.some((c) => c.path === '/auth/logout-all')).toBe(true);
    expect(storedLocal.companionAccessKey).toBeUndefined();
  });

  test('changing the password sends both passwords and keeps the session', async () => {
    const { storedLocal, calls } = await openSettings({
      stored: { companionAccessKey: 'sf_tok' },
      routes: {
        '/whoami': async () => jsonResponse(200, { name: 'alice', authRequired: true }),
        '/auth/change-password': async () => jsonResponse(204),
      },
    });
    fill('input-account-current-password', 'old pw');
    fill('input-account-new-password', 'new long pw');
    await click('btn-account-change-password');

    const call = calls.find((c) => c.path === '/auth/change-password');
    expect(JSON.parse(call.init.body)).toEqual({ currentPassword: 'old pw', newPassword: 'new long pw' });
    expect(call.init.headers.Authorization).toBe('Bearer sf_tok');
    expect(storedLocal.companionAccessKey).toBe('sf_tok');
    expect(document.getElementById('input-account-new-password').value).toBe('');
  });
});

describe('developer options', () => {
  test('development build: the section is there and the toggle persists', async () => {
    const { storedLocal } = await openSettings({ channel: 'development' });
    expect(document.getElementById('settings-developer-section')).not.toBeNull();
    const toggle = document.getElementById('toggle-dev-insecure-http');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));
    await flush();
    expect(storedLocal.devAllowInsecureHttp).toBe(true);
  });

  test('release build: the whole section is removed from the page', async () => {
    await openSettings({ channel: 'release' });
    expect(document.getElementById('settings-developer-section')).toBeNull();
    expect(document.getElementById('toggle-dev-insecure-http')).toBeNull();
  });
});
