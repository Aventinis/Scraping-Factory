// Issue #401: plain-language failure messages — the table-driven mapping
// (error-messages.js), its translations, and the error toast (toast.js) that
// shows them with the original text behind "Details".
Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

const { classifyError, describeError } = require('./error-messages');
const { setLanguage } = require('../i18n/i18n');

// What the companion/scripts really say (see PythonScriptVerifier, the
// request_errors_*/require_env/output_tabular fragments and ScrapingPlanValidator).
const CASES = [
  // [raw message, code, params]
  ['Script ran without errors but returned no data (output.csv contains only the header row) — at least one selector or request likely found nothing.', 'noData', {}],
  ['Script did not produce output.csv.', 'noOutput', {}],
  ["required environment variable 'SITE_PASSWORD' is not set.", 'missingEnvVar', { name: 'SITE_PASSWORD' }],
  ['Script execution exceeded the 45s timeout.', 'trialTimeout', {}],
  ['Script execution exceeded the 45s timeout (not counting 12.5s of request-delay pauses and retries).', 'trialTimeout', {}],
  ['robots.txt disallows https://example.com/private - stopping', 'robotsDisallowed', {}],
  ['No Python interpreter found (tried: python3, python). Is Python installed and available on the companion app\'s PATH?', 'pythonMissing', {}],
  ["Excel output needs the 'openpyxl' package — install it with: pip install openpyxl", 'packageMissing', { name: 'openpyxl' }],
  ["Script (python3) exited with an error (exit code 1): Traceback (most recent call last):\n  File \"scraper.py\", line 3\nModuleNotFoundError: No module named 'playwright'", 'packageMissing', { name: 'playwright' }],
  ['Script (python3) exited with an error (exit code 1): Traceback (most recent call last): KeyError: 3', 'scriptCrash', { code: '1' }],
  ['Navigation to https://example.com/ failed: could not load the page (Timeout 30000ms exceeded).', 'pageLoadTimeout', {}],
  ['Navigation to https://example.com/ failed: could not load the page (net::ERR_CONNECTION_REFUSED).', 'pageLoadFailed', {}],
  ['Request to https://example.com/ failed: could not reach the site (ConnectionError).', 'siteUnreachable', {}],
  ['Request to https://api.example.com/items failed: could not reach the API (ConnectionError).', 'siteUnreachable', {}],
  ['Request to https://example.com/ failed: HTTP 403 (Forbidden). The site refuses this script — it either requires a login or blocks automated requests.', 'siteForbidden', { status: '403' }],
  ['Request to https://example.com/ failed: HTTP 401 (Unauthorized). The site refuses this script', 'siteForbidden', { status: '401' }],
  ["Request to https://example.com/missing failed: HTTP 404 (Not Found). The page doesn't exist (any more) — check the start URL.", 'pageNotFound', { status: '404' }],
  ['Request to https://example.com/ failed: HTTP 429 (Too Many Requests). The site is rate-limiting this script', 'rateLimited', { status: '429' }],
  ["Request to https://example.com/ failed: HTTP 503. The site's server reported an error — this is usually temporary", 'siteError', { status: '503' }],
  ['Request to https://example.com/ failed: HTTP 418.', 'httpError', { status: '418' }],
  ['Discovery request to https://api.example.com/weeks failed: the response is not JSON (Content-Type: text/html).', 'requestFailed', {}],
  // validation (HTTP 400)
  ["Invalid start URL #2 'example.com': must be an absolute http(s) URL.", 'invalidStartUrl', { index: '2', url: 'example.com' }],
  ['Invalid ScrapingConfig: Url and at least one Field, Group or Api are required.', 'noFields', {}],
  ["Invalid regular expression '(' for field 'Preis': parsing \"(\" - Not enough )'s.", 'invalidRegex', { pattern: '(', field: "field 'Preis'" }],
  ["Invalid environment variable name '1BAD' in ChangeDetection.Webhook.UrlEnvVar.", 'invalidEnvVarName', { name: '1BAD' }],
  ['Duplicate field names: Titel, Ort.', 'duplicateFieldNames', { names: 'Titel, Ort' }],
  ['Field name must not be empty.', 'emptyFieldName', {}],
  ["Selector for field 'Preis' must not be empty.", 'emptySelector', { name: 'Preis' }],
  ["Selector of group 'Gericht' must not be empty.", 'emptySelector', { name: 'Gericht' }],
  ["Block 'Offers': selector for field 'Preis' must not be empty.", 'emptySelector', { name: 'Preis' }],
  ['Selector of a ClickStep must not be empty.', 'emptySelector', {}],
  // the companion itself
  ['Failed to fetch', 'companionUnreachable', {}],
  ['NetworkError when attempting to fetch resource.', 'companionUnreachable', {}],
  ['HTTP 500', 'companionError', {}],
];

describe('classifyError', () => {
  test.each(CASES)('%s → %s', (raw, code, params) => {
    expect(classifyError(raw)).toEqual({ code, params });
  });

  test.each([
    ['something nobody has seen before'],
    [''],
    [null],
    [undefined],
    ['Skript (python3) wurde mit Fehler beendet'],
  ])('%p is not recognised (the raw text is kept as before)', (raw) => {
    expect(classifyError(raw)).toBeNull();
    expect(describeError(raw)).toBeNull();
  });

  test('several ERROR lines are classified by what they say, not by position', () => {
    expect(classifyError("Request to https://x failed: HTTP 404 (Not Found).\nrequired environment variable 'A' is not set.")?.code).toBe('missingEnvVar');
  });
});

describe('describeError (every class has a title and a hint in every language)', () => {
  test.each(['en', 'de', 'es'])('%s', async (language) => {
    await setLanguage(language);
    for (const [raw, code] of CASES) {
      const plain = describeError(raw, { engine: 'Browser' });
      expect({ raw, code: plain.code }).toEqual({ raw, code });
      // an unresolved key is shown as the key itself — it must not happen
      expect({ raw, title: plain.title.startsWith('errors.') }).toEqual({ raw, title: false });
      expect({ raw, hint: plain.hint.startsWith('errors.') }).toEqual({ raw, hint: false });
      expect({ raw, title: plain.title.length > 0, hint: plain.hint.length > 0 }).toEqual({ raw, title: true, hint: true });
      // no unfilled placeholders
      expect({ raw, text: `${plain.title} ${plain.hint}`.includes('{') }).toEqual({ raw, text: false });
    }
    await setLanguage('en');
  });

  test('fills the parameters into the text', async () => {
    await setLanguage('en');
    expect(describeError("required environment variable 'SITE_PASSWORD' is not set.").title).toBe('The script needs the variable SITE_PASSWORD');
    expect(describeError("Invalid start URL #2 'example.com': must be an absolute http(s) URL.").hint).toBe('Start URL #2 (“example.com”) must be a full address starting with http:// or https://.');
    expect(describeError("Selector for field 'Preis' must not be empty.").hint).toBe('Pick “Preis” on the page again, or remove it.');
    expect(describeError('Selector of a ClickStep must not be empty.').hint).toBe('Pick it on the page again, or remove it.');
    expect(describeError("Excel output needs the 'openpyxl' package — install it with: pip install openpyxl").hint).toContain('pip install openpyxl');
    expect(describeError('Request to https://x failed: HTTP 418.').title).toBe('The site answered with an error (HTTP 418)');
  });

  test('"no data" suggests the Browser engine only on the Static engine', async () => {
    await setLanguage('en');
    const raw = 'Script ran without errors but returned no data (output.csv contains only the header row).';
    expect(describeError(raw, { engine: 'Static' }).hint).toContain('try the Browser engine');
    expect(describeError(raw, { engine: 'Browser' }).hint).not.toContain('Browser engine');
    expect(describeError(raw).hint).not.toContain('Browser engine');
  });
});

describe('the error toast', () => {
  let toast;

  beforeEach(async () => {
    jest.resetModules();
    jest.useFakeTimers();
    document.body.innerHTML = `
      <div id="error-toast" class="toast hidden">
        <div class="toast-body">
          <span id="error-toast-message"></span>
          <p id="error-toast-hint" class="hidden"></p>
          <details id="error-toast-details" class="hidden"><summary>Details</summary><pre id="error-toast-details-text"></pre>
            <button id="btn-toast-copy-details" type="button">Copy</button></details>
        </div>
        <button id="btn-report-bug-toast" class="hidden"></button>
        <button id="btn-toast-close" class="hidden"></button>
      </div>`;
    await require('../i18n/i18n').setLanguage('en');
    toast = require('./toast');
    toast.wireErrorToastEvents();
  });
  afterEach(() => { jest.useRealTimers(); });

  const $ = (id) => document.getElementById(id);
  const hidden = (id) => $(id).classList.contains('hidden');

  test('shows title and hint, keeps the original text behind Details, offers Report bug', () => {
    toast.showErrorToast({ title: 'No data was found', hint: 'Check the preview.', details: 'Script ran without errors but returned no data' }, 'Script generation');
    expect($('error-toast-message').textContent).toBe('No data was found');
    expect($('error-toast-hint').textContent).toBe('Check the preview.');
    expect(hidden('error-toast-hint')).toBe(false);
    expect(hidden('error-toast-details')).toBe(false);
    expect($('error-toast-details').open).toBe(false);
    expect($('error-toast-details-text').textContent).toBe('Script ran without errors but returned no data');
    expect(hidden('btn-report-bug-toast')).toBe(false);
    expect(hidden('btn-toast-close')).toBe(false);
    expect(hidden('error-toast')).toBe(false);
  });

  test('"Report bug" gets the original text, not the title', () => {
    toast.showErrorToast({ title: 'No data was found', hint: 'h', details: 'raw companion text' }, 'Script generation');
    expect(toast.getLastError()).toMatchObject({ message: 'raw companion text', context: 'Script generation' });
  });

  test('without a context there is no Report bug and nothing is recorded for a report', () => {
    toast.showErrorToast({ title: 'T', hint: 'h', details: 'raw' }, null);
    expect(hidden('btn-report-bug-toast')).toBe(true);
    expect(toast.getLastError()).toBeNull();
  });

  test('stays until closed instead of disappearing after a few seconds', () => {
    toast.showErrorToast({ title: 'T', hint: 'h', details: 'raw' }, 'Script generation');
    jest.advanceTimersByTime(60000);
    expect(hidden('error-toast')).toBe(false);
    $('btn-toast-close').click();
    expect(hidden('error-toast')).toBe(true);
  });

  test('a later plain toast goes back to the message-only shape and the old auto-hide', () => {
    toast.showErrorToast({ title: 'T', hint: 'h', details: 'raw' }, 'Script generation');
    $('error-toast-details').open = true;
    toast.showToast('Saved', null, 'info');
    expect($('error-toast-message').textContent).toBe('Saved');
    expect(hidden('error-toast-hint')).toBe(true);
    expect(hidden('error-toast-details')).toBe(true);
    expect($('error-toast-details').open).toBe(false);
    expect(hidden('btn-toast-close')).toBe(true);
    jest.advanceTimersByTime(4001);
    expect(hidden('error-toast')).toBe(true);
  });

  test('a plain toast replaced by another resets the timer (the first one cannot hide the second)', () => {
    toast.showToast('first', null);
    jest.advanceTimersByTime(3000);
    toast.showToast('second', null);
    jest.advanceTimersByTime(2000); // 5 s after the first, 2 s after the second
    expect(hidden('error-toast')).toBe(false);
  });

  test('hideToast closes a sticky toast (used before the next Generate)', () => {
    toast.showErrorToast({ title: 'T', hint: 'h', details: 'raw' }, null);
    toast.hideToast();
    expect(hidden('error-toast')).toBe(true);
  });

  test('Copy puts the original text on the clipboard and says so', async () => {
    const writeText = jest.fn().mockResolvedValue();
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText }, configurable: true });
    toast.showErrorToast({ title: 'T', hint: 'h', details: 'raw companion text' }, null);
    $('btn-toast-copy-details').click();
    await Promise.resolve(); await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('raw companion text');
    expect($('btn-toast-copy-details').textContent).toBe('Copied');
    jest.advanceTimersByTime(1600);
    expect($('btn-toast-copy-details').textContent).toBe('Copy');
  });

  test('a clipboard that refuses is swallowed (the text stays selectable)', async () => {
    Object.defineProperty(window.navigator, 'clipboard', { value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) }, configurable: true });
    toast.showErrorToast({ title: 'T', hint: 'h', details: 'raw' }, null);
    $('btn-toast-copy-details').click();
    await Promise.resolve(); await Promise.resolve();
    expect($('btn-toast-copy-details').textContent).toBe('Copy');
  });
});

describe('a failed Generate shows the plain-language message', () => {
  const flush = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

  async function failWith({ engine, response }) {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden"><div id="url-display"></div><div id="fields-list"></div><button id="btn-generate"></button></section>
      <section id="screen-generating" class="hidden"></section>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span><p id="error-toast-hint" class="hidden"></p>
        <details id="error-toast-details" class="hidden"><pre id="error-toast-details-text"></pre></details>
        <button id="btn-report-bug-toast" class="hidden"></button><button id="btn-toast-close" class="hidden"></button>
      </div>`;
    global.chrome = {
      runtime: { onMessage: { addListener: jest.fn() }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        local: { get: jest.fn().mockResolvedValue({ language: 'en' }), set: jest.fn() },
        session: {
          get: jest.fn().mockResolvedValue({ fields: [{ name: 'Preis', selector: '.price', attribute: null }], url: 'https://example.com', ...(engine ? { engine } : {}) }),
          set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn((url) => {
      if (String(url).endsWith('/health')) return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
      if (String(url).endsWith('/generate')) return typeof response === 'function' ? response() : Promise.resolve(response);
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });
    require('./popup');
    await flush();
    document.getElementById('btn-generate').click();
    await flush();
    const $ = (id) => document.getElementById(id);
    return {
      title: $('error-toast-message').textContent,
      hint: $('error-toast-hint').textContent,
      details: $('error-toast-details-text').textContent,
      reportHidden: $('btn-report-bug-toast').classList.contains('hidden'),
      lastError: require('./toast').getLastError(),
    };
  }

  afterEach(() => { delete global.chrome; delete global.fetch; });

  const json = (status, error) => ({ ok: false, status, json: () => Promise.resolve({ error }) });

  test('"no data" on Static: plain title, Browser-engine hint, raw text in Details and in the report', async () => {
    const raw = 'Script ran without errors but returned no data (output.csv contains only the header row).';
    const shown = await failWith({ response: json(422, raw) });
    expect(shown.title).toBe('No data was found');
    expect(shown.hint).toContain('try the Browser engine');
    expect(shown.details).toBe(raw);
    expect(shown.reportHidden).toBe(false);
    expect(shown.lastError.message).toBe(raw);
  });

  test('"no data" on the Browser engine: no Browser suggestion', async () => {
    const shown = await failWith({ engine: 'Browser', response: json(422, 'Script ran without errors but returned no data (x).') });
    expect(shown.title).toBe('No data was found');
    expect(shown.hint).not.toContain('Browser engine');
  });

  test('a configuration the user can fix (400): plain message, no Report bug', async () => {
    const raw = "Invalid start URL #1 'example.com': must be an absolute http(s) URL.";
    const shown = await failWith({ response: json(400, raw) });
    expect(shown.title).toBe("The page address isn't valid");
    expect(shown.details).toBe(raw);
    expect(shown.reportHidden).toBe(true);
  });

  test('the companion not answering during Generate', async () => {
    const shown = await failWith({ response: () => Promise.reject(new TypeError('Failed to fetch')) });
    expect(shown.title).toBe("The companion app can't be reached");
    expect(shown.details).toBe('Failed to fetch');
    expect(shown.reportHidden).toBe(false);
  });

  test('an error nobody has seen before keeps today\'s wording and offers Report bug', async () => {
    const shown = await failWith({ response: json(422, 'Something entirely unexpected happened') });
    expect(shown.title).toBe('Error: Something entirely unexpected happened');
    expect(shown.hint).toBe('');
    expect(shown.reportHidden).toBe(false);
  });
});
