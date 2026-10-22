// Issue #397: the shared environment-variable name rule (env-var.js), the shared
// inline validation/explanation (env-var-ui.js) and the Generate guard.
Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

const { ENV_VAR_NAME_PATTERN, validateEnvVarName, findInvalidEnvVarNames } = require('./env-var');

describe('validateEnvVarName', () => {
  test.each([
    'SMTP_PASSWORD', 'PROXY_LIST', 'API_KEY', 'a', '_x', 'x1', 'Mixed_Case_9', '  PADDED  ',
  ])('%p is valid', (name) => {
    expect(validateEnvVarName(name)).toEqual({ ok: true });
  });

  test.each(['', '   ', null, undefined])('%p is "not set", never an error', (name) => {
    expect(validateEnvVarName(name)).toEqual({ ok: true });
  });

  test.each([
    ['1BAD', 'startsWithDigit'],
    ['9', 'startsWithDigit'],
    ['MY VAR', 'invalidChars'],
    ['MY-VAR', 'invalidChars'],
    ['MY.VAR', 'invalidChars'],
    ['$HOME', 'invalidChars'],
    ['%PATH%', 'invalidChars'],
    ['NAME=value', 'invalidChars'],
    ['Größe', 'invalidChars'],
    ['a b c', 'invalidChars'],
  ])('%p is invalid (%s)', (name, reason) => {
    expect(validateEnvVarName(name)).toEqual({ ok: false, reason });
  });

  test("mirrors the companion's pattern", () => {
    expect(ENV_VAR_NAME_PATTERN.source).toBe('^[A-Za-z_][A-Za-z0-9_]*$');
  });
});

describe('findInvalidEnvVarNames scans every place a name can be typed', () => {
  const config = {
    url: 'https://example.com',
    changeDetection: { notify: 'Email', email: {
      smtpHostEnvVar: 'SMTP_HOST', fromEnvVar: 'MAIL FROM', toEnvVar: 'MAIL_TO', smtpPortEnvVar: '25', smtpPasswordEnvVar: 'SMTP_PASSWORD',
    } },
    proxy: { environmentVariableName: 'PROXY-LIST' },
    browserActions: [{ kind: 'fill', selector: '#u', environmentVariableName: 'SITE_USER' }, { kind: 'fill', selector: '#p', environmentVariableName: '2fa' }],
    headers: [{ name: 'X-Api-Key', environmentVariableName: 'API KEY' }, { name: 'Accept', value: 'not a variable name - it is a value' }],
    api: {
      headers: [{ name: 'Authorization', environmentVariableName: 'TOKEN!' }],
      bootstrap: { headers: [{ name: 'X', environmentVariableName: 'OK_ONE' }], bodyFields: [{ name: 'password', environmentVariableName: 'pass word' }] },
      parameters: [{ source: { kind: 'browserDiscovery', actions: [{ kind: 'fill', environmentVariableName: '3RD' }] } }],
    },
    combined: [{ config: { proxy: { environmentVariableName: 'NESTED BAD' } } }],
  };

  test('finds exactly the invalid ones, with where and why', () => {
    const found = findInvalidEnvVarNames(config);
    expect(found.map((f) => [f.path, f.name, f.reason])).toEqual([
      ['changeDetection.email.fromEnvVar', 'MAIL FROM', 'invalidChars'],
      ['changeDetection.email.smtpPortEnvVar', '25', 'startsWithDigit'],
      ['proxy.environmentVariableName', 'PROXY-LIST', 'invalidChars'],
      ['browserActions[1].environmentVariableName', '2fa', 'startsWithDigit'],
      ['headers[0].environmentVariableName', 'API KEY', 'invalidChars'],
      ['api.headers[0].environmentVariableName', 'TOKEN!', 'invalidChars'],
      ['api.bootstrap.bodyFields[0].environmentVariableName', 'pass word', 'invalidChars'],
      ['api.parameters[0].source.actions[0].environmentVariableName', '3RD', 'startsWithDigit'],
      ['combined[0].config.proxy.environmentVariableName', 'NESTED BAD', 'invalidChars'],
    ]);
  });

  test('a config with only valid names, or none, is clean', () => {
    expect(findInvalidEnvVarNames({ proxy: { environmentVariableName: 'PROXY_LIST' }, changeDetection: { webhook: { urlEnvVar: 'WEBHOOK_URL' } } })).toEqual([]);
    expect(findInvalidEnvVarNames({ url: 'https://x', fields: [{ name: 'a', selector: '.b' }] })).toEqual([]);
    expect(findInvalidEnvVarNames(null)).toEqual([]);
    expect(findInvalidEnvVarNames('text')).toEqual([]);
  });

  test('only properties that hold a variable NAME count — a header\'s literal value never does', () => {
    expect(findInvalidEnvVarNames({ headers: [{ name: 'Accept-Language', value: 'de CH, en' }] })).toEqual([]);
  });
});

describe('the shared inline validation (env-var-ui.js)', () => {
  let ui;

  beforeEach(async () => {
    jest.resetModules();
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn() } } };
    await require('../i18n/i18n').setLanguage('en');
    ui = require('./env-var-ui');
  });
  afterEach(() => { delete global.chrome; document.body.innerHTML = ''; });

  const mountStatic = () => {
    document.body.innerHTML = '<div class="output-settings-row"><label>Proxy</label><input type="text" id="p" data-env-var /></div>';
    return document.getElementById('p');
  };
  const messageAfterRow = () => document.querySelector('.env-var-error');

  test('an invalid name is flagged under its row, with a message that says what to do', () => {
    const input = mountStatic();
    input.value = 'MY VAR';
    ui.applyEnvVarValidation(input);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.classList.contains('env-var-invalid')).toBe(true);
    expect(messageAfterRow().textContent).toContain('“MY VAR”');
    expect(messageAfterRow().textContent).toContain('letters, digits and underscores');
    expect(messageAfterRow().getAttribute('role')).toBe('alert');
    expect(input.closest('.output-settings-row').nextElementSibling).toBe(messageAfterRow());
  });

  test('a digit first gets its own message, and a valid name clears everything', () => {
    const input = mountStatic();
    input.value = '1BAD';
    ui.applyEnvVarValidation(input);
    expect(messageAfterRow().textContent).toContain("can't start with a digit");
    input.value = 'GOOD_NAME';
    ui.applyEnvVarValidation(input);
    expect(messageAfterRow()).toBeNull();
    expect(input.getAttribute('aria-invalid')).toBeNull();
    expect(input.classList.contains('env-var-invalid')).toBe(false);
  });

  test('re-checking does not stack messages, and an empty input is neutral', () => {
    const input = mountStatic();
    input.value = 'BAD NAME';
    ui.applyEnvVarValidation(input);
    ui.applyEnvVarValidation(input);
    expect(document.querySelectorAll('.env-var-error')).toHaveLength(1);
    input.value = '';
    ui.applyEnvVarValidation(input);
    expect(messageAfterRow()).toBeNull();
  });

  test('typing validates live, on inputs added later too (delegated)', () => {
    ui.wireEnvVarValidation();
    ui.wireEnvVarValidation(); // wired once
    document.body.innerHTML = '<div id="late"></div>';
    document.getElementById('late').innerHTML = '<div class="request-header-row"><input type="text" id="h" data-env-var /></div>';
    const input = document.getElementById('h');
    input.value = 'API-KEY';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('.env-var-error')).toHaveLength(1);
    input.value = 'API_KEY';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(document.querySelectorAll('.env-var-error')).toHaveLength(0);
  });

  test('refreshEnvVarValidation re-checks rebuilt rows; in a <ul> the message is an <li>', () => {
    document.body.innerHTML = '<ul><li><input type="text" data-env-var value="bad name" /></li><li><input type="text" data-env-var value="OK" /></li></ul>';
    ui.refreshEnvVarValidation();
    const messages = document.querySelectorAll('.env-var-error');
    expect(messages).toHaveLength(1);
    expect(messages[0].tagName).toBe('LI');
    document.querySelector('ul').innerHTML = '<li><input type="text" data-env-var value="bad name" /></li>'; // a re-render
    ui.refreshEnvVarValidation();
    expect(document.querySelectorAll('.env-var-error')).toHaveLength(1);
  });

  test('the explanation line carries the one shared help host', () => {
    document.body.innerHTML = ui.envVarNoteHtml();
    const note = document.querySelector('.env-var-note');
    expect(note.hasAttribute('data-help-anchor')).toBe(true);
    expect(note.textContent).toBe('What is an environment variable?');
    expect(note.querySelector('.help-host').dataset.help).toBe('help.envVar.what');
  });
});

describe('a bad environment-variable name blocks Generate before the round trip', () => {
  const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

  async function boot(proxyName) {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden"><div id="url-display"></div><div id="fields-list"></div><button id="btn-generate"></button></section>
      <section id="screen-generating" class="hidden"></section>
      <div id="error-toast" class="hidden"><span id="error-toast-message"></span><button id="btn-report-bug-toast" class="hidden"></button></div>`;
    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        local: { get: jest.fn().mockResolvedValue({ language: 'en' }), set: jest.fn() },
        session: {
          get: jest.fn().mockResolvedValue({ fields: [{ name: 'Preis', selector: '.price', attribute: null }], url: 'https://example.com', proxy: { enabled: true, envVar: proxyName } }),
          set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn((url) => {
      if (String(url).endsWith('/health')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      if (String(url).endsWith('/generate')) return Promise.resolve({ ok: true, status: 200, headers: { get: () => null }, text: () => Promise.resolve('print("ok")') });
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    require('./popup');
    await flush();
    document.getElementById('btn-generate').click();
    await flush();
  }

  afterEach(() => { delete global.chrome; delete global.fetch; });
  const generateCalls = () => global.fetch.mock.calls.filter(([url]) => String(url).endsWith('/generate')).length;

  test('an invalid name: a warning naming the variable, and no request is sent', async () => {
    await boot('PROXY LIST');
    expect(generateCalls()).toBe(0);
    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('toast-warn')).toBe(true);
    const text = document.getElementById('error-toast-message').textContent;
    expect(text).toContain('Fix the environment variable name first');
    expect(text).toContain('“PROXY LIST”');
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false); // back on the configuration
  });

  test('a valid name goes through as before', async () => {
    await boot('PROXY_LIST');
    expect(generateCalls()).toBe(1);
  });
});
