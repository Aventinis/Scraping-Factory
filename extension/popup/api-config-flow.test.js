require('./test-support/popup-env');
const {
  STATES,
  parseUrlTemplateParts,
} = require('./popup');

describe('API-Mode config screen end-to-end (Issue #53 Phase 5)', () => {
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
        <ul id="api-config-headers"></ul>
        <button id="btn-api-config-cancel"></button>
        <button id="btn-api-config-confirm" disabled></button>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
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

  const PRIMARY_CANDIDATE = {
    entryId: 1,
    url: 'https://example.com/api/items/42?category=Elektronik',
    method: 'GET',
    path: 'data.items[0].name',
    value: 'Titel-Test',
    siblings: [],
    itemsPath: 'data.items',
    valuePath: 'name',
    treeSkeleton: [{ kind: 'group', path: 'data.items' }, { kind: 'field', path: 'name' }],
    requestHeaders: [{ name: 'Authorization', value: 'Bearer secret' }],
  };

  // Drives the popup from a fresh IDLE screen up to a rendered API_CONFIG
  // screen with one confirmed field — the common setup every test below
  // builds on.
  function confirmPrimaryCandidate() {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api' } });
    document.getElementById('btn-api-capture').click();

    document.getElementById('btn-api-search').click();
    capturedListener({ type: 'API_CANDIDATES', target: 'Titel-Test', candidates: [PRIMARY_CANDIDATE] });

    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();
  }

  test('confirming a candidate lands on the API_CONFIG screen with the field and decomposed URL', () => {
    confirmPrimaryCandidate();

    expect(document.getElementById('screen-api-config').classList.contains('hidden')).toBe(false);
    // A single top-level match (PRIMARY_CANDIDATE.path has one array level)
    // renders as a one-node-deep tree — the auto-named "items" group (from
    // its own path's last segment) wrapping the user-named "Titel" field.
    const groupRow = document.querySelector('[data-path="[0]"] > .api-tree-row');
    expect(groupRow.querySelector('.api-tree-name').value).toBe('items');
    const fieldRow = document.querySelector('[data-path="[0,0]"] > .api-tree-row');
    expect(fieldRow.querySelector('.api-tree-name').value).toBe('Titel');
    expect(fieldRow.querySelector('.api-tree-path').textContent).toBe('name');

    const segRows = document.querySelectorAll('#api-config-segments .api-config-part-row');
    expect(Array.from(segRows).map(r => r.querySelector('.api-config-part-value').textContent)).toEqual(['/api', '/items', '/42']);
    const queryRows = document.querySelectorAll('#api-config-query-params .api-config-part-row');
    expect(queryRows[0].querySelector('.api-config-part-value').textContent).toBe('category=Elektronik');
  });

  test('renaming a field on the API_CONFIG screen carries the new name through to the confirmed apiConfig', () => {
    confirmPrimaryCandidate();

    const nameInput = document.querySelector('[data-path="[0,0]"] .api-tree-name');
    nameInput.value = 'Produktname';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('[data-path="[0,0]"] .api-tree-name').value).toBe('Produktname');

    const toggle = document.querySelector('#api-config-segments .api-config-part-row:nth-child(3) .api-config-part-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#api-config-segments .api-config-part-name').value = 'id';
    document.querySelector('#api-config-segments .api-config-part-name').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-source-kind-radio[value="staticList"]').checked = true;
    document.querySelector('.api-config-source-kind-radio[value="staticList"]').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-static-list').value = '42';
    document.querySelector('.api-config-static-list').dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-api-config-confirm').click();

    expect(chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig.groups).toEqual([
      { name: 'items', path: 'data.items', children: [{ name: 'Produktname', path: 'name' }] },
    ]);
  });

  test('a blanked-out field name disables "Übernehmen" until it is filled in again', () => {
    confirmPrimaryCandidate();
    const toggle = document.querySelector('#api-config-segments .api-config-part-row:nth-child(3) .api-config-part-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('#api-config-segments .api-config-part-name').value = 'id';
    document.querySelector('#api-config-segments .api-config-part-name').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-source-kind-radio[value="staticList"]').checked = true;
    document.querySelector('.api-config-source-kind-radio[value="staticList"]').dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-static-list').value = '42';
    document.querySelector('.api-config-static-list').dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);

    const nameInput = document.querySelector('[data-path="[0,0]"] .api-tree-name');
    nameInput.value = '   ';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(true);
  });

  test('"Alle auswählen" picks every sibling in one click, toggling back to none on a second click', () => {
    document.getElementById('btn-api-capture').click();
    capturedListener({ type: 'API_CAPTURE_ENTRY', entry: { id: 1, url: 'https://example.com/api' } });
    document.getElementById('btn-api-capture').click();
    document.getElementById('btn-api-search').click();

    const candidateWithSiblings = {
      ...PRIMARY_CANDIDATE,
      siblings: [
        { name: 'price', path: 'items[0].price', value: 3.5 },
        { name: 'unit', path: 'items[0].unit', value: 'kg' },
      ],
    };
    capturedListener({ type: 'API_CANDIDATES', target: 'Titel-Test', candidates: [candidateWithSiblings] });

    const chips = document.querySelectorAll('.api-sibling-chip');
    expect(Array.from(chips).some(c => c.classList.contains('picked'))).toBe(false);

    document.querySelector('.api-sibling-select-all').click();
    expect(Array.from(chips).every(c => c.classList.contains('picked'))).toBe(true);
    expect(document.querySelector('.api-sibling-select-all').textContent).toBe('Alle abwählen');

    document.querySelector('.api-sibling-select-all').click();
    expect(Array.from(chips).some(c => c.classList.contains('picked'))).toBe(false);
    expect(document.querySelector('.api-sibling-select-all').textContent).toBe('Alle auswählen');

    // Confirming with all siblings picked carries both into the field list.
    document.querySelector('.api-sibling-select-all').click();
    const nameInput = document.querySelector('.api-candidate-field-name');
    nameInput.value = 'Titel';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.api-candidate-confirm').click();

    // The auto-named "items" group's own name input is also an .api-tree-name
    // — [data-path^="[0,"] scopes this to its direct children only.
    const fieldNames = Array.from(document.querySelectorAll('[data-path^="[0,"] .api-tree-name')).map(i => i.value);
    expect(fieldNames).toEqual(['Titel', 'price', 'unit']);
  });

  test('toggling a path segment variable reveals a name input and, once named, a parameter card', () => {
    confirmPrimaryCandidate();

    const toggle = document.querySelector('#api-config-segments .api-config-part-row:nth-child(3) .api-config-part-toggle');
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));

    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    expect(nameInput.dataset.partId).toBe('path:2');
    // The card appears as soon as the part is variable — before a name is
    // typed it just shows a placeholder title.
    expect(document.querySelector('#api-config-parameters .api-config-param-card').textContent).toContain('(noch unbenannt)');

    nameInput.value = 'id';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    const card = document.querySelector('#api-config-parameters .api-config-param-card');
    expect(card.dataset.partId).toBe('path:2');
    expect(card.textContent).toContain('id');
  });

  test('choosing Werteliste renders a textarea, and typing values keeps "Übernehmen" gated until present', () => {
    confirmPrimaryCandidate();
    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    nameInput.value = 'id';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));

    const textarea = document.querySelector('.api-config-static-list');
    expect(textarea).not.toBeNull();
    textarea.value = '42, 43';
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
  });

  test('the discovery round-trip: search, receive scoped candidates, confirm one as the source', () => {
    confirmPrimaryCandidate();

    // Query param "category" already carries its own key as a default name
    // (see parseUrlTemplateParts) — toggling it variable is enough on its
    // own, no name input needed.
    const queryToggle = document.querySelector('#api-config-query-params .api-config-part-toggle');
    queryToggle.checked = true;
    queryToggle.dispatchEvent(new Event('change', { bubbles: true }));

    const discoveryRadio = document.querySelector('.api-config-source-kind-radio[value="discovery"]');
    discoveryRadio.checked = true;
    discoveryRadio.dispatchEvent(new Event('change', { bubbles: true }));

    chrome.runtime.sendMessage.mockClear();
    document.querySelector('.api-config-discovery-search').click();
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION', apiSearch: true });
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);

    const discoveryCandidate = {
      entryId: 2, url: 'https://example.com/api/categories', method: 'GET',
      path: 'data[0].name', value: 'Elektronik', siblings: [],
      itemsPath: 'data', valuePath: 'name', requestHeaders: [],
    };
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.cat', path: [] }); // sent alongside, must not open the field modal
    capturedListener({ type: 'API_CANDIDATES', target: 'Elektronik', candidates: [discoveryCandidate] });

    expect(document.getElementById('modal-field-name').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('screen-api-config').classList.contains('hidden')).toBe(false);

    const confirmDiscoveryBtn = document.querySelector('.api-config-discovery-confirm');
    expect(confirmDiscoveryBtn.dataset.partId).toBe('query:category');
    confirmDiscoveryBtn.click();

    expect(document.getElementById('btn-api-config-confirm').disabled).toBe(false);
    expect(document.querySelector('.api-candidates-target').textContent).toContain('https://example.com/api/categories');
  });

  test('a cancelled discovery search returns to API_CONFIG, not IDLE', () => {
    confirmPrimaryCandidate();
    const queryToggle = document.querySelector('#api-config-query-params .api-config-part-toggle');
    queryToggle.checked = true;
    queryToggle.dispatchEvent(new Event('change', { bubbles: true }));
    const discoveryRadio = document.querySelector('.api-config-source-kind-radio[value="discovery"]');
    discoveryRadio.checked = true;
    discoveryRadio.dispatchEvent(new Event('change', { bubbles: true }));

    document.querySelector('.api-config-discovery-search').click();
    document.getElementById('btn-cancel-selection').click();

    expect(document.getElementById('screen-api-config').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(true);
  });

  test('header adoption: including a header via an environment variable', () => {
    confirmPrimaryCandidate();

    const include = document.querySelector('.api-config-header-include');
    include.checked = true;
    include.dispatchEvent(new Event('change', { bubbles: true }));

    const envRadio = document.querySelector('.api-config-header-mode-radio[value="env"]');
    envRadio.checked = true;
    envRadio.dispatchEvent(new Event('change', { bubbles: true }));

    const envInput = document.querySelector('.api-config-env-name');
    envInput.value = 'API_TOKEN';
    envInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.api-config-env-name').value).toBe('API_TOKEN');
  });

  test('"Abbrechen" discards the draft and returns to IDLE', () => {
    confirmPrimaryCandidate();
    document.getElementById('btn-api-config-cancel').click();

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('api-config-panel').classList.contains('hidden')).toBe(true);
  });

  test('"Übernehmen" assembles the final ApiConfig, persists it, and shows the summary on IDLE', () => {
    confirmPrimaryCandidate();

    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    nameInput.value = 'id';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    const textarea = document.querySelector('.api-config-static-list');
    textarea.value = '42';
    textarea.dispatchEvent(new Event('change', { bubbles: true }));

    chrome.storage.session.set.mockClear();
    document.getElementById('btn-api-config-confirm').click();

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('api-config-panel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('api-config-summary').textContent).toContain('1 Feld(er)');
    expect(document.getElementById('api-config-summary').textContent).toContain('1 Parameter');

    const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
    expect(persistedConfig).toEqual({
      urlTemplate: 'https://example.com/api/items/{id}?category=Elektronik',
      groups: [{ name: 'items', path: 'data.items', children: [{ name: 'Titel', path: 'name' }] }],
      parameters: [{ name: 'id', source: { kind: 'staticList', values: ['42'] } }],
      // No header was ever included (default headerDecisions is empty) — the
      // key is omitted entirely, matching the optional wire field.
    });
    expect(persistedConfig).not.toHaveProperty('headers');
  });

  test('"Verwerfen" on the summary panel clears the confirmed apiConfig', () => {
    confirmPrimaryCandidate();
    const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
    toggle.checked = true;
    toggle.dispatchEvent(new Event('change', { bubbles: true }));
    const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
    nameInput.value = 'id';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    const kindRadio = document.querySelector('.api-config-source-kind-radio[value="staticList"]');
    kindRadio.checked = true;
    kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    document.querySelector('.api-config-static-list').value = '42';
    document.querySelector('.api-config-static-list').dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('btn-api-config-confirm').click();

    document.getElementById('btn-api-config-discard').click();

    expect(document.getElementById('api-config-panel').classList.contains('hidden')).toBe(true);
  });

  // ── BrowserDiscoverySource (Issue #216) ─────────────────────────────────
  describe('Browser discovery parameter source', () => {
    function makeVariableWithBrowserDiscovery() {
      confirmPrimaryCandidate();
      const toggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
      toggle.checked = true;
      toggle.dispatchEvent(new Event('change', { bubbles: true }));
      const nameInput = document.querySelector('#api-config-segments .api-config-part-name');
      nameInput.value = 'category';
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
      const kindRadio = document.querySelector('.api-config-source-kind-radio[value="browserDiscovery"]');
      kindRadio.checked = true;
      kindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    test('picking "Browser discovery" prefills the discovery URL from the current page and renders no actions yet', () => {
      makeVariableWithBrowserDiscovery();

      expect(document.querySelector('.api-discovery-url').value).toBe('https://example.com');
      expect(document.querySelectorAll('.browser-action-card').length).toBe(0);
    });

    test('adding a Click action renders a pick-selector button; clicking it starts selection', () => {
      makeVariableWithBrowserDiscovery();

      document.querySelector('.btn-add-discovery-action[data-kind="click"]').click();
      expect(document.querySelectorAll('.browser-action-card').length).toBe(1);

      const pickBtn = document.querySelector('.btn-pick-discovery-action-selector');
      expect(pickBtn).not.toBeNull();
      pickBtn.click();

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION' });
      expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);
    });

    test('ELEMENT_SELECTED writes the picked selector into the right action and returns to API_CONFIG', () => {
      makeVariableWithBrowserDiscovery();
      document.querySelector('.btn-add-discovery-action[data-kind="click"]').click();
      document.querySelector('.btn-pick-discovery-action-selector').click();

      capturedListener({ type: 'ELEMENT_SELECTED', selector: '#load-more', framePath: null });

      expect(document.getElementById('screen-api-config').classList.contains('hidden')).toBe(false);
      expect(document.querySelector('.browser-action-card .field-selector').textContent).toBe('#load-more');
    });

    test('removing an action drops it from the list', () => {
      makeVariableWithBrowserDiscovery();
      document.querySelector('.btn-add-discovery-action[data-kind="click"]').click();
      expect(document.querySelectorAll('.browser-action-card').length).toBe(1);

      document.querySelector('.btn-remove-discovery-action').click();

      expect(document.querySelectorAll('.browser-action-card').length).toBe(0);
    });

    test('confirming sends a browserDiscovery source with the DiscoveryUrl and serialized actions', () => {
      makeVariableWithBrowserDiscovery();
      document.querySelector('.btn-add-discovery-action[data-kind="click"]').click();
      document.querySelector('.btn-pick-discovery-action-selector').click();
      capturedListener({ type: 'ELEMENT_SELECTED', selector: '#load-more', framePath: null });

      document.getElementById('btn-api-config-confirm').click();

      const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
      expect(persistedConfig.parameters).toEqual([
        {
          name: 'category',
          source: { kind: 'browserDiscovery', discoveryUrl: 'https://example.com', actions: [{ kind: 'click', selector: '#load-more' }] },
        },
      ]);
    });

    // DiscoveryUrl stays freely editable after the prefill (e.g. for a
    // dedicated listing page different from wherever the clicked data
    // point itself lives) — see setApiConfigSourceKind's own doc comment.
    test('the discovery URL can be edited after the prefill', () => {
      makeVariableWithBrowserDiscovery();
      const urlInput = document.querySelector('.api-discovery-url');
      urlInput.value = 'https://example.com/angebote';
      urlInput.dispatchEvent(new Event('change', { bubbles: true }));

      document.getElementById('btn-api-config-confirm').click();

      const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
      expect(persistedConfig.parameters[0].source.discoveryUrl).toBe('https://example.com/angebote');
      // No actions were ever added — omitted entirely, not an empty array.
      expect(persistedConfig.parameters[0].source).not.toHaveProperty('actions');
    });

    // Issue #289
    test('a Scroll action\'s scrollStepPx is sent when set', () => {
      makeVariableWithBrowserDiscovery();
      document.querySelector('.btn-add-discovery-action[data-kind="scroll"]').click();

      const stepInput = document.querySelector('.discovery-action-scroll-step-px');
      expect(stepInput.value).toBe(''); // blank = null = today's jump-to-bottom default
      stepInput.value = '400';
      stepInput.dispatchEvent(new Event('change', { bubbles: true }));

      document.getElementById('btn-api-config-confirm').click();

      const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
      expect(persistedConfig.parameters[0].source.actions[0].scrollStepPx).toBe(400);
    });

    test('a Scroll action left with a blank scrollStepPx omits the key entirely', () => {
      makeVariableWithBrowserDiscovery();
      document.querySelector('.btn-add-discovery-action[data-kind="scroll"]').click();

      document.getElementById('btn-api-config-confirm').click();

      const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
      expect(persistedConfig.parameters[0].source.actions[0]).not.toHaveProperty('scrollStepPx');
    });
  });

  // ── Chained parameter discovery (Issue #217) ────────────────────────────
  describe('Chained parameter discovery', () => {
    // First parameter (path segment "42" → "category", nothing earlier to
    // reference); second (the query param → "week") can reference it.
    function makeTwoBrowserDiscoveryParameters() {
      confirmPrimaryCandidate();

      const pathToggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
      pathToggle.checked = true;
      pathToggle.dispatchEvent(new Event('change', { bubbles: true }));
      const pathNameInput = document.querySelector('#api-config-segments .api-config-part-name');
      pathNameInput.value = 'category';
      pathNameInput.dispatchEvent(new Event('change', { bubbles: true }));
      const pathKindRadio = document.querySelector('[data-part-id="path:2"].api-config-source-kind-radio[value="browserDiscovery"]');
      pathKindRadio.checked = true;
      pathKindRadio.dispatchEvent(new Event('change', { bubbles: true }));

      const queryToggle = document.querySelector('#api-config-query-params .api-config-part-toggle');
      queryToggle.checked = true;
      queryToggle.dispatchEvent(new Event('change', { bubbles: true }));
      const queryNameInput = document.querySelector('#api-config-query-params .api-config-part-name');
      queryNameInput.value = 'week';
      queryNameInput.dispatchEvent(new Event('change', { bubbles: true }));
      const queryKindRadio = document.querySelector('[data-part-id="query:category"].api-config-source-kind-radio[value="browserDiscovery"]');
      queryKindRadio.checked = true;
      queryKindRadio.dispatchEvent(new Event('change', { bubbles: true }));
    }

    test('the first (earliest) parameter renders no insert-parameter picker at all', () => {
      makeTwoBrowserDiscoveryParameters();
      expect(document.querySelector('[data-part-id="path:2"].api-param-placeholder-select')).toBeNull();
    });

    test('a later parameter offers every earlier-declared parameter as an insertable placeholder', () => {
      makeTwoBrowserDiscoveryParameters();
      const select = document.querySelector('[data-part-id="query:category"].api-param-placeholder-select');
      expect(select).not.toBeNull();
      expect(Array.from(select.options).map(o => o.value)).toEqual(['', 'category']);
    });

    // Regression test: picking from the <select> moves focus to the select
    // itself, never the text input — inserting at "wherever the input's own
    // selectionStart happens to default to for a never-focused field" would
    // put the placeholder at the very start (even before "https://"), not
    // where it's actually useful. Asserts the exact resulting value (not
    // just .toContain) specifically to catch that.
    test('picking a parameter appends its placeholder at the end of the discovery URL and persists it', () => {
      makeTwoBrowserDiscoveryParameters();
      const urlInput = document.querySelectorAll('.api-discovery-url')[1]; // query:category's own card
      expect(urlInput.value).toBe('https://example.com'); // prefilled from the current page, never focused
      const select = document.querySelector('[data-part-id="query:category"].api-param-placeholder-select');
      select.value = 'category';
      select.dispatchEvent(new Event('change', { bubbles: true }));

      document.getElementById('btn-api-config-confirm').click();

      const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
      const weekParam = persistedConfig.parameters.find(p => p.name === 'week');
      expect(weekParam.source.discoveryUrl).toBe('https://example.com{category}');
    });

    // DiscoverySource's own UrlTemplate is ordinarily read-only (derived via
    // the search-and-confirm flow, see 'the discovery round-trip' above) —
    // "Edit template" temporarily swaps it for an editable input so a
    // concrete segment can be manually replaced with an earlier parameter's
    // own placeholder.
    function makeDiscoverySourceWithEarlierParameter() {
      confirmPrimaryCandidate();

      const pathToggle = document.querySelectorAll('#api-config-segments .api-config-part-toggle')[2];
      pathToggle.checked = true;
      pathToggle.dispatchEvent(new Event('change', { bubbles: true }));
      const pathNameInput = document.querySelector('#api-config-segments .api-config-part-name');
      pathNameInput.value = 'category';
      pathNameInput.dispatchEvent(new Event('change', { bubbles: true }));
      const pathKindRadio = document.querySelector('[data-part-id="path:2"].api-config-source-kind-radio[value="staticList"]');
      pathKindRadio.checked = true;
      pathKindRadio.dispatchEvent(new Event('change', { bubbles: true }));

      const queryToggle = document.querySelector('#api-config-query-params .api-config-part-toggle');
      queryToggle.checked = true;
      queryToggle.dispatchEvent(new Event('change', { bubbles: true }));
      const queryNameInput = document.querySelector('#api-config-query-params .api-config-part-name');
      queryNameInput.value = 'week';
      queryNameInput.dispatchEvent(new Event('change', { bubbles: true }));
      const discoveryRadio = document.querySelector('[data-part-id="query:category"].api-config-source-kind-radio[value="discovery"]');
      discoveryRadio.checked = true;
      discoveryRadio.dispatchEvent(new Event('change', { bubbles: true }));

      document.querySelector('.api-config-discovery-search').click();
      capturedListener({
        type: 'API_CANDIDATES', target: 'Elektronik',
        candidates: [{
          entryId: 2, url: 'https://example.com/api/categories', method: 'GET',
          path: 'data[0].name', value: 'Elektronik', siblings: [],
          itemsPath: 'data', valuePath: 'name', requestHeaders: [],
        }],
      });
      document.querySelector('.api-config-discovery-confirm').click();
    }

    test('no "Edit template" button is shown before a template has ever been found', () => {
      makeTwoBrowserDiscoveryParameters(); // neither parameter is a DiscoverySource here
      expect(document.querySelector('.btn-discovery-template-edit')).toBeNull();
    });

    test('"Edit template" swaps the read-only summary for an editable input seeded with the current template', () => {
      makeDiscoverySourceWithEarlierParameter();

      expect(document.querySelector('.api-discovery-url-template')).toBeNull();
      document.querySelector('.btn-discovery-template-edit').click();

      const templateInput = document.querySelector('.api-discovery-url-template');
      expect(templateInput).not.toBeNull();
      expect(templateInput.value).toBe('https://example.com/api/categories');
      expect(document.querySelector('[data-part-id="query:category"].api-param-placeholder-select')).not.toBeNull();
    });

    test('editing and confirming the template updates UrlTemplate but leaves ItemsPath/ValuePath untouched', () => {
      makeDiscoverySourceWithEarlierParameter();
      document.querySelector('.btn-discovery-template-edit').click();

      const templateInput = document.querySelector('.api-discovery-url-template');
      templateInput.value = 'https://example.com/api/categories/{category}';
      templateInput.dispatchEvent(new Event('change', { bubbles: true }));

      document.getElementById('btn-api-config-confirm').click();

      const persistedConfig = chrome.storage.session.set.mock.calls.at(-1)[0].apiConfig;
      const weekParam = persistedConfig.parameters.find(p => p.name === 'week');
      expect(weekParam.source.urlTemplate).toBe('https://example.com/api/categories/{category}');
      expect(weekParam.source.itemsPath).toBe('data');
      expect(weekParam.source.valuePath).toBe('name');
    });

    test('"Done" returns to the read-only summary', () => {
      makeDiscoverySourceWithEarlierParameter();
      document.querySelector('.btn-discovery-template-edit').click();
      expect(document.querySelector('.api-discovery-url-template')).not.toBeNull();

      document.querySelector('.btn-discovery-template-done').click();

      expect(document.querySelector('.api-discovery-url-template')).toBeNull();
      expect(document.querySelector('.api-candidates-target')).not.toBeNull();
    });
  });
});
