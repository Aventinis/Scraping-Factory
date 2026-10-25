Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, 'screens', name), 'utf8');
const $ = (id) => document.getElementById(id);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// Issue #508: "Record my steps" in the real popup with the real idle markup.
describe('Record my steps', () => {
  let onMessage;

  async function loadPopupWith(stored) {
    jest.resetModules();
    document.body.innerHTML = `<section id="screen-idle" class="hidden">${read('idle.html')}</section>${read('modals.html')}`;
    global.chrome = {
      runtime: { onMessage: { addListener: (fn) => { onMessage = fn; } }, sendMessage: jest.fn() },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        local: { get: jest.fn().mockResolvedValue({ language: 'en' }), set: jest.fn() },
        session: {
          get: jest.fn().mockResolvedValue({ url: 'https://example.com', mode: 'flat', engine: 'Browser', ...stored }),
          set: jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    require('./popup');
    await flush();
    await flush();
  }

  const step = {
    click: (selector, extra = {}) => ({ type: 'STEP_RECORDED', step: { kind: 'click', selector, framePath: null, late: false, ...extra } }),
    fill: (selector, extra = {}) => ({ type: 'STEP_RECORDED', step: { kind: 'fill', selector, framePath: null, late: false, inputType: 'text', ...extra } }),
  };
  const sentTypes = () => chrome.runtime.sendMessage.mock.calls.map(c => c[0].type);
  const persistedActions = () => chrome.storage.session.set.mock.calls.map(c => c[0].browserActions).filter(Boolean).pop();

  describe('with an empty action list', () => {
    beforeEach(async () => { await loadPopupWith({ browserActions: [] }); });

    test('the button asks the service worker to start, and the panel shows the steps as they come in', () => {
      $('btn-record-steps').click();
      expect(sentTypes()).toContain('STEP_RECORDING_START');
      expect($('btn-record-steps').textContent).toBe('Stop recording');

      onMessage(step.fill('#username'), {});
      onMessage(step.click('#login-submit'), {});
      const items = [...document.querySelectorAll('#record-steps-list li')].map(li => li.textContent);
      expect(items).toEqual(['Type into: #username', 'Click: #login-submit']);
    });

    test('Stop turns the steps into actions in the editor; the fill waits for its environment variable name', () => {
      $('btn-record-steps').click();
      onMessage(step.fill('#username'), {});
      onMessage(step.fill('#password', { inputType: 'password' }), {});
      onMessage(step.click('#login-submit'), {});
      $('btn-record-steps').click();

      expect(sentTypes()).toContain('STEP_RECORDING_STOP');
      expect(persistedActions().map(a => a.kind)).toEqual(['fill', 'fill', 'click']);
      expect(document.querySelectorAll('.browser-action-card')).toHaveLength(3);
      expect(document.querySelectorAll('.browser-action-env-name')).toHaveLength(2);
      expect([...document.querySelectorAll('.browser-action-env-name')].every(i => i.value === '')).toBe(true);
      expect($('record-steps-choice').classList.contains('hidden')).toBe(true);
      expect($('btn-record-steps').textContent).toBe('Record my steps');
    });

    test('stopping with nothing recorded says so and changes nothing', () => {
      $('btn-record-steps').click();
      $('btn-record-steps').click();
      expect($('record-steps-note').classList.contains('hidden')).toBe(false);
      expect(document.querySelectorAll('.browser-action-card')).toHaveLength(0);
    });

    test('steps that arrive when no recording is running are ignored', () => {
      onMessage(step.click('.x'), {});
      expect(document.querySelectorAll('#record-steps-list li')).toHaveLength(0);
    });

    test('the service worker ending the recording (tab closed, page without a content script) keeps what was recorded and says why', () => {
      $('btn-record-steps').click();
      onMessage(step.click('.menu'), {});
      onMessage({ type: 'STEP_RECORDING_ENDED', reason: 'The tab was closed.' }, {});

      expect(persistedActions().map(a => a.selector)).toEqual(['.menu']);
      expect($('record-steps-note').textContent).toBe('The tab was closed.');
      expect($('btn-record-steps').textContent).toBe('Record my steps');
    });

    test('a typed value appears nowhere: not in storage, not in the export of the configuration', () => {
      const secret = 'hunter2-s3cret';
      $('btn-record-steps').click();
      // the recorder's messages carry no value; even a hostile extra property would not be kept by the conversion
      onMessage(step.fill('#password', { inputType: 'password', value: secret }), {});
      onMessage(step.click('#login-submit'), {});
      $('btn-record-steps').click();

      const stored = JSON.stringify(chrome.storage.session.set.mock.calls);
      expect(stored).not.toContain(secret);
      const { buildScrapingConfig } = require('./scraping-config-builder');
      const config = buildScrapingConfig({ url: 'https://example.com', fields: [{ name: 'x', selector: '.x' }], engine: 'Browser', browserActions: persistedActions() });
      expect(JSON.stringify(config)).not.toContain(secret);
    });
  });

  describe('with actions already in the list', () => {
    const existing = [{ kind: 'click', selector: '.cookie-ok', target: 'first', waitAfterMs: 250 }];
    beforeEach(async () => {
      await loadPopupWith({ browserActions: existing });
      $('btn-record-steps').click();
      onMessage(step.click('#login-submit'), {});
      $('btn-record-steps').click();
    });

    test('Stop asks once; nothing changes before the answer', () => {
      expect($('record-steps-choice').classList.contains('hidden')).toBe(false);
      expect(document.querySelectorAll('.browser-action-card')).toHaveLength(1);
    });

    test('Add to the list appends', () => {
      $('btn-record-steps-append').click();
      expect(persistedActions().map(a => a.selector)).toEqual(['.cookie-ok', '#login-submit']);
      expect($('record-steps-choice').classList.contains('hidden')).toBe(true);
    });

    test('Replace the list replaces', () => {
      $('btn-record-steps-replace').click();
      expect(persistedActions().map(a => a.selector)).toEqual(['#login-submit']);
    });

    test('Discard keeps the list as it was', () => {
      $('btn-record-steps-discard').click();
      expect(document.querySelectorAll('.browser-action-card')).toHaveLength(1);
      expect($('record-steps-choice').classList.contains('hidden')).toBe(true);
    });
  });
});
