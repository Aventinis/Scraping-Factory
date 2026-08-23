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
