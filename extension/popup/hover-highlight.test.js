// Issue #233: popup side of the single-row hover highlight — the pure
// payload builders, and (integration) the real flat list / container tree
// sending HOVER_HIGHLIGHT/HOVER_HIGHLIGHT_CLEAR on hover.
const { buildFlatFieldHighlight, buildGroupNodeHighlight } = require('./hover-highlight');

const GROUPS = [
  {
    kind: 'group', name: 'Kategorie', selector: 'section.category', repeating: true, framePath: null,
    children: [
      { kind: 'field', name: 'Titel', selector: 'h2', mode: 'text', framePath: null },
      {
        kind: 'group', name: 'Gericht', selector: '.dish', repeating: true, framePath: null,
        children: [
          { kind: 'field', name: 'Preis', selector: '.price', mode: 'text', framePath: null },
          { kind: 'field', name: 'Kombiniert', selector: null, mode: 'text', framePath: null },
        ],
      },
    ],
  },
  {
    kind: 'group', name: 'Kopf', selector: 'header', repeating: false, framePath: ['#frame'],
    children: [{ kind: 'field', name: 'Logo', selector: 'img', mode: 'attribute', framePath: null }],
  },
];

describe('buildFlatFieldHighlight', () => {
  test('a flat field highlights every match page-wide', () => {
    expect(buildFlatFieldHighlight({ name: 'Preis', selector: '.price' }))
      .toEqual({ name: 'Preis', steps: [{ selector: '.price', all: true }], framePath: null });
  });

  test('carries the field\'s framePath', () => {
    expect(buildFlatFieldHighlight({ name: 'Preis', selector: '.price', framePath: ['#f'] }).framePath).toEqual(['#f']);
  });

  test('a derived field without a selector, or no field at all, has nothing to highlight', () => {
    expect(buildFlatFieldHighlight({ name: 'Kombiniert', selector: null })).toBeNull();
    expect(buildFlatFieldHighlight(undefined)).toBeNull();
  });
});

describe('buildGroupNodeHighlight', () => {
  test('a root repeating group', () => {
    expect(buildGroupNodeHighlight(GROUPS, [0])).toEqual({
      name: 'Kategorie', steps: [{ selector: 'section.category', all: true }], framePath: null,
    });
  });

  test('a nested field: the full ancestor chain, the field itself only first-match per scope', () => {
    expect(buildGroupNodeHighlight(GROUPS, [0, 1, 0])).toEqual({
      name: 'Preis',
      steps: [
        { selector: 'section.category', all: true },
        { selector: '.dish', all: true },
        { selector: '.price', all: false },
      ],
      framePath: null,
    });
  });

  test('a non-repeating group keeps only its first match', () => {
    expect(buildGroupNodeHighlight(GROUPS, [1]).steps).toEqual([{ selector: 'header', all: false }]);
  });

  test('inherits the nearest framePath from an ancestor', () => {
    expect(buildGroupNodeHighlight(GROUPS, [1, 0]).framePath).toEqual(['#frame']);
  });

  test('a derived field without a selector, or a stale path, has nothing to highlight', () => {
    expect(buildGroupNodeHighlight(GROUPS, [0, 1, 1])).toBeNull();
    expect(buildGroupNodeHighlight(GROUPS, [5])).toBeNull();
    expect(buildGroupNodeHighlight(GROUPS, [])).toBeNull();
  });
});

describe('hover highlight in the real popup', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  async function loadPopupWith(stored) {
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
    `;
    global.chrome = {
      runtime: { onMessage: { addListener: () => {} }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue(stored),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();
    chrome.runtime.sendMessage.mockClear();
  }

  const hover = el => el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  const highlightCalls = () => chrome.runtime.sendMessage.mock.calls.map(c => c[0]).filter(m => m.type.startsWith('HOVER_HIGHLIGHT'));

  test('hovering a flat field row highlights that field; leaving the list clears it', async () => {
    await loadPopupWith({
      url: 'https://example.com', mode: 'flat',
      fields: [{ name: 'Name', selector: '.dish h3' }, { name: 'Preis', selector: '.price', framePath: null }],
    });
    const rows = document.querySelectorAll('#fields-list .field-row');

    hover(rows[1].querySelector('.field-name'));
    hover(rows[1].querySelector('.field-selector')); // same row → no second message

    expect(highlightCalls()).toEqual([
      { type: 'HOVER_HIGHLIGHT', name: 'Preis', steps: [{ selector: '.price', all: true }], framePath: null },
    ]);

    document.getElementById('fields-list').dispatchEvent(new MouseEvent('mouseleave'));
    expect(highlightCalls().at(-1)).toEqual({ type: 'HOVER_HIGHLIGHT_CLEAR' });
  });

  test('hovering a nested container tree row highlights it within its ancestors', async () => {
    await loadPopupWith({ url: 'https://example.com', mode: 'container', groups: GROUPS });

    hover(document.querySelector('[data-path="[0,1,0]"] > .group-tree-row'));

    expect(highlightCalls()).toEqual([{
      type: 'HOVER_HIGHLIGHT', name: 'Preis', framePath: null,
      steps: [{ selector: 'section.category', all: true }, { selector: '.dish', all: true }, { selector: '.price', all: false }],
    }]);
  });

  test('moving onto a row with nothing to highlight clears the previous highlight', async () => {
    await loadPopupWith({ url: 'https://example.com', mode: 'container', groups: GROUPS });

    hover(document.querySelector('[data-path="[0,1,0]"] > .group-tree-row'));
    hover(document.querySelector('[data-path="[0,1,1]"] > .group-tree-row'));

    expect(highlightCalls().map(m => m.type)).toEqual(['HOVER_HIGHLIGHT', 'HOVER_HIGHLIGHT_CLEAR']);
  });

  test('a click clears the highlight (the hovered row may be removed or re-rendered)', async () => {
    await loadPopupWith({ url: 'https://example.com', mode: 'flat', fields: [{ name: 'Name', selector: '.dish h3' }] });
    const row = document.querySelector('#fields-list .field-row');

    hover(row);
    row.click();

    expect(highlightCalls().map(m => m.type)).toEqual(['HOVER_HIGHLIGHT', 'HOVER_HIGHLIGHT_CLEAR']);
  });
});
