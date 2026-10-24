require('./test-support/popup-env');
const {
  STATES,
  serializeGroupTree,
} = require('./popup');

// ── formatTreeLabel ───────────────────────────────────────────────────────────


// ── SELECTION_UNAVAILABLE ────────────────────────────────────────────────────
// Regression coverage: chrome.tabs.sendMessage(START_SELECTION) rejects when
// the active tab has no content script (chrome://, Web Store, PDF viewer, a
// page open since before the extension reloaded, …). The side panel must
// fall back to IDLE with an explanation instead of being stuck on
// "Klicke ein Element an…" forever.

describe('SELECTION_UNAVAILABLE handling', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden"></section>
      <section id="screen-selecting" class="hidden">
        <button id="btn-add-field"></button>
      </section>
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

  test('falls back to IDLE and shows a toast (no content script — hard error, offers to report)', () => {
    capturedListener({ type: 'SELECTION_UNAVAILABLE', reason: 'no content script' });

    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(true);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.textContent).toContain('nicht möglich');
    expect(document.getElementById('btn-report-bug-toast').classList.contains('hidden')).toBe(false);
  });

  // Issue #137 follow-up: a scope selector that's retried and still not
  // found (content-script.ts's retryScopeSelector, tagged unavailableKind)
  // can have entirely page-specific causes outside the extension's control
  // (confirmed via a real report: a class only present while the element is
  // actually hovered) — shown as a warning, not a hard error, and without
  // "Report bug" so a page-specific, expected situation doesn't get
  // reported as a plugin bug.
  test('falls back to IDLE and shows a warning, not an error, for a retried-and-still-missing scope selector', () => {
    capturedListener({
      type: 'SELECTION_UNAVAILABLE',
      reason: "Container-Selektor '.foo' findet kein Element auf dieser Seite.",
      unavailableKind: 'scopeSelectorNotFound',
    });

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.classList.contains('toast-warn')).toBe(true);
    expect(toast.textContent).not.toContain('nicht möglich'); // the softer, distinct wording, not the hard-error one
    expect(document.getElementById('btn-report-bug-toast').classList.contains('hidden')).toBe(true);
  });
});

// ── SELECTION_CLICK_OUT_OF_SCOPE (Issue #167) ────────────────────────────────
// Unlike SELECTION_UNAVAILABLE above (a hard failure), a click outside every
// instance of the container being edited must NOT kick the user back to
// IDLE — selection stays active, only a brief toast hint is shown.

describe('SELECTION_CLICK_OUT_OF_SCOPE handling', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
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

  test('shows a toast but stays on the selecting screen', () => {
    capturedListener({ type: 'SELECTION_CLICK_OUT_OF_SCOPE' });

    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(true);

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.classList.contains('toast-warn')).toBe(true);
  });

  test('is ignored outside the SELECTING state', () => {
    // Leave SELECTING first (any transition works; SELECTION_UNAVAILABLE is
    // a convenient one already wired) and reset the toast it shows along
    // the way, so the assertion below is only about this message's own guard.
    capturedListener({ type: 'SELECTION_UNAVAILABLE', reason: 'x' }); // → falls back to IDLE
    document.getElementById('error-toast').classList.add('hidden');

    capturedListener({ type: 'SELECTION_CLICK_OUT_OF_SCOPE' });

    expect(document.getElementById('error-toast').classList.contains('hidden')).toBe(true);
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
    await new Promise((resolve) => setTimeout(resolve, 0));
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


// buildGithubIssueUrl's fixed strings (title/body copy) are always English,
// independent of the popup's selected UI language — see CLAUDE.md's
// Language policy: bug reports are a maintainer-facing GitHub artifact, not
// conversational UI a multilingual end user reads.

// ── buildVerificationErrorMessage ────────────────────────────────────────────
// The companion generates and actually runs the script against the live
// page before returning it; /generate responds 422 with an `error` message
// describing why that run failed (page unreachable, script raised an
// exception, or it ran cleanly but produced no data at all).


// ── Saved configuration history (Issue #141) ────────────────────────────────
// Full flows against the companion's /configs endpoints, same DOM-mocking
// pattern as the generate() integration tests above.



// ── Container-Mode integration ───────────────────────────────────────────────
// Full flows through the real state machine (mode switch, modal → click-select
// → tree update), mirroring the existing SELECTION_UNAVAILABLE/generate()
// integration tests' DOM-mocking pattern.

describe('Container-Mode integration', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active"></button>
          <button id="btn-mode-container" class="mode-btn"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <div id="container-mode-section" class="hidden">
          <ul id="group-tree-root"></ul>
          <button id="btn-add-root-container"></button>
        </div>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
        <button id="btn-cancel-selection"></button>
      </section>
      <div id="modal-container-new" class="hidden">
        <input id="input-container-name" />
        <input type="radio" name="container-type" id="radio-container-single" checked />
        <input type="radio" name="container-type" id="radio-container-repeating" />
        <button id="btn-container-confirm"></button>
        <button id="btn-container-cancel"></button>
      </div>
      <div id="modal-field-extended" class="hidden">
        <input id="input-field-extended-name" />
        <select id="select-field-mode">
          <option value="text">Text</option>
          <option value="attribute">Attribute</option>
          <option value="exists">Exists</option>
        </select>
        <div id="field-attribute-row" class="hidden">
          <select id="select-field-attribute"></select>
        </div>
        <button id="btn-field-extended-confirm"></button>
        <button id="btn-field-extended-cancel"></button>
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
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  test('switching to container mode clears fields, switching back clears groups', () => {
    document.getElementById('btn-add-field'); // sanity: flat section present
    document.getElementById('btn-mode-container').click();

    expect(document.getElementById('container-mode-section').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('flat-mode-section').classList.contains('hidden')).toBe(true);

    document.getElementById('btn-mode-flat').click();
    expect(document.getElementById('flat-mode-section').classList.contains('hidden')).toBe(false);
  });

  test('root container add: modal first, then click-select inserts the node with no further modal', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();

    expect(document.getElementById('modal-container-new').classList.contains('hidden')).toBe(false);

    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('radio-container-repeating').checked = true;
    document.getElementById('btn-container-confirm').click();

    // avoidId: true — a "Wiederholend" container's own selector must be
    // able to match more than once, which an id-based selector never can.
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION', scopeSelector: null, avoidId: true });
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);

    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();

    // Back to IDLE, node inserted, no modal shown for the container case.
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('modal-field-extended').classList.contains('hidden')).toBe(true);
    const row = document.querySelector('#group-tree-root .group-tree-row');
    expect(row.querySelector('.group-tree-name').value).toBe('Vorspeisen');
    expect(row.textContent).toContain('(wiederholend)');
  });

  test('field add within a container: click-select first, then the extended modal, scoped to the parent selector', async () => {
    // Seed one root container so we have a parent to add a field into.
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    // avoidId: false — "Vorspeisen" here was added as "Einzeln" (default),
    // so its own selector only needs to match once.
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'START_SELECTION', scopeSelector: 'section.menu-category', avoidId: false,
    });

    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'h2.category-title' });
    await flushMicrotasks();

    // Now the extended modal shows (unlike the container case above).
    expect(document.getElementById('modal-field-extended').classList.contains('hidden')).toBe(false);

    document.getElementById('input-field-extended-name').value = 'Titel';
    document.getElementById('btn-field-extended-confirm').click();

    const rows = document.querySelectorAll('#group-tree-root .group-tree-row');
    expect(rows[1].querySelector('.group-tree-name').value).toBe('Titel');
    expect(rows[1].textContent).toContain('— Text');
  });

  test('choosing "Attribut" reveals the attribute picker, and an actual attribute is required to confirm', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();

    document.querySelector('.btn-add-subfield').click();
    // No attributes at all on this pick — the picker has nothing to offer
    // (see the "no attributes found" placeholder option), matching the "must
    // actively have something to pick" requirement the old free-text input's
    // own "required" check already enforced.
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'a.link' });
    await flushMicrotasks();

    const modeSelect = document.getElementById('select-field-mode');
    modeSelect.value = 'attribute';
    modeSelect.dispatchEvent(new Event('change'));
    expect(document.getElementById('field-attribute-row').classList.contains('hidden')).toBe(false);

    document.getElementById('input-field-extended-name').value = 'Link';
    document.getElementById('btn-field-extended-confirm').click();
    // No attribute available to pick — should not have been added.
    expect(document.querySelectorAll('#group-tree-root .group-tree-row')).toHaveLength(1);
  });

  // Issue #213 follow-up: the attribute value comes from picking one of the
  // element's own real attributes (populateAttributeSelect), not typing one.
  test('picking an attribute from the picker adds the field with that attribute', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'a.link', attributes: { href: '/produkt/42' } });
    await flushMicrotasks();

    document.getElementById('select-field-mode').value = 'attribute';
    document.getElementById('select-field-mode').dispatchEvent(new Event('change'));
    // href is the only attribute present, so the picker already has it
    // selected (see guessUrlAttribute) — no further pick needed here.
    expect(document.getElementById('select-field-attribute').value).toBe('href');

    document.getElementById('input-field-extended-name').value = 'Link';
    document.getElementById('btn-field-extended-confirm').click();
    const rows = document.querySelectorAll('#group-tree-root .group-tree-row');
    expect(rows[1].querySelector('.group-tree-name').value).toBe('Link');
    expect(rows[1].textContent).toContain('— Attribut: href');
  });

  // Regression: an id-bearing element used to always short-circuit to an id
  // selector, which can only ever match once — silently starving every
  // repetition but the first. avoidId must propagate down from a repeating
  // ancestor even to a nested container that is itself "Einzeln".
  test('nested container add inherits avoidId:true from a repeating ancestor, even if itself "Einzeln"', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Kategorien';
    document.getElementById('radio-container-repeating').checked = true;
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subcontainer').click();
    document.getElementById('input-container-name').value = 'Badge';
    // "Einzelnes Element" is the modal's default — left unchanged here.
    document.getElementById('btn-container-confirm').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'START_SELECTION', scopeSelector: 'section.menu-category', avoidId: true,
    });
  });

  // Issue #42, Phase 7: a framed container/field shows the iframe badge in
  // the tree and carries framePath through to the wire format.
  test('a root container picked inside an iframe shows the iframe badge and serializes with framePath', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Preisvergleich';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#price-box', framePath: ['#price-widget'] });
    await flushMicrotasks();

    const badge = document.querySelector('#group-tree-root .frame-badge');
    expect(badge).not.toBeNull();
    expect(badge.title).toContain('#price-widget');

    expect(serializeGroupTree([{
      kind: 'group', name: 'Preisvergleich', selector: '#price-box', repeating: false,
      children: [], framePath: ['#price-widget'],
    }])[0].framePath).toEqual(['#price-widget']);
  });

  test('a root container picked at the top level shows no iframe badge', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();

    expect(document.querySelector('#group-tree-root .frame-badge')).toBeNull();
  });

  // Issue #177: rename/reorder a node's own tree row after it's already
  // been created, instead of only ever being nameable/orderable at add time.
  async function addRootContainer(name, selector) {
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = name;
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector });
    await flushMicrotasks();
  }

  test('renaming a tree node via its own row input persists into state', async () => {
    document.getElementById('btn-mode-container').click();
    await addRootContainer('Vorspeisen', 'section.starters');

    const nameInput = document.querySelector('#group-tree-root .group-tree-name');
    nameInput.value = 'Hauptgerichte';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Re-render (triggered by the change handler's setState) rebuilds the
    // row from scratch — re-querying it proves the new name came from
    // _state.groups, not just the input's own unmanaged DOM value.
    expect(document.querySelector('#group-tree-root .group-tree-name').value).toBe('Hauptgerichte');
  });

  test('blanking a tree node\'s name input reverts it instead of saving an empty name', async () => {
    document.getElementById('btn-mode-container').click();
    await addRootContainer('Vorspeisen', 'section.starters');

    const nameInput = document.querySelector('#group-tree-root .group-tree-name');
    nameInput.value = '   ';
    nameInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(nameInput.value).toBe('Vorspeisen');
  });

  test('move buttons reorder two sibling nodes', async () => {
    document.getElementById('btn-mode-container').click();
    await addRootContainer('Vorspeisen', 'section.starters');
    await addRootContainer('Hauptgerichte', 'section.mains');

    let names = () => [...document.querySelectorAll('#group-tree-root .group-tree-name')].map(el => el.value);
    expect(names()).toEqual(['Vorspeisen', 'Hauptgerichte']);

    document.querySelectorAll('.btn-group-move-down')[0].click();
    expect(names()).toEqual(['Hauptgerichte', 'Vorspeisen']);

    document.querySelectorAll('.btn-group-move-up')[1].click();
    expect(names()).toEqual(['Vorspeisen', 'Hauptgerichte']);
  });

  test('the top row\'s move-up and the bottom row\'s move-down are disabled', async () => {
    document.getElementById('btn-mode-container').click();
    await addRootContainer('Vorspeisen', 'section.starters');
    await addRootContainer('Hauptgerichte', 'section.mains');

    const rows = document.querySelectorAll('#group-tree-root .group-tree-row');
    expect(rows[0].querySelector('.btn-group-move-up').disabled).toBe(true);
    expect(rows[0].querySelector('.btn-group-move-down').disabled).toBe(false);
    expect(rows[1].querySelector('.btn-group-move-up').disabled).toBe(false);
    expect(rows[1].querySelector('.btn-group-move-down').disabled).toBe(true);
  });
});

// ── Live selector match-count preview (Issue #85) ───────────────────────────
// Same DOM-mocking pattern as "Container-Mode integration" above, plus the
// match-count hint elements and the toast markup (container-group creation
// has no modal of its own, so its feedback goes through showToast instead).

describe('Live selector match-count preview (Issue #85)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div class="mode-toggle">
          <button id="btn-mode-flat" class="mode-btn active"></button>
          <button id="btn-mode-container" class="mode-btn"></button>
        </div>
        <div id="flat-mode-section">
          <div id="fields-list"></div>
          <button id="btn-add-field"></button>
        </div>
        <div id="container-mode-section" class="hidden">
          <ul id="group-tree-root"></ul>
          <button id="btn-add-root-container"></button>
        </div>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
        <button id="btn-cancel-selection"></button>
      </section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <p id="field-name-match-count" class="match-count-hint hidden"></p>
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="modal-container-new" class="hidden">
        <input id="input-container-name" />
        <input type="radio" name="container-type" id="radio-container-single" checked />
        <input type="radio" name="container-type" id="radio-container-repeating" />
        <button id="btn-container-confirm"></button>
        <button id="btn-container-cancel"></button>
      </div>
      <div id="modal-field-extended" class="hidden">
        <input id="input-field-extended-name" />
        <select id="select-field-mode">
          <option value="text">Text</option>
          <option value="attribute">Attribute</option>
          <option value="exists">Exists</option>
        </select>
        <div id="field-attribute-row" class="hidden">
          <select id="select-field-attribute"></select>
        </div>
        <p id="field-extended-match-count" class="match-count-hint hidden"></p>
        <button id="btn-field-extended-confirm"></button>
        <button id="btn-field-extended-cancel"></button>
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
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  test('a flat field pick shows the match count next to the name input', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item', matchCount: 12 });

    const hint = document.getElementById('field-name-match-count');
    expect(hint.classList.contains('hidden')).toBe(false);
    expect(hint.textContent).toBe('12 Element(e) gefunden');
    expect(hint.classList.contains('warn')).toBe(false);
  });

  test('a flat field pick matching nothing shows the hint with warn styling', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.does-not-exist', matchCount: 0 });

    const hint = document.getElementById('field-name-match-count');
    expect(hint.classList.contains('hidden')).toBe(false);
    expect(hint.textContent).toBe('0 Element(e) gefunden');
    expect(hint.classList.contains('warn')).toBe(true);
  });

  test('a pick with no matchCount (content script could not compute it) keeps the hint hidden', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' }); // no matchCount field at all

    expect(document.getElementById('field-name-match-count').classList.contains('hidden')).toBe(true);
  });

  // Issue: the side panel's tracked _state.url only ever gets set once at
  // panel-load/companion-connection time (chrome.tabs.query, see this
  // describe block's own beforeEach: "https://example.com") — there's no
  // chrome.tabs.onUpdated listener anywhere in this extension, so it
  // silently goes stale if the same tab navigates to a different page while
  // the panel stays open. message-router.ts self-corrects the instant a
  // selection carries a different page's own url.
  describe('stale tracked URL self-correction', () => {
    test('updates the tracked url and shows an info toast when the picked element came from a different page', () => {
      document.getElementById('btn-add-field').click();
      capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item', url: 'https://example.com/other-page' });

      const toast = document.getElementById('error-toast');
      expect(toast.classList.contains('hidden')).toBe(false);
      expect(toast.classList.contains('toast-info')).toBe(true);
      expect(document.getElementById('error-toast-message').textContent).toContain('https://example.com/other-page');

      // Cancel back to the idle screen — #url-display re-renders from the
      // now-corrected _state.url.
      document.getElementById('btn-field-cancel').click();
      expect(document.getElementById('url-display').textContent).toBe('https://example.com/other-page');
    });

    test('does nothing when the picked element came from the already-tracked page', () => {
      document.getElementById('btn-add-field').click();
      capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item', url: 'https://example.com' });

      expect(document.getElementById('error-toast').classList.contains('hidden')).toBe(true);
      document.getElementById('btn-field-cancel').click();
      expect(document.getElementById('url-display').textContent).toBe('https://example.com');
    });

    test('does nothing when the message carries no url at all (older content-script parity)', () => {
      document.getElementById('btn-add-field').click();
      capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });

      expect(document.getElementById('error-toast').classList.contains('hidden')).toBe(true);
    });
  });

  test('a container field pick shows the match count in the extended modal', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category', matchCount: 4 });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'h2.category-title', matchCount: 1 });
    await flushMicrotasks();

    const hint = document.getElementById('field-extended-match-count');
    expect(hint.classList.contains('hidden')).toBe(false);
    expect(hint.textContent).toBe('1 Element(e) gefunden');
  });

  test('creating a root container shows a match-count toast instead (no confirmation modal for containers)', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('radio-container-repeating').checked = true; // 7 matches fit "repeating" (Issue #398 would warn for "single")
    document.getElementById('btn-container-confirm').click();

    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category', matchCount: 7 });
    await flushMicrotasks();

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('hidden')).toBe(false);
    expect(toast.classList.contains('toast-info')).toBe(true);
    expect(toast.classList.contains('toast-warn')).toBe(false);
    expect(document.getElementById('error-toast-message').textContent)
      .toBe('Container „Vorspeisen“ hinzugefügt — 7 Element(e) gefunden');
    // Insertion itself is unaffected by the toast — same "no extra modal" flow as before.
    expect(document.querySelector('#group-tree-root .group-tree-row .group-tree-name').value).toBe('Vorspeisen');
  });

  test('creating a root container whose selector matches nothing shows the toast in its warn variant', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Leer';
    document.getElementById('btn-container-confirm').click();

    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.does-not-exist', matchCount: 0 });
    await flushMicrotasks();

    const toast = document.getElementById('error-toast');
    expect(toast.classList.contains('toast-warn')).toBe(true);
    expect(toast.classList.contains('toast-info')).toBe(false);
    expect(document.getElementById('error-toast-message').textContent)
      .toBe('Container „Leer“ hinzugefügt — 0 Element(e) gefunden');
  });

  test('creating a root container with no matchCount at all shows no toast', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();

    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' }); // no matchCount field
    await flushMicrotasks();

    expect(document.getElementById('error-toast').classList.contains('hidden')).toBe(true);
  });
});
