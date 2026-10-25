require('./test-support/popup-env');
const {
  STATES,
} = require('./popup');

// ── Field transform-chain editor (Issue #84) ────────────────────────────────
// Same DOM-mocking pattern as "Live selector match-count preview" above, plus
// the transform-list/add-button markup in both field modals.

describe('Field transform-chain editor (Issue #84)', () => {
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
          <button id="btn-add-combine-field"></button>
          <button id="btn-add-split-field"></button>
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
        <div class="field-transforms-section">
          <ul id="field-transform-list"></ul>
          <button type="button" id="btn-field-transform-add"></button>
          <p id="field-transform-preview" class="transform-preview hidden"></p>
        </div>
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="modal-combine-field" class="hidden">
        <input id="input-combine-field-name" />
        <ul id="combine-field-source-list"></ul>
        <input id="input-combine-field-separator" />
        <input type="checkbox" id="toggle-combine-field-remove-originals" />
        <button id="btn-combine-field-confirm"></button>
        <button id="btn-combine-field-cancel"></button>
      </div>
      <div id="modal-split-field" class="hidden">
        <input id="input-split-field-name" />
        <select id="select-split-field-source"></select>
        <input id="input-split-field-separator" />
        <input id="input-split-field-index" type="number" />
        <input type="checkbox" id="toggle-split-field-remove-original" />
        <button id="btn-split-field-confirm"></button>
        <button id="btn-split-field-cancel"></button>
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
          <option value="ownText">Own text</option>
        </select>
        <div id="field-attribute-row" class="hidden">
          <select id="select-field-attribute"></select>
        </div>
        <p id="field-extended-match-count" class="match-count-hint hidden"></p>
        <div id="field-extended-transforms-section" class="field-transforms-section">
          <ul id="field-extended-transform-list"></ul>
          <button type="button" id="btn-field-extended-transform-add"></button>
          <p id="field-extended-transform-preview" class="transform-preview hidden"></p>
        </div>
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

  test('the flat field modal starts with no transform rows', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });

    expect(document.querySelectorAll('#field-transform-list .transform-row')).toHaveLength(0);
  });

  test('"+ Transformation" adds a default trim row', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });

    document.getElementById('btn-field-transform-add').click();

    const rows = document.querySelectorAll('#field-transform-list .transform-row');
    expect(rows).toHaveLength(1);
    expect(rows[0].querySelector('.transform-kind-select').value).toBe('trim');
    // trim has no parameters — no pattern/find/replacement inputs rendered.
    expect(rows[0].querySelector('.transform-pattern-input')).toBeNull();
  });

  test('changing kind to regexExtract reveals pattern/group inputs', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });
    document.getElementById('btn-field-transform-add').click();

    const select = document.querySelector('#field-transform-list .transform-kind-select');
    select.value = 'regexExtract';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const row = document.querySelector('#field-transform-list .transform-row');
    expect(row.querySelector('.transform-pattern-input')).not.toBeNull();
    expect(row.querySelector('.transform-group-input').value).toBe('0');
  });

  // Issue #205
  test('changing kind to toDate reveals sourceFormat and onError inputs', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });
    document.getElementById('btn-field-transform-add').click();

    const select = document.querySelector('#field-transform-list .transform-kind-select');
    select.value = 'toDate';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const row = document.querySelector('#field-transform-list .transform-row');
    expect(row.querySelector('.transform-source-format-input').value).toBe('{yyyy}-{mm}-{dd}');
    expect(row.querySelector('.transform-onerror-select').value).toBe('KeepOriginal');
    // UseDefault not picked yet — no default-value input rendered.
    expect(row.querySelector('.transform-default-value-input')).toBeNull();
  });

  test('changing kind to toInteger/toBoolean reveals only the onError input (no kind-specific params)', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });
    document.getElementById('btn-field-transform-add').click();
    const select = document.querySelector('#field-transform-list .transform-kind-select');

    select.value = 'toInteger';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    let row = document.querySelector('#field-transform-list .transform-row');
    expect(row.querySelector('.transform-onerror-select')).not.toBeNull();
    expect(row.querySelector('.transform-source-format-input')).toBeNull();

    select.value = 'toBoolean';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    row = document.querySelector('#field-transform-list .transform-row');
    expect(row.querySelector('.transform-onerror-select')).not.toBeNull();
  });

  test('picking onError UseDefault reveals the default-value input', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });
    document.getElementById('btn-field-transform-add').click();
    const kindSelect = document.querySelector('#field-transform-list .transform-kind-select');
    kindSelect.value = 'toInteger';
    kindSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const onErrorSelect = document.querySelector('#field-transform-list .transform-onerror-select');
    onErrorSelect.value = 'UseDefault';
    onErrorSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const defaultValueInput = document.querySelector('#field-transform-list .transform-default-value-input');
    expect(defaultValueInput).not.toBeNull();
    expect(defaultValueInput.value).toBe('');

    defaultValueInput.value = '0';
    defaultValueInput.dispatchEvent(new Event('change', { bubbles: true }));
    expect(document.querySelector('#field-transform-list .transform-default-value-input').value).toBe('0');
  });

  test('editing the sourceFormat input updates state and survives a re-render', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });
    document.getElementById('btn-field-transform-add').click();
    const select = document.querySelector('#field-transform-list .transform-kind-select');
    select.value = 'toDate';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const sourceFormatInput = document.querySelector('#field-transform-list .transform-source-format-input');
    sourceFormatInput.value = '{dd}.{mm}.{yyyy}';
    sourceFormatInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('#field-transform-list .transform-source-format-input').value).toBe('{dd}.{mm}.{yyyy}');
  });

  test('confirming is blocked when a toDate step has a blank sourceFormat', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price' });
    document.getElementById('input-field-name').value = 'Datum';
    document.getElementById('btn-field-transform-add').click();
    const select = document.querySelector('#field-transform-list .transform-kind-select');
    select.value = 'toDate';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const sourceFormatInput = document.querySelector('#field-transform-list .transform-source-format-input');
    sourceFormatInput.value = '  ';
    sourceFormatInput.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-field-confirm').click();

    expect(document.querySelectorAll('#fields-list .field-row')).toHaveLength(0);
  });

  test('editing the pattern input updates state and survives a re-render', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });
    document.getElementById('btn-field-transform-add').click();
    const select = document.querySelector('#field-transform-list .transform-kind-select');
    select.value = 'regexExtract';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    const patternInput = document.querySelector('#field-transform-list .transform-pattern-input');
    patternInput.value = '\\d+';
    patternInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('#field-transform-list .transform-pattern-input').value).toBe('\\d+');
  });

  // Regression: render()'s modal-open block resets the name input/mode select
  // to their defaults on every render — editing a transform row goes through
  // patchState (a full re-render) the same way any other state change does,
  // so without lastFieldModalSelector's "only reset on a genuinely new pick"
  // guard, every transform edit would silently wipe the field name the user
  // already typed.
  test('editing a transform row does not reset the already-typed field name', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });
    document.getElementById('input-field-name').value = 'Preis';
    document.getElementById('btn-field-transform-add').click();

    expect(document.getElementById('input-field-name').value).toBe('Preis');
  });

  test('remove button deletes only that row', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });
    document.getElementById('btn-field-transform-add').click();
    document.getElementById('btn-field-transform-add').click();

    document.querySelectorAll('#field-transform-list .btn-transform-remove')[0].click();

    expect(document.querySelectorAll('#field-transform-list .transform-row')).toHaveLength(1);
  });

  test('move-down then move-up round-trips the order', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'li.item' });
    document.getElementById('btn-field-transform-add').click(); // trim
    const firstSelect = document.querySelector('#field-transform-list .transform-row').querySelector('.transform-kind-select');
    firstSelect.value = 'toNumber';
    firstSelect.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('btn-field-transform-add').click(); // trim (second row)

    document.querySelector('#field-transform-list .btn-transform-move-down').click();
    let kinds = [...document.querySelectorAll('#field-transform-list .transform-kind-select')].map(s => s.value);
    expect(kinds).toEqual(['trim', 'toNumber']);

    document.querySelectorAll('#field-transform-list .btn-transform-move-up')[1].click();
    kinds = [...document.querySelectorAll('#field-transform-list .transform-kind-select')].map(s => s.value);
    expect(kinds).toEqual(['toNumber', 'trim']);
  });

  test('confirming a flat field with a valid transform chain includes it on the wire-shaped field object', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price' });
    document.getElementById('input-field-name').value = 'Preis';
    document.getElementById('btn-field-transform-add').click();
    document.getElementById('btn-field-confirm').click();

    const fieldRow = document.querySelector('#fields-list .field-row');
    expect(fieldRow.textContent).toContain('Preis');

    // pendingTransforms itself was reset (even though the now-hidden modal's
    // stale DOM isn't re-rendered until it's actually shown again) — the
    // next pick starts from an empty chain, not a leftover one.
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.other' });
    expect(document.querySelectorAll('#field-transform-list .transform-row')).toHaveLength(0);
  });

  test('confirming is blocked when a regexExtract step has a blank pattern', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price' });
    document.getElementById('input-field-name').value = 'Preis';
    document.getElementById('btn-field-transform-add').click();
    const select = document.querySelector('#field-transform-list .transform-kind-select');
    select.value = 'regexExtract';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-field-confirm').click();

    // Still on the SELECTING screen / modal open — nothing was added.
    expect(document.querySelectorAll('#fields-list .field-row')).toHaveLength(0);
  });

  test('cancelling clears the transform chain for the next pick', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price' });
    document.getElementById('btn-field-transform-add').click();
    document.getElementById('btn-field-cancel').click();

    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.other' });
    expect(document.querySelectorAll('#field-transform-list .transform-row')).toHaveLength(0);
  });

  test('the transforms section is hidden for "Vorhanden?" (exists) mode in container mode', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.vegan' });
    await flushMicrotasks();

    const modeSelect = document.getElementById('select-field-mode');
    modeSelect.value = 'exists';
    modeSelect.dispatchEvent(new Event('change'));

    expect(document.getElementById('field-extended-transforms-section').classList.contains('hidden')).toBe(true);
  });

  test('confirming a container field with transforms carries them onto the serialized node', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price' });
    await flushMicrotasks();

    document.getElementById('input-field-extended-name').value = 'Preis';
    document.getElementById('btn-field-extended-transform-add').click();
    const select = document.querySelector('#field-extended-transform-list .transform-kind-select');
    select.value = 'toNumber';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    document.getElementById('btn-field-extended-confirm').click();

    const rows = document.querySelectorAll('#group-tree-root .group-tree-row');
    expect(rows[1].querySelector('.group-tree-name').value).toBe('Preis');
  });

  test('the "Felder kombinieren"/"Feld aufteilen" buttons are disabled until enough real fields exist', () => {
    expect(document.getElementById('btn-add-combine-field').disabled).toBe(true);
    expect(document.getElementById('btn-add-split-field').disabled).toBe(true);

    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.street' });
    document.getElementById('input-field-name').value = 'Strasse';
    document.getElementById('btn-field-confirm').click();

    expect(document.getElementById('btn-add-split-field').disabled).toBe(false);
    expect(document.getElementById('btn-add-combine-field').disabled).toBe(true);

    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.number' });
    document.getElementById('input-field-name').value = 'Hausnummer';
    document.getElementById('btn-field-confirm').click();

    expect(document.getElementById('btn-add-combine-field').disabled).toBe(false);
  });

  test('"Felder kombinieren" opens a modal with no click-based selection, listing existing fields as checkboxes', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.street' });
    document.getElementById('input-field-name').value = 'Strasse';
    document.getElementById('btn-field-confirm').click();
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.number' });
    document.getElementById('input-field-name').value = 'Hausnummer';
    document.getElementById('btn-field-confirm').click();

    chrome.runtime.sendMessage.mockClear();
    document.getElementById('btn-add-combine-field').click();

    expect(document.getElementById('modal-combine-field').classList.contains('hidden')).toBe(false);
    // No START_SELECTION message was sent — this flow never asks the
    // content script to enter click-based selection mode.
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    const names = [...document.querySelectorAll('#combine-field-source-list .combine-field-source-checkbox')].map(cb => cb.dataset.fieldName);
    expect(names).toEqual(['Strasse', 'Hausnummer']);
  });

  test('confirming "Felder kombinieren" adds a derived field, without removing the sources by default', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.street' });
    document.getElementById('input-field-name').value = 'Strasse';
    document.getElementById('btn-field-confirm').click();
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.number' });
    document.getElementById('input-field-name').value = 'Hausnummer';
    document.getElementById('btn-field-confirm').click();

    document.getElementById('btn-add-combine-field').click();
    document.getElementById('input-combine-field-name').value = 'Adresse';
    document.querySelectorAll('#combine-field-source-list .combine-field-source-checkbox').forEach(cb => { cb.checked = true; });
    document.getElementById('input-combine-field-separator').value = ', ';
    document.getElementById('btn-combine-field-confirm').click();

    expect(document.getElementById('modal-combine-field').classList.contains('hidden')).toBe(true);
    const rows = document.querySelectorAll('#fields-list .field-row');
    expect(rows).toHaveLength(3);
    expect(rows[2].querySelector('.field-name').textContent).toBe('Adresse');
    // No "versteckt" badge on any row — remove-originals wasn't checked.
    expect(document.querySelectorAll('#fields-list .field-hidden-badge')).toHaveLength(0);
  });

  test('"Ursprüngliche Felder entfernen" marks the source fields hidden instead of deleting them', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.street' });
    document.getElementById('input-field-name').value = 'Strasse';
    document.getElementById('btn-field-confirm').click();
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.number' });
    document.getElementById('input-field-name').value = 'Hausnummer';
    document.getElementById('btn-field-confirm').click();

    document.getElementById('btn-add-combine-field').click();
    document.getElementById('input-combine-field-name').value = 'Adresse';
    document.querySelectorAll('#combine-field-source-list .combine-field-source-checkbox').forEach(cb => { cb.checked = true; });
    document.getElementById('toggle-combine-field-remove-originals').checked = true;
    document.getElementById('btn-combine-field-confirm').click();

    // Still 3 rows — the sources are hidden from the *output*, not deleted.
    const rows = document.querySelectorAll('#fields-list .field-row');
    expect(rows).toHaveLength(3);
    expect(document.querySelectorAll('#fields-list .field-hidden-badge')).toHaveLength(2);
  });

  test('confirming "Felder kombinieren" without at least 2 checked sources is silently blocked', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.street' });
    document.getElementById('input-field-name').value = 'Strasse';
    document.getElementById('btn-field-confirm').click();
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.number' });
    document.getElementById('input-field-name').value = 'Hausnummer';
    document.getElementById('btn-field-confirm').click();

    document.getElementById('btn-add-combine-field').click();
    document.getElementById('input-combine-field-name').value = 'Adresse';
    document.querySelector('#combine-field-source-list .combine-field-source-checkbox').checked = true; // only one
    document.getElementById('btn-combine-field-confirm').click();

    expect(document.getElementById('modal-combine-field').classList.contains('hidden')).toBe(false);
    expect(document.querySelectorAll('#fields-list .field-row')).toHaveLength(2);
  });

  test('"Feld aufteilen" adds a derived field sourced from a single picked field', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.address' });
    document.getElementById('input-field-name').value = 'Adresse';
    document.getElementById('btn-field-confirm').click();

    document.getElementById('btn-add-split-field').click();
    expect(document.getElementById('modal-split-field').classList.contains('hidden')).toBe(false);
    const options = [...document.getElementById('select-split-field-source').options].map(o => o.value);
    expect(options).toEqual(['', 'Adresse']);

    document.getElementById('input-split-field-name').value = 'Strasse';
    document.getElementById('select-split-field-source').value = 'Adresse';
    // Issue #407: the field says "Part (1 = first)"; 2 is the wire index 1.
    document.getElementById('input-split-field-index').value = '2';
    document.getElementById('btn-split-field-confirm').click();

    const rows = document.querySelectorAll('#fields-list .field-row');
    expect(rows).toHaveLength(2);
    expect(rows[1].querySelector('.field-name').textContent).toBe('Strasse');
    const savedFields = chrome.storage.session.set.mock.calls.map(c => c[0].fields).filter(Boolean).pop();
    expect(savedFields[1].transforms[0]).toMatchObject({ kind: 'splitField', sourceFieldName: 'Adresse', index: 1 });
  });

  test('container mode: "Felder kombinieren" is scoped to the same immediate parent group', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.street' });
    await flushMicrotasks();
    document.getElementById('input-field-extended-name').value = 'Strasse';
    document.getElementById('btn-field-extended-confirm').click();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.number' });
    await flushMicrotasks();
    document.getElementById('input-field-extended-name').value = 'Hausnummer';
    document.getElementById('btn-field-extended-confirm').click();

    const combineBtn = document.querySelector('.btn-add-combine-field');
    expect(combineBtn.disabled).toBe(false);
    combineBtn.click();

    const names = [...document.querySelectorAll('#combine-field-source-list .combine-field-source-checkbox')].map(cb => cb.dataset.fieldName);
    expect(names).toEqual(['Strasse', 'Hausnummer']);

    document.getElementById('input-combine-field-name').value = 'Adresse';
    document.querySelectorAll('#combine-field-source-list .combine-field-source-checkbox').forEach(cb => { cb.checked = true; });
    document.getElementById('btn-combine-field-confirm').click();

    const rows = document.querySelectorAll('#group-tree-root .group-tree-row');
    expect(rows[3].querySelector('.group-tree-name').value).toBe('Adresse');
  });
});

// ── Transform-chain live preview (Issue #143) ───────────────────────────────
// Same DOM-mocking pattern as "Field transform-chain editor" above, plus
// rawText/attributes on the ELEMENT_SELECTED fixture messages.

describe('Transform-chain live preview (Issue #143)', () => {
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
          <button id="btn-add-combine-field"></button>
          <button id="btn-add-split-field"></button>
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
        <div class="field-transforms-section">
          <ul id="field-transform-list"></ul>
          <button type="button" id="btn-field-transform-add"></button>
          <p id="field-transform-preview" class="transform-preview hidden"></p>
        </div>
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="modal-combine-field" class="hidden">
        <input id="input-combine-field-name" />
        <ul id="combine-field-source-list"></ul>
        <input id="input-combine-field-separator" />
        <input type="checkbox" id="toggle-combine-field-remove-originals" />
        <button id="btn-combine-field-confirm"></button>
        <button id="btn-combine-field-cancel"></button>
      </div>
      <div id="modal-split-field" class="hidden">
        <input id="input-split-field-name" />
        <select id="select-split-field-source"></select>
        <input id="input-split-field-separator" />
        <input id="input-split-field-index" type="number" />
        <input type="checkbox" id="toggle-split-field-remove-original" />
        <button id="btn-split-field-confirm"></button>
        <button id="btn-split-field-cancel"></button>
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
          <option value="ownText">Own text</option>
        </select>
        <div id="field-attribute-row" class="hidden">
          <select id="select-field-attribute"></select>
        </div>
        <p id="field-extended-match-count" class="match-count-hint hidden"></p>
        <div id="field-extended-transforms-section" class="field-transforms-section">
          <ul id="field-extended-transform-list"></ul>
          <button type="button" id="btn-field-extended-transform-add"></button>
          <p id="field-extended-transform-preview" class="transform-preview hidden"></p>
        </div>
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

  test('no preview shown before any transform is added', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', rawText: 'Preis: 12,99 €' });

    const preview = document.getElementById('field-transform-preview');
    expect(preview.classList.contains('hidden')).toBe(false);
    expect(preview.textContent).toContain('Preis: 12,99 €');
  });

  test('flat mode preview updates live as transform steps are edited', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', rawText: 'Preis: 12,99 €' });

    document.getElementById('btn-field-transform-add').click(); // trim
    const kindSelect = document.querySelector('#field-transform-list .transform-kind-select');
    kindSelect.value = 'regexExtract';
    kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const patternInput = document.querySelector('#field-transform-list .transform-pattern-input');
    patternInput.value = '[\\d,]+';
    patternInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.getElementById('field-transform-preview').textContent).toContain('12,99');
  });

  test('flat mode preview flags an unmatched regex as an empty result', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', rawText: 'Preis: 12,99 €' });

    document.getElementById('btn-field-transform-add').click();
    const kindSelect = document.querySelector('#field-transform-list .transform-kind-select');
    kindSelect.value = 'regexExtract';
    kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const patternInput = document.querySelector('#field-transform-list .transform-pattern-input');
    patternInput.value = 'nomatch\\d';
    patternInput.dispatchEvent(new Event('change', { bubbles: true }));

    const preview = document.getElementById('field-transform-preview');
    expect(preview.classList.contains('warn')).toBe(false);
    expect(preview.textContent).not.toContain('12,99');
  });

  test('an invalid-for-JS regex pattern shows "preview unavailable"', () => {
    document.getElementById('btn-add-field').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', rawText: 'Preis: 12,99 €' });

    document.getElementById('btn-field-transform-add').click();
    const kindSelect = document.querySelector('#field-transform-list .transform-kind-select');
    kindSelect.value = 'regexExtract';
    kindSelect.dispatchEvent(new Event('change', { bubbles: true }));
    const patternInput = document.querySelector('#field-transform-list .transform-pattern-input');
    patternInput.value = '(unclosed';
    patternInput.dispatchEvent(new Event('change', { bubbles: true }));

    const preview = document.getElementById('field-transform-preview');
    expect(preview.classList.contains('warn')).toBe(true);
  });

  test('container mode: text-mode preview uses the picked element\'s raw text', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.price', rawText: 'Preis: 12,99 €' });
    await flushMicrotasks();

    document.getElementById('btn-field-extended-transform-add').click();

    expect(document.getElementById('field-extended-transform-preview').textContent).toContain('Preis: 12,99 €');
  });

  // Issue #213 follow-up: the attribute field is now a picker of the
  // element's own real attributes (guessUrlAttribute pre-selects whichever
  // one looks like a resource URL), not a free-text field the user types
  // into — so unlike before, the preview can already show the instant the
  // mode switches to "attribute", with no separate typing step at all.
  test('container mode: attribute-mode preview auto-shows via the guessed attribute, with no typing needed', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    // `class` isn't URL-like and comes first in the map — `href` is the one
    // guessUrlAttribute should still pick, proving it's a real guess and not
    // just "whichever attribute happens to be first".
    capturedListener({
      type: 'ELEMENT_SELECTED', selector: 'a.link', rawText: 'Zum Produkt',
      attributes: { class: 'link', href: '/produkt/42' },
    });
    await flushMicrotasks();

    const modeSelect = document.getElementById('select-field-mode');
    modeSelect.value = 'attribute';
    modeSelect.dispatchEvent(new Event('change'));

    expect(document.getElementById('select-field-attribute').value).toBe('href');
    const preview = document.getElementById('field-extended-transform-preview');
    expect(preview.classList.contains('hidden')).toBe(false);
    expect(preview.textContent).toContain('/produkt/42');
  });

  test('container mode: picking a different attribute from the dropdown updates the preview', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({
      type: 'ELEMENT_SELECTED', selector: 'a.link', rawText: 'Zum Produkt',
      attributes: { class: 'link', href: '/produkt/42' },
    });
    await flushMicrotasks();

    const modeSelect = document.getElementById('select-field-mode');
    modeSelect.value = 'attribute';
    modeSelect.dispatchEvent(new Event('change'));

    const attrSelect = document.getElementById('select-field-attribute');
    attrSelect.value = 'class';
    attrSelect.dispatchEvent(new Event('change'));

    expect(document.getElementById('field-extended-transform-preview').textContent).toContain('link');
  });

  // Issue #169
  test('container mode: ownText-mode preview uses the picked element\'s own text, not rawText', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({
      type: 'ELEMENT_SELECTED', selector: 'h3.item-name',
      rawText: 'Burrata mit Tomatenvegan möglich', ownText: 'Burrata mit Tomaten',
    });
    await flushMicrotasks();

    const modeSelect = document.getElementById('select-field-mode');
    modeSelect.value = 'ownText';
    modeSelect.dispatchEvent(new Event('change'));

    const preview = document.getElementById('field-extended-transform-preview');
    expect(preview.classList.contains('hidden')).toBe(false);
    expect(preview.textContent).toContain('Burrata mit Tomaten');
    expect(preview.textContent).not.toContain('vegan möglich');
  });

  test('container mode: "Vorhanden?" (exists) mode never shows a preview', async () => {
    document.getElementById('btn-mode-container').click();
    document.getElementById('btn-add-root-container').click();
    document.getElementById('input-container-name').value = 'Vorspeisen';
    document.getElementById('btn-container-confirm').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'section.menu-category' });
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();

    document.querySelector('.btn-add-subfield').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.vegan', rawText: 'Vegan' });
    await flushMicrotasks();

    const modeSelect = document.getElementById('select-field-mode');
    modeSelect.value = 'exists';
    modeSelect.dispatchEvent(new Event('change'));

    expect(document.getElementById('field-extended-transform-preview').classList.contains('hidden')).toBe(true);
  });
});
