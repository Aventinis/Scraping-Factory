// Issue #405: the pagination helpers in the real popup — the page-number
// proposal banner, the "next" / "page 2" link pickers feeding it, the Advanced
// placement of the discovery option, and the restore path after a reopen.
const { buildPaginationConfig } = require('./scraping-config-builder');

describe('pagination helpers in the real popup', () => {
  let capturedListener;
  const flushMicrotasks = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

  const mount = async ({ url = 'https://example.com/list', stored = {} } = {}) => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <label id="pagination-toggle-row"><input type="checkbox" id="toggle-pagination" /></label>
        <div id="pagination-config" class="hidden">
          <div id="pagination-suggestion" class="hidden">
            <span id="pagination-suggestion-text"></span><code id="pagination-suggestion-template"></code>
            <p id="pagination-suggestion-example"></p>
            <button id="btn-pagination-use-template"></button>
          </div>
          <div class="mode-toggle"><button id="btn-pagination-next-link" class="mode-btn"></button><button id="btn-pagination-page-number" class="mode-btn"></button></div>
          <div id="pagination-next-link-fields">
            <span id="pagination-next-link-selected"></span>
            <button id="btn-pick-pagination-next-link"></button>
            <input type="text" id="input-pagination-next-link-selector" />
          </div>
          <div id="pagination-page-number-fields" class="hidden">
            <input type="text" id="input-pagination-url-template" />
            <button id="btn-pick-pagination-page-link"></button>
          </div>
          <input type="number" id="input-pagination-max-pages" />
        </div>
        <details id="discovered-urls-advanced">
          <summary></summary>
          <label id="discovered-urls-toggle-row"><input type="checkbox" id="toggle-discovered-urls" /></label>
          <div id="discovered-urls-config" class="hidden"></div>
        </details>
        <textarea id="input-additional-urls"></textarea>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" /><div id="dom-tree-wrapper" class="hidden"><ul id="dom-tree-root"></ul></div>
        <button id="btn-cancel-selection"></button>
      </section>
      <div id="error-toast" class="hidden"><span id="error-toast-message"></span></div>`;
    global.chrome = {
      runtime: { onMessage: { addListener: (fn) => { capturedListener = fn; } }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url }])) },
      storage: { session: { get: jest.fn().mockResolvedValue({ mode: 'flat', ...stored }), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) } },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();
  };

  const persisted = () => chrome.storage.session.set.mock.calls.at(-1)[0];
  const banner = () => document.getElementById('pagination-suggestion');
  const enable = () => {
    const toggle = document.getElementById('toggle-pagination');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
  };
  const pick = async (buttonId, message) => {
    document.getElementById(buttonId).click();
    capturedListener({ type: 'ELEMENT_SELECTED', url: 'https://example.com/list', ...message });
    await flushMicrotasks();
  };

  test('a start URL that already says ?page=1 is proposed as a template, and one click applies it', async () => {
    await mount({ url: 'https://example.com/list?page=1' });
    expect(banner().classList.contains('hidden')).toBe(true); // not while pagination is off
    enable();
    expect(banner().classList.contains('hidden')).toBe(false);
    expect(document.getElementById('pagination-suggestion-template').textContent).toBe('https://example.com/list?page={page}');
    expect(document.getElementById('pagination-suggestion-example').textContent).toContain('https://example.com/list?page=2');

    document.getElementById('btn-pagination-use-template').click();
    expect(persisted().pagination).toMatchObject({ enabled: true, kind: 'pageNumber', urlTemplate: 'https://example.com/list?page={page}' });
    expect(banner().classList.contains('hidden')).toBe(true); // already applied
    expect(document.getElementById('input-pagination-url-template').value).toBe('https://example.com/list?page={page}');
  });

  test('nothing is proposed for a URL without a page number', async () => {
    await mount({ url: 'https://example.com/list' });
    enable();
    expect(banner().classList.contains('hidden')).toBe(true);
  });

  test('picking the "next" link learns the pattern from its address', async () => {
    await mount({ url: 'https://example.com/list' });
    enable();
    await pick('btn-pick-pagination-next-link', { selector: 'a.next', attributes: { href: '/list?page=2' } });

    expect(persisted().pagination).toMatchObject({ nextLinkSelector: 'a.next', linkHref: 'https://example.com/list?page=2' });
    expect(document.getElementById('pagination-next-link-selected').textContent).toBe('a.next');
    expect(banner().classList.contains('hidden')).toBe(false);
    expect(document.getElementById('pagination-suggestion-template').textContent).toBe('{url}?page={page}');
  });

  test('the page-2 link picker only stores the address; a non-link shows a warning', async () => {
    await mount({ url: 'https://example.com/list' });
    enable();
    await pick('btn-pick-pagination-page-link', { selector: 'li.page2 a', attributes: { href: '?page=2' } });
    expect(persisted().pagination).toMatchObject({ linkHref: 'https://example.com/list?page=2' });
    expect(persisted().pagination.nextLinkSelector).toBe(''); // the selector is not touched
    expect(document.getElementById('pagination-suggestion-template').textContent).toBe('{url}?page={page}');

    await pick('btn-pick-pagination-page-link', { selector: 'span.page', attributes: {} });
    expect(persisted().pagination.linkHref).toBe('');
    expect(document.getElementById('error-toast').classList.contains('hidden')).toBe(false);
  });

  test('a template without {url} is not offered once there are several start pages', async () => {
    await mount({ url: 'https://example.com/list?page=1', stored: { additionalStartUrls: ['https://example.com/other'] } });
    enable();
    expect(banner().classList.contains('hidden')).toBe(true);

    // …but one that keeps {url} still is
    await mount({ url: 'https://example.com/list', stored: { additionalStartUrls: ['https://example.com/other'] } });
    enable();
    await pick('btn-pick-pagination-next-link', { selector: 'a.next', attributes: { href: '/list?page=2' } });
    expect(banner().classList.contains('hidden')).toBe(false);
    expect(document.getElementById('pagination-suggestion-template').textContent).toBe('{url}?page={page}');
  });

  test('the learned link address never reaches the request', () => {
    const wire = buildPaginationConfig({ enabled: true, kind: 'pageNumber', nextLinkSelector: 'a.next', urlTemplate: '{url}?page={page}', maxPages: 5, linkHref: 'https://example.com/list?page=2' });
    expect(wire).toEqual({ kind: 'pageNumber', urlTemplate: '{url}?page={page}', maxPages: 5 });
  });

  test('"Discover start URLs" sits under Advanced: hidden for API mode, opened once when it is already on', async () => {
    await mount({ stored: { mode: 'api' } });
    expect(document.getElementById('discovered-urls-advanced').classList.contains('hidden')).toBe(true);

    await mount({ stored: { discoveredUrls: { enabled: true, pageUrl: 'https://example.com/menu', linkSelector: 'nav a', maxUrls: 100 } } });
    const advanced = document.getElementById('discovered-urls-advanced');
    expect(advanced.classList.contains('hidden')).toBe(false);
    expect(advanced.open).toBe(true);

    await mount();
    expect(document.getElementById('discovered-urls-advanced').open).toBe(false);
  });
});

describe('restoring a pagination link pick after the panel was reopened', () => {
  const { restorePendingSelection } = require('./session-restore');
  const { STATES } = require('./api-config');
  let state;
  let bridge;

  beforeEach(() => {
    state = { current: STATES.IDLE, groups: [], browserActions: [], pagination: { enabled: true, kind: 'nextLink', nextLinkSelector: '', urlTemplate: '', maxPages: 50 }, url: 'https://example.com/list' };
    bridge = {
      getState: () => state,
      setState: jest.fn((current, patch = {}) => { state = { ...state, current, ...patch }; }),
      patchState: jest.fn((patch = {}) => { state = { ...state, ...patch }; }),
    };
    global.chrome = { storage: { session: { remove: jest.fn().mockResolvedValue(undefined), set: jest.fn().mockResolvedValue(undefined) } } };
  });

  test('a picked "next" link writes both the selector and its address', async () => {
    const handled = await restorePendingSelection(bridge, { selectionKind: 'pagination', pendingSelector: 'a.next', pendingElementAttributes: { href: '/list?page=2' } });
    expect(handled).toBe(true);
    expect(state.pagination).toMatchObject({ nextLinkSelector: 'a.next', linkHref: 'https://example.com/list?page=2' });
    expect(state.current).toBe(STATES.IDLE);
  });

  test('a picked page-2 link writes only the address', async () => {
    const handled = await restorePendingSelection(bridge, { selectionKind: 'paginationPageLink', pendingSelector: 'li a', pendingElementAttributes: { href: '?page=2' } });
    expect(handled).toBe(true);
    expect(state.pagination.linkHref).toBe('https://example.com/list?page=2');
    expect(state.pagination.nextLinkSelector).toBe('');
  });
});
