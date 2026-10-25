const {
  buildSelector,
  countSelectorMatches,
  elementPath,
  serializeDomTree,
  matchFlatFields,
  matchGroupTree,
  computePreviewMatches,
  findApiCandidates,
  resolveFramePath,
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
// (see popup.ts's hasRepeatingAncestor). avoidId tells buildSelector to keep
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

// ── countSelectorMatches (Issue #85) ─────────────────────────────────────────

describe('countSelectorMatches', () => {
  test('counts every match on the page when no scope root is given', () => {
    document.body.innerHTML = `
      <li class="item"></li>
      <li class="item"></li>
      <li class="item"></li>
    `;
    expect(countSelectorMatches('li.item')).toBe(3);
  });

  test('returns 0 for a selector matching nothing', () => {
    document.body.innerHTML = '<div></div>';
    expect(countSelectorMatches('.does-not-exist')).toBe(0);
  });

  test('scoped to a container root, only counts matches within that instance', () => {
    document.body.innerHTML = `
      <section class="category">
        <li class="item"></li>
        <li class="item"></li>
      </section>
      <li class="item"></li>
    `;
    const scopeRoot = document.querySelector('section.category');
    expect(countSelectorMatches('li.item', scopeRoot)).toBe(2);
  });

  test('an invalid selector is reported as null rather than throwing', () => {
    document.body.innerHTML = '<div></div>';
    expect(countSelectorMatches(':::not-a-selector')).toBeNull();
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
// selector should be pickable (see content-script.ts startSelection/onClick).

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
  // (Issue #42 — see content-script.ts) even though it resolves
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

  // Issue #429: every pick is named, so the panel can mark it handled.
  test('every ELEMENT_SELECTED carries its own pickId', async () => {
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });
    const target = document.querySelector('h3.item-name');
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;
    const ids = chrome.runtime.sendMessage.mock.calls.map((c) => c[0]).filter((m) => m.type === 'ELEMENT_SELECTED').map((m) => m.pickId);
    expect(ids).toHaveLength(2);
    expect(ids.every((id) => typeof id === 'string' && id.length > 3)).toBe(true);
    expect(ids[0]).not.toBe(ids[1]);
  });

  // Issue #85: the match count travels alongside the selector on the same
  // ELEMENT_SELECTED message, scoped to the container instance exactly like
  // the selector itself already is — a second, unscoped category elsewhere
  // on the page must not inflate the count.
  test('ELEMENT_SELECTED carries a matchCount scoped to the container instance', async () => {
    document.body.innerHTML = `
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name">Suppe</h3></li>
      </section>
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name">Salat</h3></li>
      </section>
    `;
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

    document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      selector: 'li.menu-item > h3.item-name',
      matchCount: 1, // only the scoped instance's own h3, not the second section's
    }));
  });

  // Issue #143: rawText/attributes travel alongside the selector so a
  // transform-chain live preview can run against the real picked value
  // without a second content-script round trip.
  test('ELEMENT_SELECTED carries the clicked element\'s trimmed text and attributes', async () => {
    document.body.innerHTML = `
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name" data-id="42">  Suppe  </h3></li>
      </section>
    `;
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

    document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      rawText: 'Suppe',
      attributes: { class: 'item-name', 'data-id': '42' },
      ownText: 'Suppe', // no nested elements here, so same as rawText
    }));
  });

  // Issue #169: the exact real-world bug report — ownText must differ from
  // rawText when a nested element (the badge) contributes some of the
  // element's full text content.
  test('ELEMENT_SELECTED carries an ownText that excludes a nested element\'s text, unlike rawText', async () => {
    document.body.innerHTML = `
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name">Burrata mit Tomaten<span class="item-badge vegan">vegan möglich</span></h3></li>
      </section>
    `;
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

    document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      rawText: 'Burrata mit Tomatenvegan möglich', // full descendant text, badge included
      ownText: 'Burrata mit Tomaten', // direct text node only, badge excluded
    }));
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

  // Issue #137: a miss now retries for a short window (see
  // retryScopeSelector) before finally giving up — advancing fake timers
  // past the full retry window reproduces "never appears" and lets this
  // test assert the eventual SELECTION_UNAVAILABLE without a real ~1.8s wait.
  test('a scopeSelector matching nothing on the page sends SELECTION_UNAVAILABLE (after the retry window) and does not arm selection', () => {
    jest.useFakeTimers();
    try {
      capturedListener({ type: 'START_SELECTION', scopeSelector: '.does-not-exist' });

      // Not sent immediately — a miss now retries first, see below.
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SELECTION_UNAVAILABLE' }));

      jest.advanceTimersByTime(2000); // past SCOPE_SELECTOR_RETRY_TIMEOUT_MS

      // Issue #137 follow-up: tagged with unavailableKind so popup.ts can
      // tell this "retried and still nothing" case apart from the other
      // SELECTION_UNAVAILABLE sender (service-worker.ts, no content script
      // at all) and present it as a softer warning instead of a hard error.
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
        type: 'SELECTION_UNAVAILABLE', unavailableKind: 'scopeSelectorNotFound',
      }));

      chrome.runtime.sendMessage.mockClear();
      document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  // Issue #137: the exact real-world scenario (penny.de's offers page —
  // server-rendered skeleton tiles swapped for the real ones once
  // client-side JS hydrates) — a selector missing on the very first lookup
  // must not be a hard failure if the element shows up moments later.
  describe('scope-selector retry (Issue #137)', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    test('retries a miss and arms selection once the element appears within the retry window', async () => {
      document.body.innerHTML = '<div id="outside">Outside</div>'; // no .menu-category yet
      capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

      // Simulates the page hydrating/swapping in the real element mid-retry.
      document.body.insertAdjacentHTML(
        'beforeend',
        '<section class="menu-category"><li class="menu-item"><h3 class="item-name">Suppe</h3></li></section>',
      );
      jest.advanceTimersByTime(300); // a couple of retry ticks — well within the window

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SELECTION_UNAVAILABLE' }));

      document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await null;
      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ELEMENT_SELECTED' }));
    });

    // A pending retry from a round the user already cancelled (or a newer
    // START_SELECTION superseded) must never re-arm selection or send a
    // stale SELECTION_UNAVAILABLE later — see selectionGeneration.
    test('STOP_SELECTION cancels a pending retry — no stale SELECTION_UNAVAILABLE fires later', () => {
      document.body.innerHTML = '<div id="outside">Outside</div>';
      capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });
      capturedListener({ type: 'STOP_SELECTION' });

      jest.advanceTimersByTime(2000); // past SCOPE_SELECTOR_RETRY_TIMEOUT_MS

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SELECTION_UNAVAILABLE' }));
    });

    // Same guard, exercised via a second START_SELECTION instead of an
    // explicit STOP_SELECTION — the first round's own pending retry must
    // not clobber the second, still-active round's state.
    test('a second START_SELECTION supersedes a pending retry from the first', () => {
      document.body.innerHTML = '<div id="outside">Outside</div>';
      capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });
      capturedListener({ type: 'START_SELECTION' }); // unscoped — matches immediately, no retry

      jest.advanceTimersByTime(2000);

      expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'SELECTION_UNAVAILABLE' }));
    });
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

  // Issue #167: a sub-element only present in a *later* instance of the
  // repeating group (e.g. an optional "vegan" badge some menu items don't
  // have) used to be permanently unselectable, because scoping bound to
  // document.querySelector's implicit first match only. It must now be
  // pickable by clicking it in whichever instance actually has it.
  test('a click on a sub-element only present in the second (not first) instance is selectable', async () => {
    document.body.innerHTML = `
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name">Suppe</h3></li>
      </section>
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name">Salat</h3><span class="badge-vegan">Vegan</span></li>
      </section>
    `;
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

    document.querySelector('.badge-vegan').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      selector: 'li.menu-item > span.badge-vegan',
    }));
  });

  // The selector must stay relative to whichever instance was actually
  // clicked (here, the second one) — matchCount counts only within that
  // instance, exactly like the existing "scoped to the container instance"
  // test above does for the first-instance case.
  test('matchCount for a second-instance click stays scoped to that instance, not the whole page', async () => {
    document.body.innerHTML = `
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name">Suppe</h3></li>
      </section>
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name">Salat</h3></li>
        <li class="menu-item"><h3 class="item-name">Tomate</h3></li>
      </section>
    `;
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

    document.querySelectorAll('h3.item-name')[1].dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      selector: 'li.menu-item > h3.item-name',
      matchCount: 2, // both h3s in the second section, not the first section's one
    }));
  });

  // A click genuinely outside every instance must still be rejected exactly
  // as before, and now also nudges the popup with a toast hint instead of
  // being silent.
  test('a click outside every instance is still ignored, and now also sends SELECTION_CLICK_OUT_OF_SCOPE', async () => {
    document.body.innerHTML = `
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name">Suppe</h3></li>
      </section>
      <section class="menu-category">
        <li class="menu-item"><h3 class="item-name">Salat</h3></li>
      </section>
      <div id="outside">Outside</div>
    `;
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

    document.getElementById('outside').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ELEMENT_SELECTED' }));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SELECTION_CLICK_OUT_OF_SCOPE' }));
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

  // Issue #507: the main data-point search asks both sources with one click and gets one merged answer.
  describe('apiSearch + embeddedJsonSearch together', () => {
    const embed = (data) => {
      const script = document.createElement('script');
      script.type = 'application/json';
      script.id = 'page-data';
      script.textContent = JSON.stringify(data);
      document.body.appendChild(script);
    };
    const click = async () => {
      capturedListener({ type: 'START_SELECTION', apiSearch: true, embeddedJsonSearch: true });
      document.querySelector('.price').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      await null;
    };
    const sent = (type) => chrome.runtime.sendMessage.mock.calls.map(c => c[0]).filter(m => m.type === type);

    test('a value in both sources is offered twice in ONE API_CANDIDATES message, the recorded hit first', async () => {
      feedEntry({ id: 1, url: 'https://example.com/api', method: 'GET', contentType: 'application/json', body: JSON.stringify({ items: [{ price: '3.50' }] }), bodySkipped: false });
      embed({ items: [{ price: '3.50' }] });
      await click();

      const messages = sent('API_CANDIDATES');
      expect(messages).toHaveLength(1);
      expect(messages[0].candidates).toHaveLength(2);
      expect(messages[0].candidates[0]).toMatchObject({ url: 'https://example.com/api' });
      expect(messages[0].candidates[1]).toMatchObject({ scriptSelector: '#page-data' });
      expect(sent('EMBEDDED_JSON_CANDIDATES')).toHaveLength(0);
    });

    test('embedded JSON is found without any recording', async () => {
      embed({ items: [{ price: '3.50' }] });
      await click();

      const [message] = sent('API_CANDIDATES');
      expect(message.candidates).toEqual([expect.objectContaining({ scriptSelector: '#page-data', path: 'items[0].price' })]);
    });

    test('a recorded hit is found on a page without embedded JSON', async () => {
      feedEntry({ id: 1, url: 'https://example.com/api', method: 'GET', contentType: 'application/json', body: JSON.stringify({ price: '3.50' }), bodySkipped: false });
      await click();

      expect(sent('API_CANDIDATES')[0].candidates).toEqual([expect.objectContaining({ url: 'https://example.com/api' })]);
    });

    test('no hit in either source is an empty list, not silence', async () => {
      await click();
      expect(sent('API_CANDIDATES')).toEqual([{ type: 'API_CANDIDATES', target: '3.50', candidates: [] }]);
    });
  });

  test('a scoped embedded-JSON search (adding to an embedded tree) still answers with EMBEDDED_JSON_CANDIDATES only', async () => {
    const script = document.createElement('script');
    script.type = 'application/json';
    script.id = 'page-data';
    script.textContent = JSON.stringify({ items: [{ price: '3.50' }] });
    document.body.appendChild(script);

    capturedListener({ type: 'START_SELECTION', embeddedJsonSearch: true, embeddedJsonScriptSelector: '#page-data' });
    document.querySelector('.price').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    const types = chrome.runtime.sendMessage.mock.calls.map(c => c[0].type);
    expect(types).toContain('EMBEDDED_JSON_CANDIDATES');
    expect(types).not.toContain('API_CANDIDATES');
  });

  test('a click without apiSearch never sends API_CANDIDATES, even with entries buffered', async () => {
    feedEntry({ id: 1, url: 'https://example.com/api', contentType: 'application/json', body: JSON.stringify({ price: '3.50' }), bodySkipped: false });

    capturedListener({ type: 'START_SELECTION' }); // no apiSearch flag
    document.querySelector('.price').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'API_CANDIDATES' }));
  });

  test('a click while apiScopePath is set only reports candidates inside that scope (Phase A3, Phase A5 use case)', async () => {
    feedEntry({ id: 1, url: 'https://example.com/api', contentType: 'application/json', body: JSON.stringify({ a: { price: '3.50' }, b: { price: '3.50' } }), bodySkipped: false });

    capturedListener({ type: 'START_SELECTION', apiSearch: true, apiScopePath: 'a' });
    document.querySelector('.price').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await null;

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'API_CANDIDATES',
      target: '3.50',
      candidates: [expect.objectContaining({ path: 'a.price' })],
    });
  });

  test('apiScopePath is ignored (no filtering) unless apiSearch is also set', async () => {
    feedEntry({ id: 1, url: 'https://example.com/api', contentType: 'application/json', body: JSON.stringify({ price: '3.50' }), bodySkipped: false });

    capturedListener({ type: 'START_SELECTION', apiScopePath: 'a' }); // no apiSearch flag
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

  // Recorded-endpoints panel / pool-derived value-list autofill follow-up:
  // GET_API_CAPTURE_ENTRIES exposes the same locally buffered pool
  // findApiCandidates already searches at click time, but on demand — same
  // request/response shape as GET_LOGS above (isTopFrame-gated, synchronous
  // sendResponse).
  test('GET_API_CAPTURE_ENTRIES responds with the locally buffered pool', () => {
    feedEntry({ id: 1, url: 'https://example.com/api', method: 'GET', status: 200, contentType: 'application/json', body: '{}', bodySkipped: false });
    feedEntry({ id: 2, url: 'https://example.com/api2', method: 'GET', status: 200, contentType: 'application/json', body: '{}', bodySkipped: false });
    const sendResponse = jest.fn();

    capturedListener({ type: 'GET_API_CAPTURE_ENTRIES' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledTimes(1);
    const entries = sendResponse.mock.calls[0][0];
    expect(entries.map(e => e.id)).toEqual([1, 2]);
  });

  test('GET_API_CAPTURE_ENTRIES reflects a subsequent API_CAPTURE_START reset', () => {
    feedEntry({ id: 1, url: 'https://example.com/api', bodySkipped: false });
    capturedListener({ type: 'API_CAPTURE_START' });
    const sendResponse = jest.fn();

    capturedListener({ type: 'GET_API_CAPTURE_ENTRIES' }, {}, sendResponse);

    expect(sendResponse).toHaveBeenCalledWith([]);
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
