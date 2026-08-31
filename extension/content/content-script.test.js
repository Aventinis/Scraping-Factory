const {
  buildSelector, elementPath, serializeDomTree,
  matchFlatFields, matchGroupTree, computePreviewMatches,
  findValueInJson, siblingFields, findApiCandidates, deriveItemsAndValuePath,
  findIframeSelectorForWindow, resolveFramePath, frameDepth,
} = require('./content-script');

function el(tag, { id, classes } = {}) {
  const e = document.createElement(tag);
  if (id) e.id = id;
  if (classes) e.className = classes;
  return e;
}

test('element with id returns #id and stops', () => {
  const a = el('div', { id: 'logo' });
  expect(buildSelector(a)).toBe('#logo');
});

test('element with classes returns tag.class1.class2', () => {
  document.body.innerHTML = '';
  const span = el('span', { classes: 'price amount' });
  document.body.appendChild(span);
  expect(buildSelector(span)).toBe('span.price.amount');
});

test('nested element builds path with >', () => {
  document.body.innerHTML = '';
  const li = el('li', { classes: 'card' });
  const h2 = el('h2', { classes: 'product-title' });
  li.appendChild(h2);
  document.body.appendChild(li);
  expect(buildSelector(h2)).toBe('li.card > h2.product-title');
});

test('element with id in ancestor stops path at id', () => {
  document.body.innerHTML = '';
  const section = el('section', { id: 'main' });
  const div = el('div', { classes: 'inner' });
  const p = el('p', { classes: 'text' });
  section.appendChild(div);
  div.appendChild(p);
  document.body.appendChild(section);
  expect(buildSelector(p)).toBe('#main > div.inner > p.text');
});

test('depth limit: path has at most 4 segments', () => {
  document.body.innerHTML = '';
  let current = document.body;
  for (const tag of ['article', 'section', 'div', 'ul', 'li', 'span']) {
    const child = el(tag);
    current.appendChild(child);
    current = child;
  }
  const segments = buildSelector(current).split(' > ');
  expect(segments.length).toBeLessThanOrEqual(4);
});

test('element without classes or id returns tagName only', () => {
  document.body.innerHTML = '';
  const p = el('p');
  document.body.appendChild(p);
  expect(buildSelector(p)).toBe('p');
});

// ── scopeRoot (Container-Mode) ───────────────────────────────────────────────

describe('buildSelector with a scopeRoot', () => {
  test('stops the upward walk at scopeRoot instead of document.body', () => {
    document.body.innerHTML = '';
    const section = el('section', { classes: 'menu-category' });
    const li = el('li', { classes: 'menu-item' });
    const h3 = el('h3', { classes: 'item-name' });
    li.appendChild(h3);
    section.appendChild(li);
    document.body.appendChild(section);

    expect(buildSelector(h3, li)).toBe('h3.item-name');
    expect(buildSelector(h3, section)).toBe('li.menu-item > h3.item-name');
    expect(buildSelector(h3)).toBe('section.menu-category > li.menu-item > h3.item-name');
  });

  test('an id inside the scope still short-circuits the walk', () => {
    document.body.innerHTML = '';
    const section = el('section', { classes: 'menu-category' });
    const span = el('span', { id: 'price' });
    section.appendChild(span);
    document.body.appendChild(section);

    expect(buildSelector(span, section)).toBe('#price');
  });
});

// ── avoidId (repeating containers/fields) ────────────────────────────────────
// A page-unique id can only ever match one element — self-defeating for a
// "Wiederholend" container's own selector, or anything nested inside one
// (see popup.js's hasRepeatingAncestor). avoidId tells buildSelector to keep
// walking past an id-bearing element instead of shortcutting to `#id`.

describe('buildSelector with avoidId', () => {
  test('skips an id on the clicked element itself, falling back to its class', () => {
    document.body.innerHTML = '';
    const section = el('section', { id: 'vorspeisen', classes: 'menu-category' });
    document.body.appendChild(section);

    expect(buildSelector(section)).toBe('#vorspeisen'); // unchanged default behavior
    expect(buildSelector(section, undefined, true)).toBe('section.menu-category');
  });

  test('skips an id on an ancestor and keeps walking up to the next segment', () => {
    document.body.innerHTML = '';
    const main = el('main', { classes: 'menu' });
    const section = el('section', { id: 'vorspeisen', classes: 'menu-category' });
    const h2 = el('h2', { classes: 'category-title' });
    section.appendChild(h2);
    main.appendChild(section);
    document.body.appendChild(main);

    expect(buildSelector(h2, undefined, true)).toBe('main.menu > section.menu-category > h2.category-title');
  });

  test('without avoidId, an id ancestor still stops the walk there (default unchanged)', () => {
    document.body.innerHTML = '';
    const section = el('section', { id: 'vorspeisen', classes: 'menu-category' });
    const h2 = el('h2', { classes: 'category-title' });
    section.appendChild(h2);
    document.body.appendChild(section);

    expect(buildSelector(h2)).toBe('#vorspeisen > h2.category-title');
  });
});

// ── elementPath ────────────────────────────────────────────────────────────────

describe('elementPath', () => {
  test('body itself has an empty path', () => {
    expect(elementPath(document.body)).toEqual([]);
  });

  test('direct child of body has a single-index path', () => {
    document.body.innerHTML = '<div></div><section></section>';
    expect(elementPath(document.body.children[1])).toEqual([1]);
  });

  test('deeply nested element builds a multi-index path', () => {
    document.body.innerHTML = '<ul><li></li><li><span></span></li></ul>';
    const span = document.body.querySelector('span');
    expect(elementPath(span)).toEqual([0, 1, 0]);
  });
});

// ── serializeDomTree ─────────────────────────────────────────────────────────

describe('serializeDomTree', () => {
  test('serializes tag, id, classes and nested children', () => {
    document.body.innerHTML = '<section id="main"><p class="a b">x</p></section>';
    const { tree, truncated } = serializeDomTree();

    expect(tree.tag).toBe('body');
    expect(tree.path).toEqual([]);
    expect(tree.children[0]).toMatchObject({ tag: 'section', id: 'main', path: [0] });
    expect(tree.children[0].children[0]).toMatchObject({
      tag: 'p', id: null, classes: ['a', 'b'], path: [0, 0],
    });
    expect(truncated).toBe(false);
  });

  test('truncates when the page has more elements than the cap', () => {
    let html = '';
    for (let i = 0; i < 1600; i++) html += '<div></div>';
    document.body.innerHTML = html;

    const { truncated } = serializeDomTree();
    expect(truncated).toBe(true);
  });
});

// ── Hover message throttling ──────────────────────────────────────────────────
// Regression coverage: an earlier version sent one HOVER_ELEMENT message per
// mouseover (which fires on every element-boundary crossing) and flooded the
// extension's message channel badly enough to also delay/break plain
// selection. Hover sends must now coalesce to one per animation frame.

describe('hover message throttling (message-listener wiring)', () => {
  let capturedListener;

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers();
    jest.clearAllTimers(); // drop any rAF left pending by a previous test's module instance
    document.body.innerHTML = '<div id="a"><div id="b"><div id="c"></div></div></div>';

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
    };

    require('./content-script');
  });

  afterEach(() => {
    // document is shared across tests in this file — without this, a
    // test's mouseover/click listeners stay attached and fire (with stale
    // closures) during later tests.
    capturedListener({ type: 'STOP_SELECTION' });
    jest.useRealTimers();
    delete global.chrome;
  });

  test('coalesces rapid mouseover events into a single HOVER_ELEMENT send per frame', () => {
    capturedListener({ type: 'START_SELECTION' });
    capturedListener({ type: 'ENABLE_DOM_VIEW' });
    chrome.runtime.sendMessage.mockClear(); // drop the DOM_TREE send triggered by ENABLE_DOM_VIEW

    ['a', 'b', 'c'].forEach((id) => {
      document.getElementById(id).dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });

    // Nothing sent yet — the send is deferred to the next animation frame.
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();

    jest.advanceTimersByTime(50);

    expect(chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'HOVER_ELEMENT', path: [0, 0, 0],
    });
  });

  test('STOP_SELECTION cancels a pending coalesced hover send', () => {
    capturedListener({ type: 'START_SELECTION' });
    capturedListener({ type: 'ENABLE_DOM_VIEW' });
    chrome.runtime.sendMessage.mockClear();

    document.getElementById('a').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    capturedListener({ type: 'STOP_SELECTION' });

    jest.advanceTimersByTime(50);

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('no HOVER_ELEMENT is sent when the DOM view was never enabled', () => {
    capturedListener({ type: 'START_SELECTION' });

    document.getElementById('a').dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    jest.advanceTimersByTime(50);

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('GET_LOGS responds with this context\'s log buffer', () => {
    capturedListener({ type: 'START_SELECTION' }); // generates at least one log entry
    const sendResponse = jest.fn();

    capturedListener({ type: 'GET_LOGS' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledTimes(1);
    const logs = sendResponse.mock.calls[0][0];
    expect(Array.isArray(logs)).toBe(true);
    expect(logs.some(e => e.event === 'MSG_IN')).toBe(true);
  });
});

// ── Scoped selection (Container-Mode) ────────────────────────────────────────
// START_SELECTION carries an optional scopeSelector when adding a nested
// container/field — only descendants of the first element matching that
// selector should be pickable (see content-script.js startSelection/onClick).

describe('scoped selection (START_SELECTION with scopeSelector)', () => {
  let capturedListener;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name">Suppe</h3></li>
      </section>
      <div id="outside">Outside</div>
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
    capturedListener({ type: 'STOP_SELECTION' });
    delete global.chrome;
  });

  // ELEMENT_SELECTED now goes out after an async resolveFramePath() call
  // (Issue #42 — see content-script.js) even though it resolves
  // synchronously-in-effect here (jsdom has no real nested window, so
  // window === window.top and resolveFramePath() is Promise.resolve([]));
  // `await null` flushes that one microtask before asserting.

  test('a click inside the scope sends ELEMENT_SELECTED with a selector relative to the scope root', async () => {
    const section = document.querySelector('section.menu-category');
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

    document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      selector: 'li.menu-item > h3.item-name',
      framePath: null,
    }));
    expect(section).toBeTruthy(); // sanity: the scope root itself was found, not just any element
  });

  test('a click outside the scope is ignored — no ELEMENT_SELECTED, selection stays active', async () => {
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

    document.getElementById('outside').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ELEMENT_SELECTED' }));

    // Selection is still active: a subsequent in-scope click now succeeds.
    document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ELEMENT_SELECTED' }));
  });

  test('a scopeSelector matching nothing on the page sends SELECTION_UNAVAILABLE and does not arm selection', async () => {
    capturedListener({ type: 'START_SELECTION', scopeSelector: '.does-not-exist' });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SELECTION_UNAVAILABLE' }));

    chrome.runtime.sendMessage.mockClear();
    document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('no scopeSelector behaves like today — any element on the page is pickable', async () => {
    capturedListener({ type: 'START_SELECTION' });

    document.getElementById('outside').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      selector: '#outside',
    }));
  });

  // Regression: picking a "Wiederholend" container by clicking an element
  // that (or whose ancestor) has an id used to always produce an id
  // selector, matching only that one element instead of all repetitions.
  test('avoidId: true skips an id-bearing element, producing a class-based selector instead', async () => {
    document.getElementById('outside').id = 'vorspeisen';
    document.getElementById('vorspeisen').className = 'menu-category';

    capturedListener({ type: 'START_SELECTION', avoidId: true });
    document.getElementById('vorspeisen').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      selector: 'div.menu-category',
    }));
  });

  test('without avoidId, the same id-bearing element still short-circuits to #id (default unchanged)', async () => {
    document.getElementById('outside').id = 'vorspeisen';
    document.getElementById('vorspeisen').className = 'menu-category';

    capturedListener({ type: 'START_SELECTION' });
    document.getElementById('vorspeisen').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      selector: '#vorspeisen',
    }));
  });
});

// ── API-mode search selection (START_SELECTION with apiSearch) ─────────────
// capturedApiEntries (fed by the API_CAPTURE bridge below) is module-level
// state, so these tests populate it the same way the bridge tests do:
// dispatching a synthetic postMessage 'message' event rather than a real
// (async) postMessage round-trip.

describe('API-mode search selection (START_SELECTION with apiSearch)', () => {
  let capturedListener;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = '<p class="price">3.50</p>';

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
    };

    require('./content-script');
  });

  afterEach(() => {
    capturedListener({ type: 'STOP_SELECTION' });
    delete global.chrome;
  });

  function feedEntry(entry) {
    window.dispatchEvent(new MessageEvent('message', {
      data: { source: 'sf-api-capture', type: 'API_CAPTURE_ENTRY', entry }, source: window,
    }));
  }

  test('a click while apiSearch is active sends both ELEMENT_SELECTED and API_CANDIDATES', async () => {
    feedEntry({ id: 1, url: 'https://example.com/api', method: 'GET', status: 200, contentType: 'application/json', body: JSON.stringify({ price: '3.50' }), bodyTruncated: false, bodySkipped: false });

    capturedListener({ type: 'START_SELECTION', apiSearch: true });
    document.querySelector('.price').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ELEMENT_SELECTED' }));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'API_CANDIDATES',
      target: '3.50',
      candidates: [expect.objectContaining({ path: 'price', value: '3.50' })],
    });
  });

  test('a click without apiSearch never sends API_CANDIDATES, even with entries buffered', async () => {
    feedEntry({ id: 1, url: 'https://example.com/api', contentType: 'application/json', body: JSON.stringify({ price: '3.50' }), bodySkipped: false });

    capturedListener({ type: 'START_SELECTION' }); // no apiSearch flag
    document.querySelector('.price').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'API_CANDIDATES' }));
  });

  test('API_CAPTURE_START clears the locally buffered entries a later apiSearch click would search', async () => {
    feedEntry({ id: 1, url: 'https://example.com/api', contentType: 'application/json', body: JSON.stringify({ price: '3.50' }), bodySkipped: false });

    capturedListener({ type: 'API_CAPTURE_START' });

    capturedListener({ type: 'START_SELECTION', apiSearch: true });
    document.querySelector('.price').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'API_CANDIDATES', target: '3.50', candidates: [] });
  });
});

// ── Preview-mode matching ────────────────────────────────────────────────────
// Pure functions — no chrome mock needed, same style as buildSelector above.

describe('matchFlatFields', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <h2 class="title">Erstes</h2>
      <h2 class="title">Zweites</h2>
      <span class="price">1,99</span>
    `;
  });

  test('collects every match per field, index order preserved', () => {
    const { matches, empty } = matchFlatFields([
      { name: 'Titel', selector: '.title' },
      { name: 'Preis', selector: '.price' },
    ]);
    expect(matches.map(m => m.name)).toEqual(['Titel', 'Titel', 'Preis']);
    expect(matches[0].element.textContent).toBe('Erstes');
    expect(matches[1].element.textContent).toBe('Zweites');
    expect(empty).toEqual([]);
  });

  test('a field with zero matches is reported in `empty`, others unaffected', () => {
    const { matches, empty } = matchFlatFields([
      { name: 'Titel', selector: '.title' },
      { name: 'Fehlt', selector: '.does-not-exist' },
    ]);
    expect(matches.map(m => m.name)).toEqual(['Titel', 'Titel']);
    expect(empty).toEqual(['Fehlt']);
  });

  test('an invalid selector is treated as zero matches instead of throwing', () => {
    const { matches, empty } = matchFlatFields([{ name: 'Kaputt', selector: ':::not-css' }]);
    expect(matches).toEqual([]);
    expect(empty).toEqual(['Kaputt']);
  });
});

describe('matchGroupTree', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <ul class="menu">
        <li class="item"><h3 class="name">Suppe</h3><span class="price">3,50</span></li>
        <li class="item"><h3 class="name">Salat</h3></li>
      </ul>
      <div class="footer" id="footer-single"><span class="text">Impressum</span></div>
    `;
  });

  test('a repeating group recurses into every match, a field leaf is a single match per instance', () => {
    const groups = [{
      name: 'Gericht', selector: '.item', repeating: true,
      children: [
        { name: 'Name', selector: '.name' },
        { name: 'Preis', selector: '.price' },
      ],
    }];
    const matches = [];
    const empty = [];
    matchGroupTree(document, groups, matches, empty);

    expect(matches.filter(m => m.name === 'Gericht')).toHaveLength(2);
    expect(matches.filter(m => m.name === 'Name').map(m => m.element.textContent)).toEqual(['Suppe', 'Salat']);
    // Second "Gericht" instance has no .price — the group itself still matched, only the field leaf is empty.
    expect(matches.filter(m => m.name === 'Preis')).toHaveLength(1);
    expect(empty).toEqual(['Preis']);
  });

  test('a non-repeating group resolves at most one instance (select_one semantics)', () => {
    const groups = [{
      name: 'Fußzeile', selector: '.footer', repeating: false,
      children: [{ name: 'Text', selector: '.text' }],
    }];
    const matches = [];
    const empty = [];
    matchGroupTree(document, groups, matches, empty);

    expect(matches.filter(m => m.name === 'Fußzeile')).toHaveLength(1);
    expect(empty).toEqual([]);
  });

  test('a non-repeating group with zero matches is omitted, not an error', () => {
    const groups = [{
      name: 'Fehlt', selector: '.does-not-exist', repeating: false,
      children: [{ name: 'Text', selector: '.name' }],
    }];
    const matches = [];
    const empty = [];
    matchGroupTree(document, groups, matches, empty);

    expect(matches).toEqual([]);
    expect(empty).toEqual(['Fehlt']);
  });

  test('nested groups scope their children to each instance', () => {
    document.body.innerHTML = `
      <section class="cat"><li class="item"><h3 class="name">A</h3></li></section>
      <section class="cat"><li class="item"><h3 class="name">B</h3></li><li class="item"><h3 class="name">C</h3></li></section>
    `;
    const groups = [{
      name: 'Kategorie', selector: '.cat', repeating: true,
      children: [{
        name: 'Gericht', selector: '.item', repeating: true,
        children: [{ name: 'Name', selector: '.name' }],
      }],
    }];
    const matches = [];
    const empty = [];
    matchGroupTree(document, groups, matches, empty);

    expect(matches.filter(m => m.name === 'Name').map(m => m.element.textContent)).toEqual(['A', 'B', 'C']);
  });
});

describe('computePreviewMatches', () => {
  test('dispatches to matchFlatFields for flat mode', () => {
    document.body.innerHTML = '<p class="x">Hi</p>';
    const { matches } = computePreviewMatches('flat', [{ name: 'X', selector: '.x' }], []);
    expect(matches).toHaveLength(1);
  });

  test('dispatches to matchGroupTree for container mode', () => {
    document.body.innerHTML = '<div class="g"><span class="f">Hi</span></div>';
    const groups = [{ name: 'G', selector: '.g', repeating: false, children: [{ name: 'F', selector: '.f' }] }];
    const { matches } = computePreviewMatches('container', [], groups);
    expect(matches.map(m => m.name)).toEqual(['G', 'F']);
  });
});

// ── API-Mode candidate correlation (Issue #53 Phase 4) ──────────────────────

describe('findValueInJson', () => {
  test('finds a scalar string match nested inside objects and arrays, with a dot/[n] path', () => {
    const data = { data: { items: [{ name: 'Suppe', price: 3.5 }, { name: 'Salat', price: 4 }] } };
    const matches = findValueInJson(data, 'Salat', []);
    expect(matches).toEqual([{ path: 'data.items[1].name', value: 'Salat' }]);
  });

  test('matches numbers/booleans via their string representation', () => {
    const data = { items: [{ price: 3.5 }, { inStock: true }] };
    expect(findValueInJson(data, '3.5', [])).toEqual([{ path: 'items[0].price', value: 3.5 }]);
    expect(findValueInJson(data, 'true', [])).toEqual([{ path: 'items[1].inStock', value: true }]);
  });

  test('trims whitespace on both the target and the search (a clicked element\'s textContent often has stray whitespace)', () => {
    const data = { name: 'Suppe' };
    expect(findValueInJson(data, '  Suppe  ', [])).toEqual([{ path: 'name', value: 'Suppe' }]);
  });

  test('returns every occurrence when the value appears more than once', () => {
    const data = { a: { x: 'Suppe' }, b: [{ x: 'Suppe' }] };
    const matches = findValueInJson(data, 'Suppe', []);
    expect(matches.map(m => m.path).sort()).toEqual(['a.x', 'b[0].x']);
  });

  test('never matches an object/array itself, only scalar leaves', () => {
    const data = { items: [{ name: 'x' }] };
    expect(findValueInJson(data, '[object Object]', [])).toEqual([]);
  });

  test('returns nothing for an empty/whitespace-only target', () => {
    expect(findValueInJson({ a: 'x' }, '   ', [])).toEqual([]);
  });
});

describe('siblingFields', () => {
  const data = { items: [{ name: 'Suppe', price: 3.5, tags: ['vegan'], meta: null }] };

  test('returns the other scalar keys of the object containing the match', () => {
    const siblings = siblingFields(data, 'items[0].name');
    expect(siblings).toEqual(expect.arrayContaining([
      { name: 'price', path: 'items[0].price', value: 3.5 },
    ]));
    expect(siblings.find(s => s.name === 'name')).toBeUndefined(); // excludes the matched key itself
  });

  test('excludes object/array-valued siblings (only flat fields are supported)', () => {
    const siblings = siblingFields(data, 'items[0].name');
    expect(siblings.find(s => s.name === 'tags')).toBeUndefined();
    expect(siblings.find(s => s.name === 'meta')).toBeUndefined(); // null is typeof 'object' too
  });

  test('a match that is itself a bare array element has no named siblings', () => {
    expect(siblingFields({ tags: ['vegan', 'scharf'] }, 'tags[0]')).toEqual([]);
  });

  test('a top-level match (no path) has no siblings', () => {
    expect(siblingFields({ a: 'x' }, '')).toEqual([]);
  });

  test('a match on a top-level key gets bare-path siblings (no leading dot)', () => {
    expect(siblingFields({ name: 'Suppe', price: 3.5 }, 'name')).toEqual([{ name: 'price', path: 'price', value: 3.5 }]);
  });
});

describe('findApiCandidates', () => {
  function entry(overrides) {
    return { id: 1, url: 'https://example.com/api', method: 'GET', status: 200, contentType: 'application/json', body: '{}', bodyTruncated: false, bodySkipped: false, ...overrides };
  }

  test('finds a candidate in a recorded JSON body, including sibling suggestions', () => {
    const entries = [entry({ body: JSON.stringify({ data: { items: [{ name: 'Suppe', price: 3.5 }] } }) })];
    const candidates = findApiCandidates(entries, 'Suppe');

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ entryId: 1, url: 'https://example.com/api', method: 'GET', path: 'data.items[0].name', value: 'Suppe' });
    expect(candidates[0].siblings).toEqual([{ name: 'price', path: 'data.items[0].price', value: 3.5 }]);
  });

  test('attaches the derived itemsPath/valuePath (Issue #53 Phase 5) so the popup does not need to re-derive them', () => {
    const entries = [entry({ body: JSON.stringify({ data: { items: [{ name: 'Suppe', price: 3.5 }] } }) })];
    const [candidate] = findApiCandidates(entries, 'Suppe');
    expect(candidate.itemsPath).toBe('data.items');
    expect(candidate.valuePath).toBe('name');
  });

  test('itemsPath/valuePath are null when the match is not inside any array', () => {
    const entries = [entry({ body: JSON.stringify({ meta: { name: 'Suppe' } }) })];
    const [candidate] = findApiCandidates(entries, 'Suppe');
    expect(candidate.itemsPath).toBeNull();
    expect(candidate.valuePath).toBeNull();
  });

  test('carries the source entry\'s requestHeaders through', () => {
    const entries = [entry({ body: JSON.stringify({ name: 'Suppe' }), requestHeaders: [{ name: 'Authorization', value: 'Bearer x' }] })];
    const [candidate] = findApiCandidates(entries, 'Suppe');
    expect(candidate.requestHeaders).toEqual([{ name: 'Authorization', value: 'Bearer x' }]);
  });

  test('defaults requestHeaders to an empty array when the entry has none', () => {
    const entries = [entry({ body: JSON.stringify({ name: 'Suppe' }) })];
    const [candidate] = findApiCandidates(entries, 'Suppe');
    expect(candidate.requestHeaders).toEqual([]);
  });

  test('skips entries with a non-JSON, skipped, or empty body instead of throwing', () => {
    const entries = [
      entry({ id: 1, body: 'not json' }),
      entry({ id: 2, bodySkipped: true, body: '' }),
      entry({ id: 3, body: '' }),
      entry({ id: 4, body: JSON.stringify({ name: 'Suppe' }) }),
    ];
    const candidates = findApiCandidates(entries, 'Suppe');
    expect(candidates.map(c => c.entryId)).toEqual([4]);
  });

  test('returns nothing when no entry contains the target text', () => {
    const entries = [entry({ body: JSON.stringify({ name: 'Salat' }) })];
    expect(findApiCandidates(entries, 'Suppe')).toEqual([]);
  });

  test('ranks a declared application/json body above a same-value match in a non-JSON-declared body', () => {
    const entries = [
      entry({ id: 1, contentType: 'text/plain', body: JSON.stringify({ name: 'Suppe' }) }),
      entry({ id: 2, contentType: 'application/json', body: JSON.stringify({ name: 'Suppe' }) }),
    ];
    const candidates = findApiCandidates(entries, 'Suppe');
    expect(candidates[0].entryId).toBe(2);
  });

  test('ranks a body where the value is unique above one where it recurs many times', () => {
    const entries = [
      entry({ id: 1, body: JSON.stringify({ items: [{ x: 'Suppe' }, { x: 'Suppe' }, { x: 'Suppe' }] }) }),
      entry({ id: 2, body: JSON.stringify({ name: 'Suppe' }) }),
    ];
    const candidates = findApiCandidates(entries, 'Suppe');
    expect(candidates[0].entryId).toBe(2);
  });

  test('caps the number of returned candidates at MAX_API_CANDIDATES (20)', () => {
    const items = Array.from({ length: 25 }, (_, i) => ({ name: 'Suppe', id: i }));
    const entries = [entry({ body: JSON.stringify({ items }) })];
    expect(findApiCandidates(entries, 'Suppe')).toHaveLength(20);
  });

  test('returns nothing for an empty target', () => {
    const entries = [entry({ body: JSON.stringify({ name: '' }) })];
    expect(findApiCandidates(entries, '   ')).toEqual([]);
  });
});

describe('deriveItemsAndValuePath (Issue #53 Phase 5)', () => {
  test('splits at the last array index into itemsPath (the array) and valuePath (relative to one record)', () => {
    expect(deriveItemsAndValuePath('data.items[2].price')).toEqual({ itemsPath: 'data.items', valuePath: 'price' });
  });

  test('supports a nested valuePath', () => {
    expect(deriveItemsAndValuePath('items[0].meta.price')).toEqual({ itemsPath: 'items', valuePath: 'meta.price' });
  });

  test('uses the *last* array index when a match sits inside nested arrays', () => {
    expect(deriveItemsAndValuePath('categories[0].items[3].name')).toEqual({ itemsPath: 'categories[0].items', valuePath: 'name' });
  });

  test('returns null when the path never enters an array (no repeating-records structure)', () => {
    expect(deriveItemsAndValuePath('meta.name')).toBeNull();
  });

  test('returns an empty valuePath when the match is itself the bare array element (no record object)', () => {
    expect(deriveItemsAndValuePath('tags[0]')).toEqual({ itemsPath: 'tags', valuePath: '' });
  });
});

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
// api-capture.js (MAIN world) talks to this isolated-world script via
// window.postMessage in both directions — see content-script.js's bridge.
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
