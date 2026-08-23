// Mock chrome and fetch before requiring the module so that the async init()
// (wireEvents + storage read + checkCompanion) runs safely without real APIs.
global.chrome = {
  runtime: {
    onMessage: { addListener: jest.fn() },
    sendMessage: jest.fn(),
  },
  tabs: { query: jest.fn() },
  storage: {
    session: {
      get:    jest.fn().mockResolvedValue({}),
      set:    jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
  },
};
global.fetch = jest.fn().mockResolvedValue({ ok: false });

const {
  buildScrapingConfig, addField, removeField, escapeHtml, renderFields, STATES,
  formatTreeLabel, renderDomTree, highlightHover, highlightSelected,
  formatLogSection, buildGithubIssueUrl, setLastError, buildVerificationErrorMessage,
} = require('./popup');

// ── buildScrapingConfig ───────────────────────────────────────────────────────

describe('buildScrapingConfig', () => {
  test('produces correct structure with multiple fields', () => {
    const result = buildScrapingConfig('https://example.com', [
      { name: 'Titel', selector: 'h1' },
      { name: 'Preis', selector: '.price' },
    ]);
    expect(result).toEqual({
      version: '1',
      url: 'https://example.com',
      fields: [
        { name: 'Titel', selector: 'h1',     attribute: null },
        { name: 'Preis', selector: '.price', attribute: null },
      ],
      outputFormat: 'Csv',
    });
  });

  test('handles empty fields array', () => {
    const result = buildScrapingConfig('https://example.com', []);
    expect(result.fields).toEqual([]);
    expect(result.url).toBe('https://example.com');
    expect(result.outputFormat).toBe('Csv');
  });

  test('preserves explicit attribute value', () => {
    const result = buildScrapingConfig('https://x.com', [
      { name: 'Link', selector: 'a', attribute: 'href' },
    ]);
    expect(result.fields[0].attribute).toBe('href');
  });
});

// ── addField ─────────────────────────────────────────────────────────────────

describe('addField', () => {
  test('appends field with null attribute', () => {
    const result = addField([], 'Titel', 'h1');
    expect(result).toEqual([{ name: 'Titel', selector: 'h1', attribute: null }]);
  });

  test('does not mutate original array', () => {
    const fields = [{ name: 'A', selector: '.a', attribute: null }];
    addField(fields, 'B', '.b');
    expect(fields).toHaveLength(1);
  });

  test('appends to existing fields', () => {
    const fields = [{ name: 'A', selector: '.a', attribute: null }];
    const result = addField(fields, 'B', '.b');
    expect(result).toHaveLength(2);
    expect(result[1].name).toBe('B');
  });
});

// ── removeField ───────────────────────────────────────────────────────────────

describe('removeField', () => {
  const base = [
    { name: 'A', selector: '.a' },
    { name: 'B', selector: '.b' },
    { name: 'C', selector: '.c' },
  ];

  test('removes field at given index', () => {
    const result = removeField(base, 1);
    expect(result).toHaveLength(2);
    expect(result.map(f => f.name)).toEqual(['A', 'C']);
  });

  test('removes first field', () => {
    const result = removeField(base, 0);
    expect(result[0].name).toBe('B');
  });

  test('removes last field', () => {
    const result = removeField(base, 2);
    expect(result[result.length - 1].name).toBe('B');
  });

  test('does not mutate original array', () => {
    removeField(base, 0);
    expect(base).toHaveLength(3);
  });
});

// ── escapeHtml ────────────────────────────────────────────────────────────────

describe('escapeHtml', () => {
  test('escapes <, >, &, and "', () => {
    expect(escapeHtml('<b class="x">a & b</b>')).toBe(
      '&lt;b class=&quot;x&quot;&gt;a &amp; b&lt;/b&gt;'
    );
  });

  test('passes through plain text unchanged', () => {
    expect(escapeHtml('Produkttitel')).toBe('Produkttitel');
  });

  test('coerces non-string to string first', () => {
    expect(escapeHtml(42)).toBe('42');
  });
});

// ── renderFields ─────────────────────────────────────────────────────────────

describe('renderFields', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="fields-list"></div>';
  });

  test('sets full selector as title attribute so it is visible despite CSS truncation', () => {
    const longSelector = '#vorspeisen > ul.menu-list > li.item > span.name';
    renderFields([{ name: 'Titel', selector: longSelector, attribute: null }]);

    const selectorEl = document.querySelector('.field-selector');
    expect(selectorEl.title).toBe(longSelector);
    expect(selectorEl.textContent).toBe(longSelector);
  });

  test('sets full name as title attribute too', () => {
    renderFields([{ name: 'Ein sehr langer Feldname', selector: 'h1', attribute: null }]);

    const nameEl = document.querySelector('.field-name');
    expect(nameEl.title).toBe('Ein sehr langer Feldname');
  });
});

// ── STATES export ─────────────────────────────────────────────────────────────

test('STATES contains expected keys', () => {
  const expected = ['CHECKING_COMPANION', 'COMPANION_ERROR', 'IDLE', 'SELECTING', 'GENERATING', 'DONE'];
  expected.forEach(key => expect(STATES).toHaveProperty(key));
});

// ── formatTreeLabel ───────────────────────────────────────────────────────────

describe('formatTreeLabel', () => {
  test('tag only when no id or classes', () => {
    expect(formatTreeLabel({ tag: 'p', id: null, classes: [] })).toBe('p');
  });

  test('appends #id', () => {
    expect(formatTreeLabel({ tag: 'section', id: 'main', classes: [] })).toBe('section#main');
  });

  test('appends .class.class for multiple classes', () => {
    expect(formatTreeLabel({ tag: 'li', id: null, classes: ['card', 'active'] })).toBe('li.card.active');
  });

  test('combines id and classes', () => {
    expect(formatTreeLabel({ tag: 'div', id: 'wrap', classes: ['a'] })).toBe('div#wrap.a');
  });
});

// ── DOM tree rendering & highlighting ────────────────────────────────────────

describe('renderDomTree / highlightHover / highlightSelected', () => {
  const sampleTree = {
    tag: 'body', id: null, classes: [], path: [],
    children: [
      {
        tag: 'section', id: 'main', classes: [], path: [0],
        children: [
          { tag: 'p', id: null, classes: ['a'], path: [0, 0], children: [] },
        ],
      },
    ],
  };

  beforeEach(() => {
    document.body.innerHTML = '<ul id="dom-tree-root"></ul>';
    renderDomTree(sampleTree);
  });

  test('renders one <li> per tree node with the node label', () => {
    const nodes = document.querySelectorAll('.dom-tree-node');
    expect(nodes).toHaveLength(3);
    expect(document.querySelector('[data-path="[0]"]').textContent).toContain('section#main');
  });

  test('nested nodes start collapsed', () => {
    const childUl = document.querySelector('[data-path="[0]"] > .dom-tree-children');
    expect(childUl.classList.contains('hidden')).toBe(true);
  });

  test('highlightHover marks the matching row and expands its ancestors', () => {
    highlightHover([0, 0]);
    const row = document.querySelector('[data-path="[0,0]"] > .dom-tree-row');
    expect(row.classList.contains('hover')).toBe(true);

    const ancestorUl = document.querySelector('[data-path="[0]"] > .dom-tree-children');
    expect(ancestorUl.classList.contains('hidden')).toBe(false);
  });

  test('highlightHover clears the previous hover highlight', () => {
    highlightHover([0]);
    highlightHover([0, 0]);
    const previousRow = document.querySelector('[data-path="[0]"] > .dom-tree-row');
    expect(previousRow.classList.contains('hover')).toBe(false);
  });

  test('highlightSelected marks the row as selected', () => {
    highlightSelected([0, 0]);
    const row = document.querySelector('[data-path="[0,0]"] > .dom-tree-row');
    expect(row.classList.contains('selected')).toBe(true);
  });

  test('highlightSelected replaces a previous selection', () => {
    highlightSelected([0]);
    highlightSelected([0, 0]);
    const previousRow = document.querySelector('[data-path="[0]"] > .dom-tree-row');
    expect(previousRow.classList.contains('selected')).toBe(false);
  });
});

// ── SELECTION_UNAVAILABLE ────────────────────────────────────────────────────
// Regression coverage: chrome.tabs.sendMessage(START_SELECTION) rejects when
// the active tab has no content script (chrome://, Web Store, PDF viewer, a
// page open since before the extension reloaded, …). The side panel must
// fall back to IDLE with an explanation instead of being stuck on
// "Klicke ein Element an…" forever.

describe('SELECTION_UNAVAILABLE handling', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden"></section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-add-field"></button>
      </section>
      <div id="error-toast" class="hidden"></div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn() },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    require('./popup');
    await flushMicrotasks();

    document.getElementById('btn-add-field').click(); // → STATES.SELECTING
  });

  test('falls back to IDLE and shows a toast', () => {
    capturedListener({ type: 'SELECTION_UNAVAILABLE', reason: 'no content script' });

    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.textContent).toContain('nicht möglich');
  });
});

// ── DOM tree loading timeout ─────────────────────────────────────────────────
// Regression coverage: a lost/never-arriving DOM_TREE response used to leave
// the "Lade DOM-Baum…" spinner stuck forever. A timeout must now surface an
// error instead.

describe('DOM tree loading timeout', () => {
  let capturedListener;

  // init() awaits chrome.storage.session.get() and then fetch() (mocked,
  // resolved) before settling on COMPANION_ERROR — flush those microtasks
  // with real timers before switching to fake ones for the timeout itself.
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle"></section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-add-field"></button>
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
      </section>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn() },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: false });

    require('./popup');
    await flushMicrotasks();

    document.getElementById('btn-add-field').click(); // → STATES.SELECTING
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test('shows an error if no DOM_TREE response arrives within the timeout', () => {
    const toggle = document.getElementById('toggle-dom-view');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    expect(document.getElementById('dom-tree-error').classList.contains('hidden')).toBe(true);

    jest.advanceTimersByTime(5000);

    expect(document.getElementById('dom-tree-error').classList.contains('hidden')).toBe(false);
  });

  test('a DOM_TREE response before the timeout clears loading without an error', () => {
    const toggle = document.getElementById('toggle-dom-view');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    capturedListener({
      type: 'DOM_TREE',
      tree: { tag: 'body', id: null, classes: [], path: [], children: [] },
      truncated: false,
    });
    jest.advanceTimersByTime(5000);

    expect(document.getElementById('dom-tree-error').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('dom-tree-loading').classList.contains('hidden')).toBe(true);
  });

  test('a DOM_TREE error response surfaces immediately without waiting for the timeout', () => {
    const toggle = document.getElementById('toggle-dom-view');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change'));

    capturedListener({ type: 'DOM_TREE', tree: null, truncated: false, error: 'boom' });

    expect(document.getElementById('dom-tree-error').classList.contains('hidden')).toBe(false);
  });
});

// ── Bug reporting ─────────────────────────────────────────────────────────────

describe('formatLogSection', () => {
  test('lists entries with timestamp, event and JSON data', () => {
    const entries = [{ ts: '2024-01-01T00:00:00.000Z', event: 'FOO', data: { a: 1 } }];
    const section = formatLogSection('Side Panel', entries);
    expect(section).toContain('## Side Panel');
    expect(section).toContain('2024-01-01T00:00:00.000Z FOO {"a":1}');
  });

  test('omits the data suffix when data is null', () => {
    const entries = [{ ts: 't', event: 'FOO', data: null }];
    expect(formatLogSection('X', entries)).toBe('## X\nt FOO\n');
  });

  test('shows a placeholder for an empty or missing list', () => {
    expect(formatLogSection('Empty', [])).toBe('## Empty\n(keine Einträge)\n');
    expect(formatLogSection('Missing', null)).toBe('## Missing\n(keine Einträge)\n');
  });
});

describe('buildGithubIssueUrl', () => {
  test("points at the repo's new-issue page", () => {
    const url = buildGithubIssueUrl('some report text');
    expect(url.startsWith('https://github.com/Aventinis/Scraping-Factory/issues/new?')).toBe(true);
  });

  test('uses the last reported error as the title when set', () => {
    setLastError('HTTP 500', 'Skript-Generierung');
    const url = buildGithubIssueUrl('report');
    expect(url).toContain(`title=${encodeURIComponent('Fehler: HTTP 500')}`);
  });

  test('embeds the full report body when short', () => {
    const url = buildGithubIssueUrl('a short report');
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('a short report');
    expect(body).not.toContain('gekürzt');
  });

  test('truncates and adds a note when the report is very long', () => {
    const longReport = 'x'.repeat(10000);
    const url = buildGithubIssueUrl(longReport);
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('gekürzt');
    expect(body.length).toBeLessThan(longReport.length);
  });
});

// ── buildVerificationErrorMessage ────────────────────────────────────────────
// The companion generates and actually runs the script against the live
// page before returning it; /generate responds 422 with an `error` message
// describing why that run failed (page unreachable, script raised an
// exception, or it ran cleanly but produced no data at all).

describe('buildVerificationErrorMessage', () => {
  test('uses the error message from the response', () => {
    const msg = buildVerificationErrorMessage({
      error: 'Skript lief fehlerfrei, hat aber keine Daten zurückgegeben (output.csv enthält nur die Kopfzeile).',
    });
    expect(msg).toBe('Skript lief fehlerfrei, hat aber keine Daten zurückgegeben (output.csv enthält nur die Kopfzeile).');
  });

  test('passes through a script-crash error message', () => {
    const msg = buildVerificationErrorMessage({ error: 'Skript (python3) wurde mit Fehler beendet (Exit-Code 1): Traceback...' });
    expect(msg).toBe('Skript (python3) wurde mit Fehler beendet (Exit-Code 1): Traceback...');
  });

  test('handles a missing/empty response gracefully', () => {
    expect(buildVerificationErrorMessage(null)).toBe('Verifikation der Konfiguration fehlgeschlagen.');
    expect(buildVerificationErrorMessage(undefined)).toBe('Verifikation der Konfiguration fehlgeschlagen.');
    expect(buildVerificationErrorMessage({})).toBe('Verifikation der Konfiguration fehlgeschlagen.');
  });
});

describe('generate() surfaces companion verification failures', () => {
  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="fields-list"></div>
        <button id="btn-generate"></button>
      </section>
      <section id="screen-generating" class="hidden"></section>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: jest.fn() },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get: jest.fn().mockResolvedValue({
            fields: [{ name: 'Preis', selector: '.price', attribute: null }],
            url: 'https://example.com',
          }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };

    global.fetch = jest.fn((url) => {
      if (String(url).endsWith('/health')) return Promise.resolve({ ok: true });
      if (String(url).endsWith('/generate')) {
        return Promise.resolve({
          ok: false,
          status: 422,
          json: () => Promise.resolve({
            error: 'Skript lief fehlerfrei, hat aber keine Daten zurückgegeben (output.csv enthält nur die Kopfzeile).',
          }),
        });
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`));
    });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE, fields restored from storage
  });

  test('shows a toast with the verification error and offers to report it', async () => {
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(document.getElementById('error-toast-message').textContent).toContain('keine Daten zurückgegeben');
    expect(document.getElementById('btn-report-bug-toast').classList.contains('hidden')).toBe(false);
  });
});

describe('reportBug end-to-end via the COMPANION_ERROR screen button', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-error" class="hidden">
        <button id="btn-report-bug-error"></button>
      </section>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn().mockResolvedValue({ background: [{ ts: 't', event: 'SW_EVENT', data: null }], content: [], contentError: null }),
        getManifest: jest.fn().mockReturnValue({ version: '0.1.0-test' }),
      },
      tabs: { query: jest.fn(), create: jest.fn() },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockRejectedValue(new Error('Companion nicht erreichbar'));
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    require('./popup');
    await flushMicrotasks(); // → STATES.COMPANION_ERROR, lastReportedError set
  });

  test('downloads a bug-report.log and opens a prefilled GitHub issue tab', async () => {
    document.getElementById('btn-report-bug-error').click();
    await flushMicrotasks();

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);

    const { url } = chrome.tabs.create.mock.calls[0][0];
    expect(url).toContain('https://github.com/Aventinis/Scraping-Factory/issues/new');
    expect(decodeURIComponent(url)).toContain('Companion nicht erreichbar');
    expect(decodeURIComponent(url)).toContain('SW_EVENT');
  });
});
