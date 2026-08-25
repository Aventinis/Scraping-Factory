const { buildSelector, elementPath, serializeDomTree } = require('./content-script');

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

  test('a click inside the scope sends ELEMENT_SELECTED with a selector relative to the scope root', () => {
    const section = document.querySelector('section.menu-category');
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

    document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      selector: 'li.menu-item > h3.item-name',
    }));
    expect(section).toBeTruthy(); // sanity: the scope root itself was found, not just any element
  });

  test('a click outside the scope is ignored — no ELEMENT_SELECTED, selection stays active', () => {
    capturedListener({ type: 'START_SELECTION', scopeSelector: 'section.menu-category' });

    document.getElementById('outside').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'ELEMENT_SELECTED' }));

    // Selection is still active: a subsequent in-scope click now succeeds.
    document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'ELEMENT_SELECTED' }));
  });

  test('a scopeSelector matching nothing on the page sends SELECTION_UNAVAILABLE and does not arm selection', () => {
    capturedListener({ type: 'START_SELECTION', scopeSelector: '.does-not-exist' });

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'SELECTION_UNAVAILABLE' }));

    chrome.runtime.sendMessage.mockClear();
    document.querySelector('h3.item-name').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalled();
  });

  test('no scopeSelector behaves like today — any element on the page is pickable', () => {
    capturedListener({ type: 'START_SELECTION' });

    document.getElementById('outside').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'ELEMENT_SELECTED',
      selector: '#outside',
    }));
  });
});
