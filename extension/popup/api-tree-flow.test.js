require('./test-support/popup-env');
const {
  buildScrapingConfig,
  STATES,
  serializeApiTree,
  buildApiConfig,
} = require('./popup');

// ── API-tree wiring end-to-end (Issue #54, Phase A5) ────────────────────────
// The full vertical slice from Phase A1–A4 finally exists together: recording
// a 3-level nested response (mirroring Phase 0's catalog fixture) → clicking
// a deep value → confirming the primary field → adding a sibling field at
// the innermost group's own scope via a second, scoped search → adding an
// entirely separate independent root group via a third, unscoped search →
// confirming the whole draft and asserting the exact Groups JSON that would
// be sent to /generate.
describe('API-tree wiring end-to-end (Issue #54, Phase A5)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <button id="btn-add-field"></button>
        <button id="btn-api-capture"></button>
        <p id="api-capture-summary" class="hidden"></p>
        <button id="btn-api-search"></button>
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
        <button id="btn-api-tree-add-root"></button>
        <div id="api-tree-search-panel" class="hidden">
          <p id="api-tree-search-target"></p>
          <ul id="api-tree-search-list"></ul>
        </div>
        <ul id="api-config-segments"></ul>
        <ul id="api-config-query-params"></ul>
        <div id="api-config-parameters"></div>
        <ul id="api-config-headers"></ul>
        <button id="btn-api-config-cancel"></button>
        <button id="btn-api-config-confirm" disabled></button>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="modal-api-group-new" class="hidden">
        <input id="input-api-group-name" />
        <input id="input-api-group-path" />
        <button id="btn-api-group-confirm"></button>
        <button id="btn-api-group-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
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

  // Mirrors Phase 0's catalog fixture (test-pages/api-nested-and-post):
  // categories[*] → subcategories[*] → products[*], three independent
  // repeating levels, plus a wholly unrelated top-level "labels" array.
  const PRIMARY_CANDIDATE = {
    entryId: 1,
    url: 'https://example.com/api/catalog?category=electronics',
    method: 'GET',
    path: 'categories[0].subcategories[0].products[0].title',
    value: 'Smartphone X',
    siblings: [],
    itemsPath: 'categories[0].subcategories[0].products',
    valuePath: 'title',
    treeSkeleton: [
      { kind: 'group', path: 'categories' }, { kind: 'group', path: 'subcategories' },
      { kind: 'group', path: 'products' }, { kind: 'field', path: 'title' },
    ],
    requestHeaders: [],
  };

  test('full flow: primary field → sibling at innermost scope → second root group → confirmed Groups JSON', () => {
    // 1. Record, search, click the deep value, confirm the primary field.
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/catalog' } });
    document.getElementById('btn-api-capture').click();

    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Smartphone X', candidates: [PRIMARY_CANDIDATE] });

    const primaryNameInput = document.querySelector('.api-candidate-field-name');
    primaryNameInput.value = 'Titel';
    primaryNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();

    expect(document.getElementById('screen-api-config').classList.contains('hidden')).toBe(false);
    // categories → subcategories → products → Titel, each auto-named from
    // its own path segment except the user-typed leaf field.
    expect(document.querySelector('[data-path="[0]"] .api-tree-name').value).toBe('categories');
    expect(document.querySelector('[data-path="[0,0]"] .api-tree-name').value).toBe('subcategories');
    expect(document.querySelector('[data-path="[0,0,0]"] .api-tree-name').value).toBe('products');
    expect(document.querySelector('[data-path="[0,0,0,0]"] .api-tree-name').value).toBe('Titel');

    // 2. Add a sibling field ("Preis") at the innermost "products" group's
    // own scope, via a second, scoped search.
    document.querySelector('[data-path="[0,0,0]"] .btn-add-api-subfield').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'START_SELECTION', apiSearch: true, apiScopePath: 'categories[0].subcategories[0].products[0]',
    });
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);

    const siblingCandidate = {
      entryId: 1, url: 'https://example.com/api/catalog?category=electronics', method: 'GET',
      path: 'categories[0].subcategories[0].products[0].price', value: '499',
      siblings: [], itemsPath: 'categories[0].subcategories[0].products', valuePath: 'price',
      treeSkeleton: [
        { kind: 'group', path: 'categories' }, { kind: 'group', path: 'subcategories' },
        { kind: 'group', path: 'products' }, { kind: 'field', path: 'price' },
      ],
      requestHeaders: [],
    };
    capturedListener({ type: 'API_CANDIDATES', target: '499', candidates: [siblingCandidate] });

    expect(document.getElementById('screen-api-config').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('api-tree-search-panel').classList.contains('hidden')).toBe(false);

    const siblingNameInput = document.querySelector('#api-tree-search-list .api-candidate-field-name');
    siblingNameInput.value = 'Preis';
    siblingNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#api-tree-search-list .api-candidate-confirm').click();

    // Inserted directly under "products" — no new group, since the scoped
    // click landed at exactly the already-represented scope.
    expect(document.getElementById('api-tree-search-panel').classList.contains('hidden')).toBe(true);
    expect(document.querySelector('[data-path="[0,0,0,1]"] .api-tree-name').value).toBe('Preis');
    expect(document.querySelector('[data-path="[0,0,0,1]"] .api-tree-path').textContent).toBe('price');

    // 3. Add an entirely separate, independent root group ("labels") via a
    // third, unscoped search.
    document.getElementById('btn-api-tree-add-root').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION', apiSearch: true, apiScopePath: null });

    const secondRootCandidate = {
      entryId: 1, url: 'https://example.com/api/catalog?category=electronics', method: 'GET',
      path: 'labels[0].name', value: 'sale', siblings: [],
      itemsPath: 'labels', valuePath: 'name',
      treeSkeleton: [{ kind: 'group', path: 'labels' }, { kind: 'field', path: 'name' }],
      requestHeaders: [],
    };
    capturedListener({ type: 'API_CANDIDATES', target: 'sale', candidates: [secondRootCandidate] });

    const rootNameInput = document.querySelector('#api-tree-search-list .api-candidate-field-name');
    rootNameInput.value = 'Label';
    rootNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#api-tree-search-list .api-candidate-confirm').click();

    expect(document.querySelector('[data-path="[1]"] .api-tree-name').value).toBe('labels');
    expect(document.querySelector('[data-path="[1,0]"] .api-tree-name').value).toBe('Label');

    // 4. Configure the one required variable URL part, then confirm.
    const toggle = document.querySelectorAll('#api-config-query-params .api-config-part-toggle')[0];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#api-config-query-params .api-config-part-name').value = 'category';
    document.querySelector('#api-config-query-params .api-config-part-name').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-source-kind-radio[value="staticList"]').checked = true;
    document.querySelector('.api-config-source-kind-radio[value="staticList"]').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-static-list').value = 'electronics';
    document.querySelector('.api-config-static-list').dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
    document.getElementById('btn-api-config-confirm').click();

    // Exactly A1's wire shape (IR/ApiConfig.cs's ApiGroup/ApiField, via
    // serializeApiTree/buildApiConfig) — this is verbatim what /generate
    // would receive as ScrapingConfig.Api once mode is switched to 'api'
    // (buildScrapingConfig passes _state.apiConfig through unchanged, see
    // the "API-Mode third mode integration" suite for that wiring proof).
    const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
    expect(persistedConfig).toEqual({
      urlTemplate: 'https://example.com/api/catalog?category={category}',
      groups: [
        {
          name: 'categories', path: 'categories',
          children: [{
            name: 'subcategories', path: 'subcategories',
            children: [{
              name: 'products', path: 'products',
              children: [{ name: 'Titel', path: 'title' }, { name: 'Preis', path: 'price' }],
            }],
          }],
        },
        { name: 'labels', path: 'labels', children: [{ name: 'Label', path: 'name' }] },
      ],
      parameters: [{ name: 'category', source: { kind: 'staticList', values: ['electronics'] } }],
    });
  });

  // modal-api-group-new (Phase A5): unlike a field/root search, a manually
  // added sub-group needs no click at all — name and JSON path are both
  // typed directly (see confirmApiGroupModal's own doc comment).
  function confirmPrimaryCandidateOnly() {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/catalog' } });
    document.getElementById('btn-api-capture').click();
    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Smartphone X', candidates: [PRIMARY_CANDIDATE] });
    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();
  }

  test('"+ Gruppe" opens a name+path modal and inserts an empty group with no click-based search at all', () => {
    confirmPrimaryCandidateOnly();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('[data-path="[0,0,0]"] .btn-add-api-subgroup').click();

    expect(document.getElementById('modal-api-group-new').classList.contains('hidden')).toBe(false);
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    document.getElementById('input-api-group-name').value = 'Varianten';
    document.getElementById('input-api-group-path').value = 'variants';
    document.getElementById('btn-api-group-confirm').click();

    expect(document.getElementById('modal-api-group-new').classList.contains('hidden')).toBe(true);
    // Inserted as the 5th child (index 4) of "products", after Titel.
    const newGroupPath = '[0,0,0,1]';
    expect(document.querySelector(`[data-path="${newGroupPath}"] .api-tree-name`).value).toBe('Varianten');
    expect(document.querySelector(`[data-path="${newGroupPath}"] .api-tree-path`).textContent).toBe('variants');
    expect(document.querySelector(`[data-path="${newGroupPath}"] .btn-add-api-subfield`)).not.toBeNull(); // it's a group, not a field
  });

  test('"+ Gruppe" does nothing until both name and path are filled in', () => {
    confirmPrimaryCandidateOnly();
    document.querySelector('[data-path="[0,0,0]"] .btn-add-api-subgroup').click();

    document.getElementById('input-api-group-name').value = 'Varianten';
    // path left blank
    document.getElementById('btn-api-group-confirm').click();

    expect(document.getElementById('modal-api-group-new').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('[data-path="[0,0,0]"] .api-tree-children > .api-tree-node')).toHaveLength(1); // still just Titel
  });

  test('cancelling the group modal discards the typed name/path', () => {
    confirmPrimaryCandidateOnly();
    document.querySelector('[data-path="[0,0,0]"] .btn-add-api-subgroup').click();
    document.getElementById('input-api-group-name').value = 'Varianten';
    document.getElementById('input-api-group-path').value = 'variants';

    document.getElementById('btn-api-group-cancel').click();

    expect(document.getElementById('modal-api-group-new').classList.contains('hidden')).toBe(true);
    expect(document.querySelectorAll('[data-path="[0,0,0]"] .api-tree-children > .api-tree-node')).toHaveLength(1);
  });
});

// ── API-mode field transforms (Issue #84 follow-up) ─────────────────────────
// Same DOM-mocking pattern as "API-tree wiring end-to-end" above, trimmed to
// what's needed to reach a confirmed one-field API tree, plus the new
// "Transformieren" button/modal markup.

describe('API-mode field transforms (Issue #84 follow-up)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <button id="btn-add-field"></button>
        <button id="btn-api-capture"></button>
        <p id="api-capture-summary" class="hidden"></p>
        <button id="btn-api-search"></button>
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
        <button id="btn-api-tree-add-root"></button>
        <div id="api-tree-search-panel" class="hidden">
          <p id="api-tree-search-target"></p>
          <ul id="api-tree-search-list"></ul>
        </div>
        <ul id="api-config-segments"></ul>
        <ul id="api-config-query-params"></ul>
        <div id="api-config-parameters"></div>
        <ul id="api-config-headers"></ul>
        <button id="btn-api-config-cancel"></button>
        <button id="btn-api-config-confirm" disabled></button>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="modal-api-group-new" class="hidden">
        <input id="input-api-group-name" />
        <input id="input-api-group-path" />
        <button id="btn-api-group-confirm"></button>
        <button id="btn-api-group-cancel"></button>
      </div>
      <div id="modal-api-field-transforms" class="hidden">
        <ul id="api-field-transform-list"></ul>
        <button type="button" id="btn-api-field-transforms-add"></button>
        <p id="api-field-transform-preview" class="transform-preview hidden"></p>
        <button id="btn-api-field-transforms-confirm"></button>
        <button id="btn-api-field-transforms-cancel"></button>
      </div>
      <div id="error-toast" class="hidden">
        <span id="error-toast-message"></span>
        <button id="btn-report-bug-toast" class="hidden"></button>
      </div>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
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

    // Reach a confirmed one-field API tree (categories[*] → Titel).
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api/catalog' } });
    document.getElementById('btn-api-capture').click();
    document.getElementById('btn-api-search').click();
    capturedListener({
      type: 'API_CANDIDATES', target: 'Smartphone X',
      candidates: [{
        entryId: 1, url: 'https://example.com/api/catalog', method: 'GET',
        path: 'categories[0].title', value: 'Smartphone X', siblings: [{ name: 'note', path: 'note', value: null }],
        itemsPath: 'categories', valuePath: 'title',
        treeSkeleton: [{ kind: 'group', path: 'categories' }, { kind: 'field', path: 'title' }],
        requestHeaders: [],
      }],
    });
    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-sibling-chip').click(); // picks "note" (sampleValue: null) too
    document.querySelector('.api-candidate-confirm').click();
  });

  test('a field with no transforms shows the plain "Transformieren" label', () => {
    const btn = document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms');
    expect(btn.textContent).toBe('Transformieren');
  });

  test('clicking "Transformieren" opens the modal with an empty chain', () => {
    document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms').click();

    expect(document.getElementById('modal-api-field-transforms').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#api-field-transform-list .transform-row')).toHaveLength(0);
  });

  test('adding a step and confirming persists it onto the tree node and the button gets a count badge', () => {
    document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms').click();
    document.getElementById('btn-api-field-transforms-add').click();
    const select = document.querySelector('#api-field-transform-list .transform-kind-select');
    select.value = 'toNumber';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-api-field-transforms-confirm').click();

    expect(document.getElementById('modal-api-field-transforms').classList.contains('hidden')).toBe(true);
    const btn = document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms');
    expect(btn.textContent).toBe('Transformieren (1)');
  });

  test('re-opening after confirming shows the previously saved chain', () => {
    document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms').click();
    document.getElementById('btn-api-field-transforms-add').click();
    document.getElementById('btn-api-field-transforms-confirm').click();

    document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms').click();

    expect(document.querySelectorAll('#api-field-transform-list .transform-row')).toHaveLength(1);
  });

  test('cancelling discards the in-progress edit', () => {
    document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms').click();
    document.getElementById('btn-api-field-transforms-add').click();
    document.getElementById('btn-api-field-transforms-cancel').click();

    expect(document.getElementById('modal-api-field-transforms').classList.contains('hidden')).toBe(true);
    const btn = document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms');
    expect(btn.textContent).toBe('Transformieren');
  });

  test('confirming is blocked when a regexExtract step has a blank pattern', () => {
    document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms').click();
    document.getElementById('btn-api-field-transforms-add').click();
    const select = document.querySelector('#api-field-transform-list .transform-kind-select');
    select.value = 'regexExtract';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-api-field-transforms-confirm').click();

    // Still open — nothing was persisted.
    expect(document.getElementById('modal-api-field-transforms').classList.contains('hidden')).toBe(false);
  });

  test('a group node never gets a "Transformieren" button', () => {
    // .api-tree-row is the group's own row (appended before its childUl
    // sibling) — scoping the lookup to it, not the whole <li> subtree, which
    // would also match the nested field's own button.
    const groupRow = document.querySelector('[data-path="[0]"] .api-tree-row');
    expect(groupRow.querySelector('.btn-api-field-transforms')).toBeNull();
  });

  // Issue #147: live preview against the field's own captured sampleValue.
  describe('live preview (Issue #147)', () => {
    test('opening the modal shows a preview against the candidate\'s own value, even with an empty chain', () => {
      document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms').click();

      const preview = document.getElementById('api-field-transform-preview');
      expect(preview.classList.contains('hidden')).toBe(false);
      expect(preview.textContent).toContain('Smartphone X');
    });

    test('the preview updates live as a transform step is added', () => {
      document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms').click();
      document.getElementById('btn-api-field-transforms-add').click();
      const select = document.querySelector('#api-field-transform-list .transform-kind-select');
      select.value = 'regexExtract';
      select.dispatchEvent(new Event('change', { bubbles: true }));
      const patternInput = document.querySelector('#api-field-transform-list .transform-pattern-input');
      patternInput.value = 'phone';
      patternInput.dispatchEvent(new Event('change', { bubbles: true }));

      expect(document.getElementById('api-field-transform-preview').textContent).toContain('phone');
    });

    // The "note" sibling was picked with sampleValue: null (see beforeEach) —
    // a real JSON null, which the runtime turns into an empty string
    // (scraper_api.py.j2's "value is None" check) rather than hiding the field.
    test('a field whose sample value is JSON null shows an empty-result preview, not a hidden one', () => {
      document.querySelector('[data-path="[0,1]"] .btn-api-field-transforms').click();

      const preview = document.getElementById('api-field-transform-preview');
      expect(preview.classList.contains('hidden')).toBe(false);
      expect(preview.textContent).not.toContain('Smartphone X');
    });

    test('closing the modal (confirm or cancel) resets the preview for the next field opened', () => {
      document.querySelector('[data-path="[0,0]"] .btn-api-field-transforms').click();
      document.getElementById('btn-api-field-transforms-cancel').click();

      document.querySelector('[data-path="[0,1]"] .btn-api-field-transforms').click();

      // The "note" field's own (null) sample, not a leftover "Smartphone X".
      expect(document.getElementById('api-field-transform-preview').textContent).not.toContain('Smartphone X');
    });
  });
});
