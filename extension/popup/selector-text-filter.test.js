// Issue #227: the `:contains("text")` selector suffix on the popup side — the
// pure helpers (test-vectors/text-selector.json is shared with the content
// script's, the companion's and the script runtime's copies) and the optional "text contains" input of the flat and container
// field modals, in the real popup.
const { loadVectors } = require('../../test-vectors/load');
const {
  escapeFilterText, collapseWhitespace, appendTextFilter, splitTextFilter, suggestFilterText, SUGGESTED_TEXT_MAX_LENGTH,
} = require('./selector-text-filter');

describe('splitTextFilter (shared vectors)', () => {
  const { cases } = loadVectors('text-selector.json');

  test.each(cases.filter((c) => !c.invalid).map((c) => [c.name, c]))('%s', (_name, c) => {
    expect(splitTextFilter(c.selector)).toEqual({ base: c.base, text: c.text });
  });

  test.each(cases.filter((c) => c.splitUnchanged).map((c) => [c.name, c]))('%s is not a filter', (_name, c) => {
    expect(splitTextFilter(c.selector)).toEqual({ base: c.selector, text: null });
  });
});

describe('appendTextFilter / suggestFilterText', () => {
  test('appends the suffix with escaped quotes and backslashes, whitespace collapsed', () => {
    expect(appendTextFilter('a.btn', ' In  den\nWarenkorb ')).toBe('a.btn:contains("In den Warenkorb")');
    expect(appendTextFilter('a', 'say "hi" \\ there')).toBe('a:contains("say \\"hi\\" \\\\ there")');
  });

  test('a blank text leaves the selector untouched', () => {
    expect(appendTextFilter('a.btn', '')).toBe('a.btn');
    expect(appendTextFilter('a.btn', '   \n ')).toBe('a.btn');
    expect(appendTextFilter('a.btn', null)).toBe('a.btn');
  });

  test('round-trips through splitTextFilter, including awkward characters', () => {
    for (const text of ['Merken', 'say "hi"', "it's", 'back\\slash', 'a:contains("x")']) {
      expect(splitTextFilter(appendTextFilter('.btn', text))).toEqual({ base: '.btn', text });
    }
  });

  test('escapeFilterText / collapseWhitespace', () => {
    expect(escapeFilterText('a"b\\c')).toBe('a\\"b\\\\c');
    expect(collapseWhitespace('  a \n b\t')).toBe('a b');
    expect(collapseWhitespace(null)).toBe('');
  });

  test('suggestFilterText collapses and shortens the clicked element\'s text', () => {
    expect(suggestFilterText('  In den   Warenkorb ')).toBe('In den Warenkorb');
    expect(suggestFilterText('x'.repeat(200))).toHaveLength(SUGGESTED_TEXT_MAX_LENGTH);
    expect(suggestFilterText('   ')).toBe('');
    expect(suggestFilterText(undefined)).toBe('');
  });
});

describe('the text filter input in the field modals (real popup)', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  const mount = async (stored = {}, countResponse = { count: 3 }) => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <div id="container-mode-section" class="hidden"><ul id="group-tree-root"></ul><button id="btn-add-root-container"></button></div>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden"><button id="btn-cancel-selection"></button></section>
      <div id="modal-field-name" class="hidden">
        <input id="input-field-name" />
        <input id="input-field-name-text-filter" />
        <button id="btn-field-name-use-text" class="hidden"></button>
        <p id="field-name-match-count" class="match-count-hint hidden"></p>
        <button id="btn-field-confirm"></button>
        <button id="btn-field-cancel"></button>
      </div>
      <div id="modal-field-extended" class="hidden">
        <input id="input-field-extended-name" />
        <select id="select-field-mode"><option value="text">Text</option><option value="attribute">Attribute</option></select>
        <div id="field-attribute-row" class="hidden"><select id="select-field-attribute"></select></div>
        <input id="input-field-text-filter" />
        <button id="btn-field-use-text" class="hidden"></button>
        <p id="field-extended-match-count" class="match-count-hint hidden"></p>
        <button id="btn-field-extended-confirm"></button>
        <button id="btn-field-extended-cancel"></button>
      </div>
    `;
    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(async (message) => (message.type === 'COUNT_PICK_WITH_TEXT' ? countResponse : undefined)),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: { get: jest.fn().mockResolvedValue(stored), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();
  };

  const type = (id, value) => {
    const input = document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const persisted = (key) => chrome.storage.session.set.mock.calls.at(-1)[0][key];
  const hint = (id) => document.getElementById(id);
  // the hint's wording depends on the UI language — only the number matters here
  const hintCount = (id) => parseInt(document.getElementById(id).textContent, 10);

  describe('flat mode', () => {
    beforeEach(async () => { await mount({ mode: 'flat' }); });

    const pick = (extra = {}) => {
      document.getElementById('btn-add-field').click();
      capturedListener({ type: 'ELEMENT_SELECTED', selector: 'a.btn', matchCount: 5, rawText: 'In den Warenkorb', ...extra });
    };

    test('left empty, the field keeps the pick\'s selector exactly', () => {
      pick();
      type('input-field-name', 'Link');
      document.getElementById('btn-field-confirm').click();

      expect(persisted('fields')).toEqual([expect.objectContaining({ name: 'Link', selector: 'a.btn' })]);
    });

    test('with a text, the confirmed field gets the :contains("…") suffix', () => {
      pick();
      type('input-field-name', 'Link');
      type('input-field-name-text-filter', 'Warenkorb');
      document.getElementById('btn-field-confirm').click();

      expect(persisted('fields')[0].selector).toBe('a.btn:contains("Warenkorb")');
    });

    test('the "use this element\'s text" shortcut is offered only for an element with text, and fills the input', async () => {
      pick();
      const useButton = document.getElementById('btn-field-name-use-text');
      expect(useButton.classList.contains('hidden')).toBe(false);

      useButton.click();
      await flushMicrotasks();
      expect(document.getElementById('input-field-name-text-filter').value).toBe('In den Warenkorb');

      pick({ rawText: '   ' });
      expect(document.getElementById('btn-field-name-use-text').classList.contains('hidden')).toBe(true);
    });

    test('the match-count hint follows the typed text, and falls back to the plain count when it is cleared', async () => {
      pick();
      expect(hintCount('field-name-match-count')).toBe(5);

      type('input-field-name-text-filter', 'Warenkorb');
      await flushMicrotasks();
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'COUNT_PICK_WITH_TEXT', text: 'Warenkorb' });
      expect(hintCount('field-name-match-count')).toBe(3);

      type('input-field-name-text-filter', '');
      await flushMicrotasks();
      expect(hintCount('field-name-match-count')).toBe(5);
    });

    test('a text matching nothing shows the amber warning', async () => {
      await mount({ mode: 'flat' }, { count: 0 });
      pick();
      type('input-field-name-text-filter', 'Gibt es nicht');
      await flushMicrotasks();

      expect(hintCount('field-name-match-count')).toBe(0);
      expect(hint('field-name-match-count').classList.contains('warn')).toBe(true);
    });

    test('while the count is unknown (no answer from the page) no stale number is shown', async () => {
      await mount({ mode: 'flat' }, null); // null, not undefined — undefined would pick the default response
      pick();
      type('input-field-name-text-filter', 'Warenkorb');
      await flushMicrotasks();

      expect(hint('field-name-match-count').classList.contains('hidden')).toBe(true);
    });

    test('a new pick starts with an empty text input', () => {
      pick();
      type('input-field-name-text-filter', 'Warenkorb');
      document.getElementById('btn-field-cancel').click();
      pick();

      expect(document.getElementById('input-field-name-text-filter').value).toBe('');
    });
  });

  describe('container mode', () => {
    beforeEach(async () => {
      await mount({ mode: 'container', groups: [{ kind: 'group', name: 'Karte', selector: '.card', repeating: true, children: [] }] });
    });

    test('the confirmed data field gets the suffix; the hint follows the typed text', async () => {
      document.querySelector('.btn-add-subfield').click();
      capturedListener({ type: 'ELEMENT_SELECTED', selector: 'a.btn', matchCount: 4, rawText: 'Merken' });

      expect(hintCount('field-extended-match-count')).toBe(4);
      type('input-field-extended-name', 'Wunschliste');
      type('input-field-text-filter', 'merken');
      await flushMicrotasks();
      expect(hintCount('field-extended-match-count')).toBe(3);

      document.getElementById('btn-field-extended-confirm').click();
      expect(persisted('groups')[0].children[0]).toEqual(expect.objectContaining({ name: 'Wunschliste', selector: 'a.btn:contains("merken")' }));
    });

    test('left empty, the data field keeps the pick\'s selector', () => {
      document.querySelector('.btn-add-subfield').click();
      capturedListener({ type: 'ELEMENT_SELECTED', selector: 'a.btn', matchCount: 4 });
      type('input-field-extended-name', 'Link');
      document.getElementById('btn-field-extended-confirm').click();

      expect(persisted('groups')[0].children[0].selector).toBe('a.btn');
    });
  });
});
