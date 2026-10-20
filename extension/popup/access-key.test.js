Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

// Issue #278: the access key for a companion with per-user authentication —
// storage, the Authorization header on every companion request, the check
// right after the health check, and the Settings screen's input.
const flushMicrotasks = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('access key storage', () => {
  let stored;

  beforeEach(() => {
    jest.resetModules();
    stored = {};
    global.chrome = {
      storage: {
        local: {
          get: jest.fn(async (key) => (key in stored ? { [key]: stored[key] } : {})),
          set: jest.fn(async (obj) => { Object.assign(stored, obj); }),
          remove: jest.fn(async (key) => { delete stored[key]; }),
        },
      },
    };
  });

  afterEach(() => { delete global.chrome; });

  test('an empty cache until something is loaded or set', () => {
    expect(require('../shared/companion-config').getAccessKey()).toBe('');
  });

  test('setAccessKey trims, caches synchronously and persists; an empty key removes it', async () => {
    const config = require('../shared/companion-config');
    await config.setAccessKey('  sf_abc  ');
    expect(config.getAccessKey()).toBe('sf_abc');
    expect(stored.companionAccessKey).toBe('sf_abc');

    await config.setAccessKey('');
    expect(config.getAccessKey()).toBe('');
    expect(stored).not.toHaveProperty('companionAccessKey');
  });

  test('loadAccessKey fills the cache from storage (a fresh popup)', async () => {
    stored.companionAccessKey = 'sf_saved';
    const config = require('../shared/companion-config');
    expect(await config.loadAccessKey()).toBe('sf_saved');
    expect(config.getAccessKey()).toBe('sf_saved');
  });
});

describe('companionFetch', () => {
  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    global.chrome = { storage: { local: { get: jest.fn(async () => ({})), set: jest.fn(async () => {}), remove: jest.fn(async () => {}) } } };
  });

  afterEach(() => { delete global.chrome; });

  test('without a key it is exactly the plain fetch it always was', async () => {
    const { companionFetch } = require('./companion-client');
    await companionFetch('http://localhost:5000/configs');
    await companionFetch('http://localhost:5000/configs', { method: 'DELETE' });

    expect(global.fetch.mock.calls[0]).toEqual(['http://localhost:5000/configs']);
    expect(global.fetch.mock.calls[1]).toEqual(['http://localhost:5000/configs', { method: 'DELETE' }]);
  });

  test('with a key it adds a Bearer header and keeps everything else', async () => {
    await require('../shared/companion-config').setAccessKey('sf_abc');
    const { companionFetch } = require('./companion-client');

    await companionFetch('http://localhost:5000/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    await companionFetch('http://localhost:5000/configs');

    expect(global.fetch.mock.calls[0][1]).toEqual({
      method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer sf_abc' },
    });
    expect(global.fetch.mock.calls[1][1]).toEqual({ headers: { Authorization: 'Bearer sf_abc' } });
  });
});

describe('the check after the health check', () => {
  const run = async (healthBody, whoamiStatus, key) => {
    jest.resetModules();
    const stored = key ? { companionAccessKey: key } : {};
    global.chrome = {
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: { local: { get: jest.fn(async (k) => (k in stored ? { [k]: stored[k] } : {})), set: jest.fn(async () => {}) } },
    };
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith('/health')) return { ok: true, json: async () => healthBody };
      if (String(url).endsWith('/whoami')) return { ok: whoamiStatus === 200, status: whoamiStatus, json: async () => ({ name: 'alice', authRequired: true }) };
      return { ok: true, json: async () => [] };
    });
    document.body.innerHTML = '<div id="error-toast" class="hidden"><span id="error-toast-message"></span><button id="btn-report-bug-toast" class="hidden"></button></div>';
    const bridge = { getState: () => ({ scriptFileName: '' }), setState: jest.fn(), patchState: jest.fn(), fetchSavedConfigs: jest.fn(), fetchAllSavedConfigs: jest.fn(), fetchOutputBlueprints: jest.fn(), fetchTransformPresets: jest.fn() };
    await require('./companion-client').checkCompanion(bridge);
    return { fetchCalls: global.fetch.mock.calls.map(([url]) => String(url)), toast: document.getElementById('error-toast-message').textContent };
  };

  afterEach(() => { delete global.chrome; });

  test('a companion without authentication is not asked anything more', async () => {
    const { fetchCalls, toast } = await run({ authRequired: false }, 200);
    expect(fetchCalls.some(url => url.endsWith('/whoami'))).toBe(false);
    expect(toast).toBe('');
  });

  test('an older companion (no body) is left alone too', async () => {
    const { toast } = await run(undefined, 200);
    expect(toast).toBe('');
  });

  test('authentication on and no key set → a toast says an access key is required', async () => {
    const { fetchCalls, toast } = await run({ authRequired: true }, 401);
    expect(fetchCalls.some(url => url.endsWith('/whoami'))).toBe(true);
    expect(toast).toBe('toast.accessKeyRequired'); // (no dictionary loaded here, so the key itself)
  });

  test('authentication on and a wrong key → a toast says it was rejected', async () => {
    const { toast } = await run({ authRequired: true }, 401, 'sf_wrong');
    expect(toast).toBe('toast.accessKeyRejected');
  });

  test('authentication on and a good key → silent', async () => {
    const { toast } = await run({ authRequired: true }, 200, 'sf_good');
    expect(toast).toBe('');
  });
});

describe('the Settings screen input', () => {
  let storedLocal;
  let whoamiResponse;

  const html = `
    <div id="header-bar"><button id="btn-open-settings"></button></div>
    <section id="screen-idle" class="hidden">
      <div id="url-display"></div><div id="fields-list"></div><button id="btn-generate" disabled></button>
    </section>
    <section id="screen-generating" class="hidden"></section>
    <section id="screen-settings" class="hidden">
      <button id="btn-close-settings"></button>
      <input type="password" id="input-access-key" />
      <button id="btn-access-key-save"></button><button id="btn-access-key-clear"></button>
      <p id="access-key-status" class="hidden"></p>
      <div id="manage-blueprints-list"></div><p id="manage-blueprints-empty" class="hidden"></p>
      <div id="all-saved-configs-list"></div><p id="all-saved-configs-empty" class="hidden"></p>
    </section>
    <div id="error-toast" class="hidden"><span id="error-toast-message"></span><button id="btn-report-bug-toast" class="hidden"></button></div>
  `;

  beforeEach(async () => {
    jest.resetModules();
    storedLocal = {};
    whoamiResponse = { status: 200, ok: true, body: { name: 'alice', authRequired: true } };
    document.body.innerHTML = html;
    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: { get: jest.fn().mockResolvedValue({ fields: [], url: 'https://example.com' }), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
        local: {
          get: jest.fn(async (key) => (key in storedLocal ? { [key]: storedLocal[key] } : {})),
          set: jest.fn(async (obj) => { Object.assign(storedLocal, obj); }),
          remove: jest.fn(async (key) => { delete storedLocal[key]; }),
        },
      },
    };
    global.fetch = jest.fn(async (url) => {
      if (String(url).endsWith('/health')) return { ok: true };
      if (String(url).endsWith('/whoami')) return { ok: whoamiResponse.ok, status: whoamiResponse.status, json: async () => whoamiResponse.body };
      return { ok: true, json: async () => [] };
    });
    require('./popup');
    await flushMicrotasks();
    document.getElementById('btn-open-settings').click();
  });

  afterEach(() => { delete global.chrome; });

  const save = async (value) => {
    document.getElementById('input-access-key').value = value;
    document.getElementById('btn-access-key-save').click();
    await flushMicrotasks();
  };

  test('saving stores the key and reports who it belongs to', async () => {
    await save('sf_abc');

    expect(storedLocal.companionAccessKey).toBe('sf_abc');
    const whoamiCall = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/whoami'));
    expect(whoamiCall[1].headers.Authorization).toBe('Bearer sf_abc');
    expect(document.getElementById('access-key-status').textContent).toBe('Connected as alice.');
  });

  test('a rejected key is reported as such', async () => {
    whoamiResponse = { status: 401, ok: false, body: {} };
    await save('sf_wrong');
    expect(document.getElementById('access-key-status').textContent).toBe('The access key is not valid.');
  });

  test('a companion without authentication says so', async () => {
    whoamiResponse = { status: 200, ok: true, body: { name: '', authRequired: false } };
    await save('sf_abc');
    expect(document.getElementById('access-key-status').textContent).toBe('This companion does not use access keys.');
  });

  test('remove clears the stored key and the status', async () => {
    await save('sf_abc');
    document.getElementById('btn-access-key-clear').click();
    await flushMicrotasks();

    expect(storedLocal).not.toHaveProperty('companionAccessKey');
    expect(document.getElementById('input-access-key').value).toBe('');
    expect(document.getElementById('access-key-status').classList.contains('hidden')).toBe(true);
  });
});
