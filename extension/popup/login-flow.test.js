// Issue #403: the "Login form" starter, plain units and the Advanced
// disclosure of the browser actions — pure logic plus the wired-up popup.
const {
  addLoginFlow, msToSecondsText, secondsTextToMs, LOGIN_FLOW_WAIT_MS,
} = require('./login-flow');
const { serializeBrowserActions } = require('./scraping-config-builder');

describe('addLoginFlow', () => {
  test('appends the four login steps with prefilled variable names and empty selectors', () => {
    const actions = addLoginFlow([]);
    expect(actions.map((a) => [a.kind, a.role])).toEqual([
      ['fill', 'user'], ['fill', 'password'], ['click', 'submit'], ['waitFor', 'loggedIn'],
    ]);
    expect(actions.every((a) => a.selector === '')).toBe(true);
    expect(actions[0].environmentVariableName).toBe('SITE_USERNAME');
    expect(actions[1].environmentVariableName).toBe('SITE_PASSWORD');
    expect(actions[2]).toMatchObject({ target: 'first', waitAfterMs: 250 });
    expect(actions[3].timeoutMs).toBe(LOGIN_FLOW_WAIT_MS);
  });

  test('keeps what is already there and never reuses a variable name', () => {
    const existing = [{ kind: 'scroll', containerSelector: '', loadMoreButtonSelector: '', maxIterations: 10, waitAfterMs: 1000, scrollStepPx: null }];
    const once = addLoginFlow(existing);
    expect(once[0]).toBe(existing[0]);
    expect(once).toHaveLength(5);
    const twice = addLoginFlow(once);
    expect(twice).toHaveLength(9);
    expect(twice.filter((a) => a.kind === 'fill').map((a) => a.environmentVariableName))
      .toEqual(['SITE_USERNAME', 'SITE_PASSWORD', 'SITE_USERNAME_2', 'SITE_PASSWORD_2']);
  });

  test('the UI-only role never reaches the wire', () => {
    const picked = addLoginFlow([]).map((a, i) => ({ ...a, selector: `#el${i}` }));
    const wire = serializeBrowserActions(picked);
    expect(wire).toEqual([
      { kind: 'fill', selector: '#el0', environmentVariableName: 'SITE_USERNAME' },
      { kind: 'fill', selector: '#el1', environmentVariableName: 'SITE_PASSWORD' },
      { kind: 'click', selector: '#el2' },
      { kind: 'waitFor', selector: '#el3', timeoutMs: 10000 },
    ]);
    expect(JSON.stringify(wire)).not.toContain('role');
  });
});

describe('seconds <-> milliseconds', () => {
  test('milliseconds are shown as plain seconds', () => {
    expect(msToSecondsText(5000)).toBe('5');
    expect(msToSecondsText(250)).toBe('0.25');
    expect(msToSecondsText(1500)).toBe('1.5');
    expect(msToSecondsText(null)).toBe('');
    expect(msToSecondsText(undefined)).toBe('');
  });

  test('typed seconds become whole milliseconds; decimal comma works; junk falls back', () => {
    expect(secondsTextToMs('5', 1)).toBe(5000);
    expect(secondsTextToMs('0,25', 1)).toBe(250);
    expect(secondsTextToMs(' 1.5 ', 1)).toBe(1500);
    expect(secondsTextToMs('0.0004', 7)).toBe(7); // rounds to 0 ms, which a timeout can't be
    for (const bad of ['', '  ', 'abc', '-1', '0']) expect(secondsTextToMs(bad, 4242)).toBe(4242);
    expect(secondsTextToMs('0', 4242, { allowZero: true })).toBe(0);
    expect(secondsTextToMs('-2', 4242, { allowZero: true })).toBe(4242);
  });

  test('round trip is lossless for whole milliseconds', () => {
    for (const ms of [1, 250, 999, 1000, 5000, 12345]) expect(secondsTextToMs(msToSecondsText(ms), -1)).toBe(ms);
  });
});

describe('the starter in the real popup', () => {
  let capturedListener;
  const flushMicrotasks = async () => { await new Promise((resolve) => setTimeout(resolve, 0)); };

  beforeEach(async () => {
    jest.resetModules();
    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <div id="url-display"></div>
        <div id="flat-mode-section"><div id="fields-list"></div><button id="btn-add-field"></button></div>
        <div>
          <button id="btn-engine-static" class="mode-btn active"></button>
          <button id="btn-engine-browser" class="mode-btn"></button>
          <div id="browser-actions-section" class="hidden">
            <button id="btn-add-login-flow"></button>
            <p id="login-flow-hint" class="hidden"></p>
            <div id="browser-actions-list"></div>
            <button id="btn-add-action-scroll"></button>
          </div>
        </div>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" /><div id="dom-tree-wrapper" class="hidden"><ul id="dom-tree-root"></ul></div>
        <button id="btn-cancel-selection"></button>
      </section>`;
    global.chrome = {
      runtime: { onMessage: { addListener: (fn) => { capturedListener = fn; } }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: { session: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue(undefined), remove: jest.fn().mockResolvedValue(undefined) } },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flushMicrotasks();
    document.getElementById('btn-engine-browser').click();
  });

  const cards = () => [...document.querySelectorAll('#browser-actions-list .browser-action-card')];
  const persisted = () => chrome.storage.session.set.mock.calls.at(-1)[0].browserActions;

  test('one click adds the four cards, named by their purpose, with the pickers ready', () => {
    expect(document.getElementById('login-flow-hint').classList.contains('hidden')).toBe(true);
    document.getElementById('btn-add-login-flow').click();

    expect(cards()).toHaveLength(4);
    const titles = cards().map((c) => c.querySelector('.row-label').textContent);
    expect(new Set(titles).size).toBe(4); // role wording, not four bare "Fill"/"Click"/"Wait" labels
    expect(cards()[0].querySelector('.browser-action-env-name').value).toBe('SITE_USERNAME');
    expect(cards()[1].querySelector('.browser-action-env-name').value).toBe('SITE_PASSWORD');
    expect(cards()[0].querySelector('.browser-action-test-value')).not.toBeNull(); // the test-value box is there at once
    expect(document.querySelectorAll('.btn-pick-action-selector')).toHaveLength(4);
    expect(document.getElementById('login-flow-hint').classList.contains('hidden')).toBe(false);
  });

  test('the hint goes away once every starter element is picked', async () => {
    document.getElementById('btn-add-login-flow').click();
    for (let i = 0; i < 4; i++) {
      document.querySelectorAll('.btn-pick-action-selector')[i].click();
      capturedListener({ type: 'ELEMENT_SELECTED', selector: `#el${i}` });
      await flushMicrotasks();
    }
    expect(document.getElementById('login-flow-hint').classList.contains('hidden')).toBe(true);
  });

  test('picked and sent: the request carries exactly the plain wire actions', async () => {
    document.getElementById('btn-add-login-flow').click();
    for (let i = 0; i < 4; i++) {
      document.querySelectorAll('.btn-pick-action-selector')[i].click();
      capturedListener({ type: 'ELEMENT_SELECTED', selector: `#el${i}` });
      await flushMicrotasks();
    }
    document.getElementById('btn-generate').disabled = false;
    document.getElementById('btn-generate').click();
    await flushMicrotasks();
    const [, options] = global.fetch.mock.calls.find(([url]) => String(url).endsWith('/generate'));
    expect(JSON.parse(options.body).browserActions).toEqual([
      { kind: 'fill', selector: '#el0', environmentVariableName: 'SITE_USERNAME' },
      { kind: 'fill', selector: '#el1', environmentVariableName: 'SITE_PASSWORD' },
      { kind: 'click', selector: '#el2' },
      { kind: 'waitFor', selector: '#el3', timeoutMs: 10000 },
    ]);
  });

  test('times are typed in seconds and stored in milliseconds', () => {
    document.getElementById('btn-add-login-flow').click();
    const timeout = document.querySelector('.browser-action-timeout');
    expect(timeout.value).toBe('10');
    timeout.value = '2.5';
    timeout.dispatchEvent(new Event('change', { bubbles: true }));
    expect(persisted().find((a) => a.kind === 'waitFor').timeoutMs).toBe(2500);
    expect(document.querySelector('.browser-action-timeout').value).toBe('2.5');
    // junk falls back to the default instead of storing nonsense
    document.querySelector('.browser-action-timeout').value = '';
    document.querySelector('.browser-action-timeout').dispatchEvent(new Event('change', { bubbles: true }));
    expect(persisted().find((a) => a.kind === 'waitFor').timeoutMs).toBe(5000);
  });

  test('rare options sit in a collapsed "Advanced" disclosure; the common ones do not', () => {
    document.getElementById('btn-add-login-flow').click();
    const click = cards()[2];
    const clickAdvanced = click.querySelector('details.advanced-disclosure');
    expect(clickAdvanced.open).toBe(false);
    expect(clickAdvanced.contains(click.querySelector('.browser-action-click-target'))).toBe(true);

    document.getElementById('btn-add-action-scroll').click();
    const scroll = cards()[4];
    const scrollAdvanced = scroll.querySelector('details.advanced-disclosure');
    expect(scrollAdvanced.contains(scroll.querySelector('.browser-action-scroll-step-px'))).toBe(true);
    expect(scrollAdvanced.querySelectorAll('.btn-pick-action-selector')).toHaveLength(2); // container + "load more"
    // rounds and the pause stay visible
    expect(scrollAdvanced.contains(scroll.querySelector('.browser-action-max-iterations'))).toBe(false);
    expect(scrollAdvanced.contains(scroll.querySelector('.browser-action-wait-after-ms'))).toBe(false);
  });
});
