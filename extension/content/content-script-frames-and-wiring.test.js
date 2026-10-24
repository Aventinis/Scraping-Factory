const {
  countSelectorMatches,
  matchFlatFields,
  matchGroupTree,
  readEmbeddedJson,
  findIframeSelectorForWindow,
  resolveFramePath,
  frameDepth,
  splitTextFilter,
  normalizeText,
  querySelectorAllWithText,
  querySelectorWithText,
} = require('./content-script');

// ── Cross-frame path resolution (Issue #42) ─────────────────────────────────
// jsdom has no real nested browsing context: window.top/window.parent always
// equal window itself, and window.top can't even be reassigned for a test
// (it's a non-configurable accessor — verified directly, not assumed). So
// only the parts that don't depend on *actually* being a different window
// are unit-tested here:
// - findIframeSelectorForWindow: real jsdom <iframe> elements do get a
//   working contentWindow, so the "which <iframe> embeds this window"
//   correlation is fully testable.
// - resolveFramePath's top-frame base case ([] when window === window.top),
//   which is jsdom's only reachable case anyway.
// The actual cross-frame postMessage round trip (nested frames, nested
// FramePath, and the non-top-frame message-listener guards) was instead
// verified against a real loaded extension in real Chromium — see
// PLAN-issues-41-42.md.

describe('findIframeSelectorForWindow', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  test('finds the iframe whose contentWindow matches, and returns its selector', () => {
    const iframe = document.createElement('iframe');
    iframe.id = 'outer';
    document.body.appendChild(iframe);

    expect(iframe.contentWindow).toBeTruthy(); // sanity: jsdom really does give iframes a contentWindow
    expect(findIframeSelectorForWindow(iframe.contentWindow)).toBe('#outer');
  });

  test('picks the right one among several iframes', () => {
    const first = document.createElement('iframe');
    first.className = 'first-frame';
    const second = document.createElement('iframe');
    second.className = 'second-frame';
    document.body.append(first, second);

    expect(findIframeSelectorForWindow(second.contentWindow)).toBe('iframe.second-frame');
  });

  test('returns null when no iframe matches the given window', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);

    expect(findIframeSelectorForWindow({})).toBeNull();
  });
});

describe('resolveFramePath', () => {
  test('resolves to [] for the top-level document (jsdom is always window === window.top)', async () => {
    await expect(resolveFramePath()).resolves.toEqual([]);
  });
});

// Issue #42, Phase 7: frameDepth() drives createOverlay's iframe-visual-
// feedback branch (amber highlight + depth badge, see the "Overlay" section).
// Only the top-frame (depth 0) case is exercisable in jsdom — jsdom's
// window.top is non-configurable (see PLAN-issues-41-42.md's Phase 2 design
// notes: the same limitation already blocks unit-testing resolveFramePath's
// actual cross-frame round trip), so the depth > 0 branch is verified
// manually against a real nested iframe instead (see PLAN-issues-41-42.md's
// Phase 7 section).
describe('frameDepth', () => {
  test('is 0 for the top-level document', () => {
    expect(frameDepth()).toBe(0);
  });
});

describe('PREVIEW_START / PREVIEW_STOP (message-listener wiring)', () => {
  let capturedListener;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <h2 class="title">Erstes</h2>
      <h2 class="title">Zweites</h2>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
    };

    require('./content-script');
  });

  afterEach(() => {
    delete global.chrome;
  });

  test('PREVIEW_START draws one highlight box per match and reports PREVIEW_RESULT', () => {
    capturedListener({ type: 'PREVIEW_START', mode: 'flat', fields: [{ name: 'Titel', selector: '.title' }] });

    expect(document.querySelectorAll('.sf-preview-box')).toHaveLength(2);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'PREVIEW_RESULT', total: 2, empty: [], truncated: false,
    });
  });

  test('a field with zero matches is listed in the PREVIEW_RESULT empty array', () => {
    capturedListener({
      type: 'PREVIEW_START', mode: 'flat',
      fields: [{ name: 'Titel', selector: '.title' }, { name: 'Fehlt', selector: '.nope' }],
    });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'PREVIEW_RESULT', total: 2, empty: ['Fehlt'], truncated: false,
    });
  });

  test('a second PREVIEW_START replaces the previous boxes instead of accumulating them', () => {
    capturedListener({ type: 'PREVIEW_START', mode: 'flat', fields: [{ name: 'Titel', selector: '.title' }] });
    capturedListener({ type: 'PREVIEW_START', mode: 'flat', fields: [{ name: 'Titel', selector: '.title' }] });

    expect(document.querySelectorAll('.sf-preview-box')).toHaveLength(2);
  });

  test('PREVIEW_STOP removes all highlight boxes', () => {
    capturedListener({ type: 'PREVIEW_START', mode: 'flat', fields: [{ name: 'Titel', selector: '.title' }] });
    expect(document.querySelectorAll('.sf-preview-box')).toHaveLength(2);

    capturedListener({ type: 'PREVIEW_STOP' });
    expect(document.querySelectorAll('.sf-preview-box')).toHaveLength(0);
  });
});

// ── API-Mode capture bridge (message-listener wiring) ────────────────────────
// api-capture.ts (MAIN world) talks to this isolated-world script via
// window.postMessage in both directions — see content-script.ts's bridge.
//
// Note: window.addEventListener('message', ...) is registered unconditionally
// at module load (same as the existing 'error'/'unhandledrejection'
// listeners above), so re-requiring the module in earlier tests in this file
// leaves old listeners attached to the shared jsdom `window`. A dispatched
// 'message' event can therefore reach more than one accumulated listener —
// harmless since every one performs the same forward, but it means these
// tests assert with toHaveBeenCalledWith (content, regardless of count),
// not toHaveBeenCalledTimes.
describe('API_CAPTURE bridge (message-listener wiring)', () => {
  let capturedListener;

  beforeEach(() => {
    jest.resetModules();

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
    };

    require('./content-script');
  });

  afterEach(() => {
    delete global.chrome;
  });

  test('API_CAPTURE_START is forwarded to the MAIN world via postMessage', () => {
    jest.spyOn(window, 'postMessage');

    capturedListener({ type: 'API_CAPTURE_START' });

    expect(window.postMessage).toHaveBeenCalledWith(
      { source: 'sf-api-capture-control', type: 'API_CAPTURE_START' }, '*',
    );
  });

  test('API_CAPTURE_STOP is forwarded to the MAIN world via postMessage', () => {
    jest.spyOn(window, 'postMessage');

    capturedListener({ type: 'API_CAPTURE_STOP' });

    expect(window.postMessage).toHaveBeenCalledWith(
      { source: 'sf-api-capture-control', type: 'API_CAPTURE_STOP' }, '*',
    );
  });

  // Dispatched directly (not via window.postMessage, whose jsdom delivery is
  // an async macrotask) so the bridge's synchronous handling is testable
  // without a real event-loop wait; `source: window` matches what a genuine
  // same-window postMessage from the MAIN world would set.
  test('a captured entry from the MAIN world is forwarded to the side panel as API_CAPTURE_ENTRY', () => {
    const entry = { id: 1, url: 'https://example.com/api/items', method: 'GET', status: 200, contentType: 'application/json', body: '{}', bodyTruncated: false };

    window.dispatchEvent(new MessageEvent('message', {
      data: { source: 'sf-api-capture', type: 'API_CAPTURE_ENTRY', entry }, source: window,
    }));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'API_CAPTURE_ENTRY', entry });
  });

  test('a message without the expected source tag is ignored', () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'API_CAPTURE_ENTRY', entry: {} }, source: window, // missing source: 'sf-api-capture'
    }));

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });
});

// ── Issue #227: the :contains("text") selector suffix ────────────────────────
// The same cases (and expectations) run in popup/selector-text-filter.test.js
// and the companion's SelectorTextFilterTests.cs — three implementations of
// one syntax, checked against identical vectors.

describe('splitTextFilter (shared vectors)', () => {
  test.each([
    ['.btn:contains("Add to cart")', '.btn', 'Add to cart'],
    [".card .btn:contains('Merken')", '.card .btn', 'Merken'],
    ['a:contains(  "x"  )   ', 'a', 'x'],
    [':contains("only")', '*', 'only'],
    ['.a > .b:contains("say \\"hi\\"")', '.a > .b', 'say "hi"'],
    [".b:contains('it\\'s')", '.b', "it's"],
    ['A:CONTAINS("x")', 'A', 'x'],
    ['div', 'div', null],
  ])('%s → base %j, text %j', (selector, base, text) => {
    expect(splitTextFilter(selector)).toEqual({ base, text });
  });

  test.each([
    ['a:contains(x)'],
    ['a:contains("x"'],
    ['a:contains("x") b'],
  ])('a malformed filter (%s) is left untouched for the browser to reject', (selector) => {
    expect(splitTextFilter(selector)).toEqual({ base: selector, text: null });
  });
});

describe('querySelectorAllWithText', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="card" id="c1">
        <a class="btn" href="/cart">In den  Warenkorb</a>
        <a class="btn" href="/wish"><span>Mer</span>ken</a>
        <a class="btn" href="/cmp">Vergleichen</a>
      </div>
      <div class="card" id="c2"><a class="btn" href="/other">Merken</a></div>
    `;
  });

  const hrefs = (els) => els.map((e) => e.getAttribute('href'));

  test('normalizeText collapses whitespace and lower-cases', () => {
    expect(normalizeText('  In den \n  WARENKORB ')).toBe('in den warenkorb');
  });

  test('matches case-insensitively, across repeated whitespace and child elements', () => {
    expect(hrefs(querySelectorAllWithText(document, '.btn:contains("in den warenkorb")'))).toEqual(['/cart']);
    expect(hrefs(querySelectorAllWithText(document, '.btn:contains("MERKEN")'))).toEqual(['/wish', '/other']);
  });

  test('is a substring match', () => {
    expect(hrefs(querySelectorAllWithText(document, '.btn:contains("gleich")'))).toEqual(['/cmp']);
  });

  test('works with a descendant combinator before the filter and inside a scope root', () => {
    expect(hrefs(querySelectorAllWithText(document, '.card .btn:contains("merken")'))).toEqual(['/wish', '/other']);
    expect(hrefs(querySelectorAllWithText(document.getElementById('c2'), '.btn:contains("merken")'))).toEqual(['/other']);
  });

  test('a filter on a container selects the instances that contain the text anywhere inside', () => {
    expect(querySelectorAllWithText(document, '.card:contains("vergleichen")').map((e) => e.id)).toEqual(['c1']);
  });

  test('without a filter it is plain querySelectorAll; querySelectorWithText returns the first match or null', () => {
    expect(querySelectorAllWithText(document, '.btn')).toHaveLength(4);
    expect(querySelectorWithText(document, '.btn:contains("merken")').getAttribute('href')).toBe('/wish');
    expect(querySelectorWithText(document, '.btn:contains("gibt es nicht")')).toBeNull();
  });

  test('countSelectorMatches, the flat/group preview matchers and the iframe-free hover path all understand the suffix', () => {
    expect(countSelectorMatches('.btn:contains("merken")')).toBe(2);
    expect(countSelectorMatches('.btn:contains("merken")', document.getElementById('c1'))).toBe(1);

    const flat = matchFlatFields([{ name: 'Link', selector: '.btn:contains("warenkorb")' }, { name: 'Fehlt', selector: '.btn:contains("nein")' }]);
    expect(flat.matches.map((m) => m.element.getAttribute('href'))).toEqual(['/cart']);
    expect(flat.empty).toEqual(['Fehlt']);

    const treeMatches = [];
    const treeEmpty = [];
    matchGroupTree(document, [{ name: 'Karte', selector: '.card:contains("vergleichen")', repeating: true, children: [{ name: 'Wunsch', selector: 'a:contains("merken")' }] }], treeMatches, treeEmpty);
    expect(treeMatches.map((m) => m.element.getAttribute('href') || m.element.id)).toEqual(['c1', '/wish']);
    expect(treeEmpty).toEqual([]);
  });
});

describe('COUNT_PICK_WITH_TEXT (live match count for a text filter on the last pick)', () => {
  let capturedListener;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <div class="card"><a class="btn" href="/a">Merken</a><a class="btn" href="/b">Vergleichen</a></div>
      <div class="card"><a class="btn" href="/c">Merken</a></div>
    `;
    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
    };
    require('./content-script');
  });

  afterEach(() => { delete global.chrome; });

  const ask = (text) => {
    const sendResponse = jest.fn();
    capturedListener({ type: 'COUNT_PICK_WITH_TEXT', text }, {}, sendResponse);
    return sendResponse;
  };

  test('does not answer before anything was picked', () => {
    expect(ask('Merken')).not.toHaveBeenCalled();
  });

  test('counts the matches of the last pick with the text appended, within the clicked instance', () => {
    capturedListener({ type: 'START_SELECTION', scopeSelector: '.card' });
    document.querySelector('.card .btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(ask('merken')).toHaveBeenCalledWith({ count: 1 });   // only this card's own "Merken" button
    expect(ask('vergleichen')).toHaveBeenCalledWith({ count: 1 }); // the pick's selector (a.btn) also matches the sibling button
    expect(ask('gibt es nicht')).toHaveBeenCalledWith({ count: 0 });
    expect(ask('  MERKEN ')).toHaveBeenCalledWith({ count: 1 });
  });

  test('quotes and backslashes in the typed text do not break the selector', () => {
    capturedListener({ type: 'START_SELECTION' });
    document.querySelector('.btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(ask('say "hi" \\ there')).toHaveBeenCalledWith({ count: 0 });
  });

  test('a new selection round forgets the previous pick', () => {
    capturedListener({ type: 'START_SELECTION' });
    document.querySelector('.btn').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    capturedListener({ type: 'START_SELECTION' });

    expect(ask('merken')).not.toHaveBeenCalled();
  });
});

// Issue #404: the JSON of the embedded <script> tag an API config came from.
describe('readEmbeddedJson', () => {
  afterEach(() => { document.body.innerHTML = ''; });

  test('returns the tag text for a selector that matches', () => {
    document.body.innerHTML = '<script id="__NEXT_DATA__" type="application/json">{"props":{"n":1}}</script>';
    expect(readEmbeddedJson('#__NEXT_DATA__')).toEqual({ body: '{"props":{"n":1}}', truncated: false, found: true });
  });

  test('reports "not found" for no selector, an unmatched one and an invalid one', () => {
    document.body.innerHTML = '<script id="x" type="application/json">{}</script>';
    const none = { body: '', truncated: false, found: false };
    expect(readEmbeddedJson('')).toEqual(none);
    expect(readEmbeddedJson('#nope')).toEqual(none);
    expect(readEmbeddedJson('###')).toEqual(none);
  });

  test('an oversized blob is reported as truncated, not cut', () => {
    document.body.innerHTML = `<script id="big" type="application/json">${'x'.repeat(2000001)}</script>`;
    expect(readEmbeddedJson('#big')).toEqual({ body: '', truncated: true, found: true });
  });
});
