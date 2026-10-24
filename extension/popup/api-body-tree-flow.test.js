require('./test-support/popup-env');
const {
  STATES,
  allParameterParts,
  syncModeToggleThumbs,
} = require('./popup');

// ── API-Mode request-body tree end-to-end (Issue #55, Phase B4) ────────────
// A confirmed POST candidate's own captured request body isn't attached to
// the candidate object itself (only entryId is) — loadInitialBodyTreeForCandidate
// looks it up in the recorded pool via the same GET_API_CAPTURE_ENTRIES round
// trip the "recorded endpoints" panel/value-list autofill already use, so
// chrome.runtime.sendMessage is mocked to answer that request type directly
// (mirrors the "recorded-endpoints panel" describe block above).

describe('API-Mode request-body tree end-to-end (Issue #55, Phase B4)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const GRAPHQL_ENTRY = {
    id: 1,
    url: 'https://example.com/graphql',
    method: 'POST',
    status: 200,
    contentType: 'application/json',
    requestBody: JSON.stringify({
      query: 'query($category: String) { categoryProducts(category: $category) { items { title } } }',
      variables: { category: 'electronics' },
    }),
    requestBodySkipped: false,
  };

  const GRAPHQL_CANDIDATE = {
    entryId: 1,
    url: 'https://example.com/graphql',
    method: 'POST',
    path: 'data.categoryProducts.items[0].title',
    value: 'Smartphone X',
    siblings: [],
    itemsPath: 'data.categoryProducts.items',
    valuePath: 'title',
    treeSkeleton: [{ kind: 'group', path: 'data.categoryProducts.items' }, { kind: 'field', path: 'title' }],
    requestHeaders: [],
  };

  // Overridable per test (see confirmGraphQlCandidate's `entry` param) —
  // GET_API_CAPTURE_ENTRIES always answers with whatever this currently
  // holds, so a test exercising a skipped/GET entry doesn't need its own
  // separate mock setup.
  let poolEntries;

  beforeEach(async () => {
    jest.resetModules();
    poolEntries = [GRAPHQL_ENTRY];

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <button id="btn-add-field"></button>
        <button id="btn-api-capture"></button>
        <p id="api-capture-summary" class="hidden"></p>
        <button id="btn-api-search" disabled></button>
        <div id="api-candidates-panel" class="hidden">
          <p id="api-candidates-target"></p>
          <ul id="api-candidates-list"></ul>
        </div>
        <div id="api-config-panel" class="hidden">
          <p id="api-config-summary"></p>
          <button id="btn-api-config-discard"></button>
        </div>
      </section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-cancel-selection"></button>
      </section>
      <section id="screen-api-config" class="hidden">
        <ul id="api-tree-root"></ul>
        <ul id="api-config-segments"></ul>
        <ul id="api-config-query-params"></ul>
        <div id="api-config-parameters"></div>
        <div id="api-config-body-section" class="hidden">
          <ul id="body-tree-root"></ul>
        </div>
        <ul id="api-config-headers"></ul>
        <button id="btn-api-config-cancel"></button>
        <button id="btn-api-config-confirm" disabled></button>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="modal-api-body-parameter-new" class="hidden">
        <input id="input-api-body-parameter-name" />
        <button id="btn-api-body-parameter-confirm"></button>
        <button id="btn-api-body-parameter-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn((message) => {
          if (message?.type === 'GET_API_CAPTURE_ENTRIES') return Promise.resolve(poolEntries);
          return Promise.resolve(undefined);
        }),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({ url: 'https://example.com' }),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  async function confirmGraphQlCandidate(candidate = GRAPHQL_CANDIDATE, entry = GRAPHQL_ENTRY) {
    poolEntries = [entry]; // what GET_API_CAPTURE_ENTRIES resolves with, see beforeEach
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry });
    document.getElementById('btn-api-capture').click();

    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Smartphone X', candidates: [candidate] });

    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();

    await flushMicrotasks(); // loadInitialBodyTreeForCandidate's GET_API_CAPTURE_ENTRIES round trip
  }

  function findBodyNodeByLabelPrefix(prefix) {
    return Array.from(document.querySelectorAll('#body-tree-root .body-tree-node'))
      .find(li => li.querySelector('.body-tree-label')?.textContent.startsWith(prefix));
  }

  test('a confirmed POST candidate auto-populates the body tree from its captured request body', async () => {
    await confirmGraphQlCandidate();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'GET_API_CAPTURE_ENTRIES' });
    expect(document.getElementById('api-config-body-section').classList.contains('hidden')).toBe(false);

    const labels = Array.from(document.querySelectorAll('#body-tree-root .body-tree-label')).map(l => l.textContent);
    expect(labels).toEqual(expect.arrayContaining([expect.stringContaining('query:'), 'variables', expect.stringContaining('category:')]));
  });

  test('a GET candidate never fetches the pool for a body and the body section stays hidden', async () => {
    const getCandidate = { ...GRAPHQL_CANDIDATE, method: 'GET' };
    const getEntry = { ...GRAPHQL_ENTRY, method: 'GET' };
    await confirmGraphQlCandidate(getCandidate, getEntry);

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith({ type: 'GET_API_CAPTURE_ENTRIES' });
    expect(document.getElementById('api-config-body-section').classList.contains('hidden')).toBe(true);
  });

  test('a POST candidate whose captured body was skipped (e.g. FormData) leaves the body section hidden', async () => {
    const skippedEntry = { ...GRAPHQL_ENTRY, requestBody: '', requestBodySkipped: true };
    await confirmGraphQlCandidate(GRAPHQL_CANDIDATE, skippedEntry);

    expect(document.getElementById('api-config-body-section').classList.contains('hidden')).toBe(true);
  });

  test('marking variables.category as variable, creating a new parameter, and confirming sends the exact Body/Method wire shape', async () => {
    await confirmGraphQlCandidate();

    // "query" is left untouched — only "variables.category" is marked
    // variable. Re-queried via document (not the pre-toggle row reference)
    // since toggling re-renders the whole body tree from scratch.
    findBodyNodeByLabelPrefix('category').querySelector('.btn-body-to-variable').click();

    const picker = document.querySelector('.body-tree-parameter-picker');
    picker.value = '__new__';
    picker.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.getElementById('modal-api-body-parameter-new').classList.contains('hidden')).toBe(false);
    document.getElementById('input-api-body-parameter-name').value = 'category';
    document.getElementById('btn-api-body-parameter-confirm').click();

    // The new body-only parameter gets its own source card — same markup/
    // behavior as a URL variable part's (see allParameterParts).
    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    const textarea = document.querySelector('.api-config-static-list');
    textarea.value = 'electronics, books';
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
    document.getElementById('btn-api-config-confirm').click();

    const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
    expect(persistedConfig.method).toBe('POST');
    expect(persistedConfig.parameters).toContainEqual({
      name: 'category',
      source: { kind: 'staticList', values: ['electronics', 'books'] },
    });
    expect(persistedConfig.body).toEqual({
      properties: {
        query: {
          kind: 'String',
          stringValue: 'query($category: String) { categoryProducts(category: $category) { items { title } } }',
        },
        variables: { properties: { category: { parameterName: 'category' } } },
      },
    });
  });

  test('reverting the only reference to a body-only parameter back to fixed drops the now-orphaned parameter card', async () => {
    await confirmGraphQlCandidate();
    findBodyNodeByLabelPrefix('category').querySelector('.btn-body-to-variable').click();
    const picker = document.querySelector('.body-tree-parameter-picker');
    picker.value = '__new__';
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('input-api-body-parameter-name').value = 'category';
    document.getElementById('btn-api-body-parameter-confirm').click();
    expect(document.querySelectorAll('#api-config-parameters .api-config-param-card')).toHaveLength(1);

    findBodyNodeByLabelPrefix('category').querySelector('.btn-body-to-fixed').click();

    expect(document.querySelectorAll('#api-config-parameters .api-config-param-card')).toHaveLength(0);
    // Back to a plain literal leaf, value preserved.
    const revertedRow = findBodyNodeByLabelPrefix('category');
    expect(revertedRow.querySelector('.body-tree-label').textContent).toBe('category: "electronics"');
  });

  test('cancelling the new-parameter modal leaves the leaf unbound', async () => {
    await confirmGraphQlCandidate();
    findBodyNodeByLabelPrefix('category').querySelector('.btn-body-to-variable').click();
    const picker = document.querySelector('.body-tree-parameter-picker');
    picker.value = '__new__';
    picker.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-api-body-parameter-cancel').click();

    expect(document.getElementById('modal-api-body-parameter-new').classList.contains('hidden')).toBe(true);
    expect(document.querySelectorAll('#api-config-parameters .api-config-param-card')).toHaveLength(0);
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(true); // still no parameter bound anywhere
  });
});

// ── Issue #140 modernization: animated mode-toggle thumb ────────────────────
// jsdom does no real layout, so offsetWidth/offsetLeft are always 0 — these
// tests stub them (a standard jsdom workaround) to verify the actual
// positioning math instead of just "doesn't throw". Real-browser visual
// verification (Playwright) was done manually for the actual animation.
describe('syncModeToggleThumbs', () => {
  function stubOffsets(el, { width, left }) {
    Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width });
    Object.defineProperty(el, 'offsetLeft', { configurable: true, value: left });
  }

  test('sizes and positions the thumb behind the active button', () => {
    document.body.innerHTML = `
      <div class="mode-toggle">
        <div class="mode-toggle-thumb"></div>
        <button id="a" class="mode-btn active"></button>
        <button id="b" class="mode-btn"></button>
      </div>
    `;
    stubOffsets(document.getElementById('a'), { width: 60, left: 3 });

    syncModeToggleThumbs();

    const thumb = document.querySelector('.mode-toggle-thumb');
    expect(thumb.style.width).toBe('60px');
    expect(thumb.style.transform).toBe('translateX(0px)'); // offsetLeft(3) - 3 = 0
  });

  test('re-syncing after the active button changes moves the thumb', () => {
    document.body.innerHTML = `
      <div class="mode-toggle">
        <div class="mode-toggle-thumb"></div>
        <button id="a" class="mode-btn"></button>
        <button id="b" class="mode-btn active"></button>
      </div>
    `;
    stubOffsets(document.getElementById('b'), { width: 40, left: 67 });

    syncModeToggleThumbs();

    const thumb = document.querySelector('.mode-toggle-thumb');
    expect(thumb.style.width).toBe('40px');
    expect(thumb.style.transform).toBe('translateX(64px)'); // offsetLeft(67) - 3
  });

  test('does nothing for a .mode-toggle with no .active button (e.g. mid-transition)', () => {
    document.body.innerHTML = `
      <div class="mode-toggle">
        <div class="mode-toggle-thumb"></div>
        <button id="a" class="mode-btn"></button>
      </div>
    `;
    expect(() => syncModeToggleThumbs()).not.toThrow();
    expect(document.querySelector('.mode-toggle-thumb').style.width).toBe('');
  });

  test('handles multiple independent .mode-toggle groups on the same screen', () => {
    document.body.innerHTML = `
      <div class="mode-toggle" id="toggle1">
        <div class="mode-toggle-thumb"></div>
        <button class="mode-btn active"></button>
      </div>
      <div class="mode-toggle" id="toggle2">
        <div class="mode-toggle-thumb"></div>
        <button class="mode-btn"></button>
        <button class="mode-btn active"></button>
      </div>
    `;
    stubOffsets(document.querySelector('#toggle1 .mode-btn'), { width: 50, left: 3 });
    stubOffsets(document.querySelector('#toggle2 .mode-btn.active'), { width: 30, left: 53 });

    syncModeToggleThumbs();

    expect(document.querySelector('#toggle1 .mode-toggle-thumb').style.width).toBe('50px');
    expect(document.querySelector('#toggle2 .mode-toggle-thumb').style.width).toBe('30px');
    expect(document.querySelector('#toggle2 .mode-toggle-thumb').style.transform).toBe('translateX(50px)');
  });
});
