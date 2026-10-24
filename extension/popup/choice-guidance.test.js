// Issue #398: guidance for the first decisions of a scrape — the pure logic
// (choice-guidance.ts), the match-count toast that now checks the count against
// the chosen container type, and the container type toggle in the tree rows.
// German is the language every popup test assumes (see test-support/popup-env.js).
Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

const { containerCountAdvice } = require('./choice-guidance');

describe('containerCountAdvice', () => {
  test.each([
    [null, true, 'unknown'],
    [undefined, false, 'unknown'],
    [0, false, 'zero'],
    [0, true, 'zero'],
    [12, false, 'singleMany'],
    [2, false, 'singleMany'],
    [1, false, 'ok'],
    [1, true, 'repeatingOne'],
    [12, true, 'ok'],
    [12, undefined, 'ok'],   // type unknown → plain count
    [1, undefined, 'ok'],
  ])('%p matches, repeating=%p → %s', (count, repeating, expected) => {
    expect(containerCountAdvice(count, repeating)).toBe(expected);
  });
});

describe('showMatchCountToast checks the count against the container type', () => {
  let showMatchCountToast;
  const toast = () => document.getElementById('error-toast');
  const message = () => document.getElementById('error-toast-message').textContent;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <div id="error-toast" class="hidden"><span id="error-toast-message"></span><button id="btn-report-bug-toast" class="hidden"></button></div>`;
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn() } } };
    await require('../i18n/i18n').setLanguage('en');
    ({ showMatchCountToast } = require('./toast'));
  });
  afterEach(() => { delete global.chrome; });

  test('several matches for a "single" container: a warning that only the first is used, naming the way out', () => {
    showMatchCountToast('Dish', 12, false);
    expect(toast().classList.contains('toast-warn')).toBe(true);
    expect(message()).toContain('12 elements found');
    expect(message()).toContain('only the first is used');
    expect(message()).toContain('"(single)"');
  });

  test('one match for a "repeating" container: an info hint, not a warning', () => {
    showMatchCountToast('Header', 1, true);
    expect(toast().classList.contains('toast-info')).toBe(true);
    expect(toast().classList.contains('toast-warn')).toBe(false);
    expect(message()).toContain('only 1 element found');
    expect(message()).toContain('"(repeating)"');
  });

  test('a fitting count, zero matches and an unknown type keep the plain count message', () => {
    showMatchCountToast('Dish', 12, true);
    expect(message()).toBe('Container "Dish" added — 12 element(s) found');
    expect(toast().classList.contains('toast-info')).toBe(true);

    showMatchCountToast('Dish', 0, false);
    expect(message()).toBe('Container "Dish" added — 0 element(s) found');
    expect(toast().classList.contains('toast-warn')).toBe(true);

    showMatchCountToast('Dish', 12);
    expect(message()).toBe('Container "Dish" added — 12 element(s) found');
  });

  test('no count at all: no toast', () => {
    showMatchCountToast('Dish', null, false);
    expect(toast().classList.contains('hidden')).toBe(true);
  });
});

describe('the container type toggle in the tree rows', () => {
  let state;
  let bridge;

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = '<ul id="group-tree-root"></ul>';
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn() } } };
    await require('../i18n/i18n').setLanguage('en');
    const { renderGroupTree, wireContainerModeEvents } = require('./container-tree-ui');
    state = {
      current: 'IDLE',
      groups: [
        { kind: 'group', name: 'Menu', selector: '.menu', repeating: false, framePath: null, children: [
          { kind: 'group', name: 'Dish', selector: 'li', repeating: true, framePath: null, children: [] },
          { kind: 'field', name: 'Price', selector: '.price', mode: 'text', attribute: null, framePath: null },
        ] },
      ],
    };
    bridge = {
      getState: () => state,
      setState: jest.fn((current, patch) => { state = { ...state, current, ...patch }; renderGroupTree(state.groups); }),
      patchState: jest.fn(),
      stopPreviewIfActive: jest.fn(),
      requestDomTree: jest.fn(),
    };
    renderGroupTree(state.groups);
    wireContainerModeEvents(bridge);
  });
  afterEach(() => { delete global.chrome; });

  const typeButtons = () => Array.from(document.querySelectorAll('.group-tree-type'));

  test('only groups get a toggle (fields keep their plain label), showing the current type', () => {
    expect(typeButtons().map((b) => b.textContent)).toEqual(['(single)', '(repeating)']);
    expect(typeButtons()[0].tagName).toBe('BUTTON');
    expect(document.querySelectorAll('span.group-tree-label')).toHaveLength(1); // the field's "— Text"
    expect(typeButtons()[0].title).toContain('make this container repeating');
    expect(typeButtons()[1].title).toContain('make this container single');
  });

  test('clicking the suffix flips just that container, at any depth', () => {
    typeButtons()[0].click();
    expect(state.groups[0].repeating).toBe(true);
    expect(state.groups[0].children[0].repeating).toBe(true); // untouched
    expect(typeButtons().map((b) => b.textContent)).toEqual(['(repeating)', '(repeating)']);

    typeButtons()[1].click();
    expect(state.groups[0].children[0].repeating).toBe(false);
    expect(state.groups[0].repeating).toBe(true);
    expect(typeButtons().map((b) => b.textContent)).toEqual(['(repeating)', '(single)']);
    expect(bridge.stopPreviewIfActive).toHaveBeenCalled();
  });

  test('toggling keeps everything else about the node (name, selector, children)', () => {
    typeButtons()[0].click();
    expect(state.groups[0]).toMatchObject({ name: 'Menu', selector: '.menu', kind: 'group' });
    expect(state.groups[0].children).toHaveLength(2);
  });
});
