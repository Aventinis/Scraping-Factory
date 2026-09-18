// Fixes the popup's language-detection default to German — every assertion
// below (written against the original hardcoded German copy) depends on it,
// via the "Engine + browser actions integration" describe's own
// require('./popup') (which calls initI18n() as part of init()). Same setup
// as popup.test.js's own top-level line.
Object.defineProperty(window.navigator, 'language', { value: 'de-DE', configurable: true });

const { renderBrowserActions } = require('./browser-actions-ui');
const { serializeBrowserActions } = require('./scraping-config-builder');

describe('renderBrowserActions — Fill test-value row', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="browser-actions-list"></div>';
  });

  test('renders a test-value input for a fill action with a non-blank env-var name', () => {
    renderBrowserActions([{ kind: 'fill', selector: '#user', environmentVariableName: 'SF_USER' }], { SF_USER: 'alice' });

    const input = document.querySelector('.browser-action-test-value');
    expect(input).not.toBeNull();
    expect(input.dataset.envName).toBe('SF_USER');
    expect(input.value).toBe('alice');
    expect(input.type).toBe('password');
  });

  test('does not render a test-value input for a fill action with a blank env-var name', () => {
    renderBrowserActions([{ kind: 'fill', selector: '#user', environmentVariableName: '' }], {});
    expect(document.querySelector('.browser-action-test-value')).toBeNull();
  });

  test('does not render a test-value input for non-fill actions', () => {
    renderBrowserActions([{ kind: 'click', selector: '#submit' }], {});
    expect(document.querySelector('.browser-action-test-value')).toBeNull();
  });
});

describe('Engine + browser actions integration', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(async () => {
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
        </div>
        <div>
          <button id="btn-engine-static" class="mode-btn active"></button>
          <button id="btn-engine-browser" class="mode-btn"></button>
          <div id="browser-actions-section" class="hidden">
            <div id="browser-actions-list"></div>
            <button id="btn-add-action-wait"></button>
            <button id="btn-add-action-fill"></button>
            <button id="btn-add-action-click"></button>
            <button id="btn-add-action-scroll"></button>
          </div>
        </div>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
        <button id="btn-cancel-selection"></button>
      </section>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  test('Browser engine reveals the browser-actions section; Static hides it again', () => {
    expect(document.getElementById('browser-actions-section').classList.contains('hidden')).toBe(true);

    document.getElementById('btn-engine-browser').click();
    expect(document.getElementById('browser-actions-section').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('btn-engine-browser').classList.contains('active')).toBe(true);
    expect(document.getElementById('btn-engine-static').classList.contains('active')).toBe(false);

    document.getElementById('btn-engine-static').click();
    expect(document.getElementById('browser-actions-section').classList.contains('hidden')).toBe(true);
  });

  test('adding each action kind renders the right card, in order', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-wait').click();
    document.getElementById('btn-add-action-fill').click();
    document.getElementById('btn-add-action-click').click();
    document.getElementById('btn-add-action-scroll').click();

    const cards = document.querySelectorAll('.browser-action-card');
    expect(cards).toHaveLength(4);
    expect(cards[0].querySelector('.browser-action-timeout')).not.toBeNull();
    expect(cards[1].querySelector('.browser-action-env-name')).not.toBeNull();
    expect(cards[2].querySelector('.browser-action-timeout')).toBeNull();
    expect(cards[2].querySelector('.browser-action-env-name')).toBeNull();
    expect(cards[3].querySelectorAll('.btn-pick-action-selector')).toHaveLength(2);
    expect(cards[3].querySelector('.browser-action-max-iterations')).not.toBeNull();
    expect(cards[3].querySelector('.browser-action-wait-after-ms')).not.toBeNull();
  });

  test('a scroll card\'s two pick buttons target containerSelector/loadMoreButtonSelector independently', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-scroll').click();

    // Re-query after every pick — each ELEMENT_SELECTED round re-renders
    // #browser-actions-list from scratch, so a NodeList captured before a
    // prior round is a snapshot of now-detached nodes (the exact "stale
    // element handle" pitfall documented in the Phase 5 manual verification
    // notes, here as a real jsdom analogue).
    let pickButtons = document.querySelectorAll('.btn-pick-action-selector');
    expect(pickButtons[0].dataset.field).toBe('containerSelector');
    expect(pickButtons[1].dataset.field).toBe('loadMoreButtonSelector');

    pickButtons[1].click(); // pick the load-more button first, on purpose
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#load-more' });
    await flushMicrotasks();

    pickButtons = document.querySelectorAll('.btn-pick-action-selector');
    pickButtons[0].click(); // then the container — must not overwrite the first pick
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#list' });
    await flushMicrotasks();

    const selectorTexts = [...document.querySelectorAll('.browser-action-selector-row .field-selector')].map(el => el.textContent);
    expect(selectorTexts).toEqual(['#list', '#load-more']);
  });

  test('editing a scroll action\'s maxIterations/waitAfterMs persists them into state', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-scroll').click();

    const maxIterationsInput = document.querySelector('.browser-action-max-iterations');
    maxIterationsInput.value = '20';
    maxIterationsInput.dispatchEvent(new Event('change', { bubbles: true }));

    const waitAfterMsInput = document.querySelector('.browser-action-wait-after-ms');
    waitAfterMsInput.value = '2500';
    waitAfterMsInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.browser-action-max-iterations').value).toBe('20');
    expect(document.querySelector('.browser-action-wait-after-ms').value).toBe('2500');
  });

  test('removing an action drops only that card', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-wait').click();
    document.getElementById('btn-add-action-click').click();

    document.querySelectorAll('.btn-remove-action')[0].click();

    const cards = document.querySelectorAll('.browser-action-card');
    expect(cards).toHaveLength(1);
    expect(cards[0].querySelector('.browser-action-timeout')).toBeNull(); // the click action remains
  });

  test('editing a Fill action\'s environment variable name persists it into state', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-fill').click();

    const envInput = document.querySelector('.browser-action-env-name');
    envInput.value = 'SF_USERNAME';
    envInput.dispatchEvent(new Event('change', { bubbles: true }));

    // Re-render (triggered by the change handler's setState) must not lose it.
    expect(document.querySelector('.browser-action-env-name').value).toBe('SF_USERNAME');
  });

  // Issue #43
  test('setting a Fill action\'s env-var name reveals its test-value input', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-fill').click();

    expect(document.querySelector('.browser-action-test-value')).toBeNull();

    const envInput = document.querySelector('.browser-action-env-name');
    envInput.value = 'SF_USERNAME';
    envInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.browser-action-test-value')).not.toBeNull();
  });

  // Issue #43: fillTestValues must never survive a popup close/reopen — the
  // change handler uses patchState (which never calls persistState), unlike
  // every other browser-action field here, which uses setState.
  test('typing a Fill test value updates the input but is never written to session storage', () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-fill').click();
    const envInput = document.querySelector('.browser-action-env-name');
    envInput.value = 'SF_USERNAME';
    envInput.dispatchEvent(new Event('change', { bubbles: true }));

    chrome.storage.session.set.mockClear();
    const testValueInput = document.querySelector('.browser-action-test-value');
    testValueInput.value = 'alice';
    testValueInput.dispatchEvent(new Event('change', { bubbles: true }));

    expect(document.querySelector('.browser-action-test-value').value).toBe('alice');
    expect(chrome.storage.session.set).not.toHaveBeenCalled();
  });

  test('picking an element for an action selector: START_SELECTION, then the result is written straight into that action — no modal', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-click').click();

    document.querySelector('.btn-pick-action-selector').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION' });
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);

    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#submit' });
    await flushMicrotasks();

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    const selectorText = document.querySelector('.browser-action-selector-row .field-selector');
    expect(selectorText.textContent).toBe('#submit');
  });

  // Issue #42, Phase 7: a click landing inside an iframe reports a framePath
  // alongside the selector — it's written straight into the action (like the
  // selector itself) and surfaced as a badge on the action card.
  test('a framed action selector shows the iframe badge and carries framePath onto the action', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-click').click();

    document.querySelector('.btn-pick-action-selector').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#submit', framePath: ['#login-widget'] });
    await flushMicrotasks();

    const badge = document.querySelector('.browser-action-card .frame-badge');
    expect(badge).not.toBeNull();
    expect(badge.title).toContain('#login-widget');

    expect(serializeBrowserActions([{ kind: 'click', selector: '#submit', framePath: ['#login-widget'] }]))
      .toEqual([{ kind: 'click', selector: '#submit', framePath: ['#login-widget'] }]);
  });

  test('a top-level (unframed) action selector shows no iframe badge', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-click').click();

    document.querySelector('.btn-pick-action-selector').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#submit' });
    await flushMicrotasks();

    expect(document.querySelector('.browser-action-card .frame-badge')).toBeNull();
  });

  test('a full login flow (fill, fill, click, wait) is sent to /generate with engine and browserActions', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-fill').click();
    document.getElementById('btn-add-action-fill').click();
    document.getElementById('btn-add-action-click').click();
    document.getElementById('btn-add-action-wait').click();

    const pickButtons = () => document.querySelectorAll('.btn-pick-action-selector');
    const envInputs = () => document.querySelectorAll('.browser-action-env-name');

    pickButtons()[0].click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#username' });
    await flushMicrotasks();
    envInputs()[0].value = 'SF_USERNAME';
    envInputs()[0].dispatchEvent(new Event('change', { bubbles: true }));

    pickButtons()[1].click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#password' });
    await flushMicrotasks();
    envInputs()[1].value = 'SF_PASSWORD';
    envInputs()[1].dispatchEvent(new Event('change', { bubbles: true }));

    pickButtons()[2].click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#submit' });
    await flushMicrotasks();

    pickButtons()[3].click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.welcome' });
    await flushMicrotasks();

    // hasConfig (gating btn-generate) only looks at fields/groups/apiConfig,
    // none of which this test cares about — only the request body's
    // engine/browserActions shape — so the disabled gate is bypassed
    // directly rather than adding an unrelated flat field just to satisfy it.
    document.getElementById('btn-generate').disabled = false;
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const [, options] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    const body = JSON.parse(options.body);
    expect(body.engine).toBe('Browser');
    expect(body.browserActions).toEqual([
      { kind: 'fill', selector: '#username', environmentVariableName: 'SF_USERNAME' },
      { kind: 'fill', selector: '#password', environmentVariableName: 'SF_PASSWORD' },
      { kind: 'click', selector: '#submit' },
      { kind: 'waitFor', selector: '.welcome', timeoutMs: 5000 },
    ]);
    // Issue #43: no test values were typed in this test, so nothing is sent —
    // matches the gap the feature closes without ever forcing an empty key.
    expect(body.verificationValues).toBeUndefined();
  });

  // Issue #43
  test('typed Fill test values are sent to /generate as verificationValues, keyed by env-var name', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-fill').click();
    document.getElementById('btn-add-action-fill').click();

    const envInputs = () => document.querySelectorAll('.browser-action-env-name');
    envInputs()[0].value = 'SF_USERNAME';
    envInputs()[0].dispatchEvent(new Event('change', { bubbles: true }));
    envInputs()[1].value = 'SF_PASSWORD';
    envInputs()[1].dispatchEvent(new Event('change', { bubbles: true }));

    const testValueInputs = () => document.querySelectorAll('.browser-action-test-value');
    testValueInputs()[0].value = 'alice';
    testValueInputs()[0].dispatchEvent(new Event('change', { bubbles: true }));
    testValueInputs()[1].value = 's3cret';
    testValueInputs()[1].dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-generate').disabled = false;
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const [, options] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    const body = JSON.parse(options.body);
    expect(body.verificationValues).toEqual({ SF_USERNAME: 'alice', SF_PASSWORD: 's3cret' });
    // The logged request body must stay clean — never carries the test values.
    expect(body.engine).toBe('Browser');
  });

  test('a scroll action with only the load-more button picked is sent with containerSelector: null', async () => {
    document.getElementById('btn-engine-browser').click();
    document.getElementById('btn-add-action-scroll').click();

    const pickButtons = document.querySelectorAll('.btn-pick-action-selector');
    pickButtons[1].click(); // loadMoreButtonSelector only — containerSelector stays unset
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '#load-more' });
    await flushMicrotasks();

    const maxIterationsInput = document.querySelector('.browser-action-max-iterations');
    maxIterationsInput.value = '6';
    maxIterationsInput.dispatchEvent(new Event('change', { bubbles: true }));

    document.getElementById('btn-generate').disabled = false;
    document.getElementById('btn-generate').click();
    await flushMicrotasks();

    const [, options] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    const body = JSON.parse(options.body);
    expect(body.browserActions).toEqual([
      { kind: 'scroll', containerSelector: null, loadMoreButtonSelector: '#load-more', maxIterations: 6, waitAfterMs: 1000 },
    ]);
  });
});
