// Issue #267: Click browser action — choose first/last/all matches. Draft →
// wire (serializeBrowserActions), wire → draft (deserializeBrowserActions via
// applyConfigToState) and the card in the real popup.
const { serializeBrowserActions, addBrowserAction } = require('./scraping-config-builder');
const { applyConfigToState } = require('./config-import');

const click = (patch) => ({ ...addBrowserAction([], 'click')[0], selector: '.t', ...patch });

describe('serializeBrowserActions (click)', () => {
  test('first (the default) sends neither target nor wait', () => {
    expect(serializeBrowserActions([click({})])).toEqual([{ kind: 'click', selector: '.t' }]);
  });

  test('last sends only the target', () => {
    expect(serializeBrowserActions([click({ target: 'last' })])).toEqual([{ kind: 'click', selector: '.t', target: 'Last' }]);
  });

  test('all sends the target and the wait between clicks', () => {
    expect(serializeBrowserActions([click({ target: 'all', waitAfterMs: 600 })])).toEqual([{ kind: 'click', selector: '.t', target: 'All', waitAfterMs: 600 }]);
  });

  test('a wait left over from "all" is dropped again when switching back to first', () => {
    expect(serializeBrowserActions([click({ target: 'first', waitAfterMs: 600 })])).toEqual([{ kind: 'click', selector: '.t' }]);
  });
});

describe('loading a config restores the click target', () => {
  const base = { url: 'https://example.com', engine: 'Browser', fields: [{ name: 'Titel', selector: 'h1' }], outputFormat: 'Csv' };
  const actionsFor = (wire) => applyConfigToState({ ...base, browserActions: [wire] }).browserActions[0];

  test.each([
    [{ kind: 'click', selector: '.t' }, 'first', 250],
    [{ kind: 'click', selector: '.t', target: 'Last' }, 'last', 250],
    [{ kind: 'click', selector: '.t', target: 'All', waitAfterMs: 100 }, 'all', 100],
  ])('%j', (wire, target, waitAfterMs) => {
    expect(actionsFor(wire)).toMatchObject({ target, waitAfterMs });
  });
});

describe('the click card in the real popup', () => {
  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <button id="btn-engine-static"></button><button id="btn-engine-browser"></button>
        <div id="browser-actions-section" class="hidden">
          <div id="browser-actions-list"></div>
          <button id="btn-add-action-wait"></button><button id="btn-add-action-fill"></button>
          <button id="btn-add-action-click"></button><button id="btn-add-action-scroll"></button>
        </div>
        <button id="btn-generate" disabled></button>
      </section>
    `;
    global.chrome = {
      runtime: { onMessage: { addListener: () => {} }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: { get: jest.fn().mockResolvedValue({ engine: 'Browser' }), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();
    document.getElementById('btn-add-action-click').click();
  });

  const choose = (value) => {
    const select = document.querySelector('.browser-action-click-target');
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  };

  test('defaults to the first match, without a wait input', () => {
    expect(document.querySelector('.browser-action-click-target').value).toBe('first');
    expect(document.querySelector('.browser-action-click-wait-after-ms')).toBeNull();
  });

  test('"all" reveals the wait input; the choice is persisted', () => {
    choose('all');
    // Issue #403: shown in seconds, stored in milliseconds.
    expect(document.querySelector('.browser-action-click-wait-after-ms').value).toBe('0.25');
    expect(chrome.storage.session.set.mock.calls.at(-1)[0].browserActions[0]).toMatchObject({ kind: 'click', target: 'all' });

    const wait = document.querySelector('.browser-action-click-wait-after-ms');
    wait.value = '0.7';
    wait.dispatchEvent(new Event('change', { bubbles: true }));
    expect(chrome.storage.session.set.mock.calls.at(-1)[0].browserActions[0].waitAfterMs).toBe(700);
  });

  test('switching back to "first" hides the wait input again', () => {
    choose('all');
    choose('first');
    expect(document.querySelector('.browser-action-click-wait-after-ms')).toBeNull();
  });
});
