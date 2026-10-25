// Issue #396: the "Advanced" disclosure — pure logic/storage
// (advanced-disclosure.ts) and its DOM wiring (advanced-disclosure-ui.ts).
const { STORAGE_KEY, isSectionOpen, withSectionOpen, loadAdvancedSections, persistAdvancedSections } = require('./advanced-disclosure');
const { createAdvancedDisclosure, initAdvancedDisclosures, wireAdvancedDisclosureEvents } = require('./advanced-disclosure-ui');

afterEach(() => { delete global.chrome; });

describe('advanced-disclosure.ts', () => {
  test('a section is open only when it was stored as opened', () => {
    expect(isSectionOpen({ a: true }, 'a')).toBe(true);
    expect(isSectionOpen({ a: true }, 'b')).toBe(false);
    expect(isSectionOpen(null, 'a')).toBe(false);
    expect(isSectionOpen({ a: 'yes' }, 'a')).toBe(false);
  });

  test('withSectionOpen adds/removes per section and never mutates', () => {
    const before = { a: true };
    expect(withSectionOpen(before, 'b', true)).toEqual({ a: true, b: true });
    expect(withSectionOpen(before, 'a', false)).toEqual({});
    expect(before).toEqual({ a: true });
    expect(withSectionOpen(undefined, 'a', true)).toEqual({ a: true });
  });

  test('loads what was stored, and {} for anything unusable', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({ [STORAGE_KEY]: { a: true } }) } } };
    expect(await loadAdvancedSections()).toEqual({ a: true });
    global.chrome.storage.local.get.mockResolvedValue({ [STORAGE_KEY]: ['x'] });
    expect(await loadAdvancedSections()).toEqual({});
    global.chrome.storage.local.get.mockRejectedValue(new Error('blocked'));
    expect(await loadAdvancedSections()).toEqual({});
  });

  test('without chrome.storage everything degrades to "collapsed"', async () => {
    expect(await loadAdvancedSections()).toEqual({});
    await expect(persistAdvancedSections({ a: true })).resolves.toBeUndefined();
  });

  test('persists under the shared key; a failed write is swallowed', async () => {
    global.chrome = { storage: { local: { set: jest.fn().mockResolvedValue(undefined) } } };
    await persistAdvancedSections({ a: true });
    expect(global.chrome.storage.local.set).toHaveBeenCalledWith({ [STORAGE_KEY]: { a: true } });
    global.chrome.storage.local.set.mockRejectedValue(new Error('quota'));
    await expect(persistAdvancedSections({})).resolves.toBeUndefined();
  });
});

describe('advanced-disclosure-ui.ts', () => {
  const mount = () => {
    document.body.innerHTML = `
      <details class="advanced-disclosure" data-advanced="one"><summary>Advanced</summary>x</details>
      <details class="advanced-disclosure" data-advanced="two"><summary>Advanced</summary>y</details>
      <details id="unrelated"><summary>s</summary>z</details>`;
  };
  const toggle = (details, open) => {
    details.open = open;
    details.dispatchEvent(new Event('toggle')); // jsdom does not fire it for us
  };

  test('createAdvancedDisclosure builds a collapsed <details> with a body', () => {
    const details = createAdvancedDisclosure('rare-options');
    expect(details.tagName).toBe('DETAILS');
    expect(details.open).toBe(false);
    expect(details.dataset.advanced).toBe('rare-options');
    expect(details.querySelector('summary').dataset.i18n).toBe('common.advanced');
    expect(details.querySelector('.advanced-disclosure-body')).not.toBeNull();
  });

  test('sections start collapsed, except those remembered as open', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({ [STORAGE_KEY]: { two: true } }), set: jest.fn().mockResolvedValue() } } };
    mount();
    await initAdvancedDisclosures();
    expect(document.querySelector('[data-advanced="one"]').open).toBe(false);
    expect(document.querySelector('[data-advanced="two"]').open).toBe(true);
    expect(document.getElementById('unrelated').open).toBe(false);
  });

  test('opening and closing a section is remembered per section — and only a real change is written', async () => {
    const set = jest.fn().mockResolvedValue();
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set } } };
    mount();
    await initAdvancedDisclosures();
    wireAdvancedDisclosureEvents();

    const one = document.querySelector('[data-advanced="one"]');
    toggle(one, true);
    expect(set).toHaveBeenLastCalledWith({ [STORAGE_KEY]: { one: true } });

    toggle(document.querySelector('[data-advanced="two"]'), true);
    expect(set).toHaveBeenLastCalledWith({ [STORAGE_KEY]: { one: true, two: true } });

    toggle(one, false);
    expect(set).toHaveBeenLastCalledWith({ [STORAGE_KEY]: { two: true } });

    set.mockClear();
    one.dispatchEvent(new Event('toggle')); // no change in state
    toggle(document.getElementById('unrelated'), true); // not a remembered section
    expect(set).not.toHaveBeenCalled();
  });
});
