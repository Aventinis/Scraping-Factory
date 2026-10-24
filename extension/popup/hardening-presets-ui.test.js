// Issue #399: the "Recommended checks" button, the plain-language wording and the
// sentence-style thresholds of the Monitoring section (settings-panel-ui.ts +
// the real idle.html markup).
Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

const fs = require('fs');
const path = require('path');

const idleHtml = fs.readFileSync(path.join(__dirname, 'screens/idle.html'), 'utf8');

let state;
let bridge;
let ui;

const initialHardening = () => ({
  noResult: { enabled: false, severity: 'Warning' },
  nullRate: [],
  baseline: { enabled: false, severity: 'Warning', dropThresholdPercent: 20 },
  blocking: { enabled: false, severity: 'Warning', minBodyLengthText: '', phrasesText: '' },
  requiredFields: { enabled: false, severity: 'Warning', fields: [] },
});

async function mount(fields) {
  jest.resetModules();
  document.body.innerHTML = idleHtml;
  global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn() } } };
  const { setLanguage, t } = require('../i18n/i18n');
  await setLanguage('en');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
  ui = require('./settings-panel-ui');
  state = { current: 'IDLE', mode: 'flat', fields, groups: [], apiConfig: null, hardening: initialHardening() };
  bridge = {
    getState: () => state,
    setState: jest.fn((current, patch) => { state = { ...state, current, ...patch }; }),
    patchState: jest.fn((patch) => { state = { ...state, ...patch }; }),
  };
  ui.wireSettingsPanelEvents(bridge);
}

afterEach(() => { delete global.chrome; document.body.innerHTML = ''; });

const $ = (id) => document.getElementById(id);

describe('"Recommended checks"', () => {
  test('switches on "empty result" and the first field as required, both as warnings, and says so', async () => {
    await mount([{ name: 'Gericht' }, { name: 'Preis' }]);
    $('btn-hardening-recommended').click();
    expect(state.hardening.noResult).toEqual({ enabled: true, severity: 'Warning' });
    expect(state.hardening.requiredFields).toEqual({ enabled: true, severity: 'Warning', fields: ['Gericht'] });
    expect($('hardening-recommended-note').classList.contains('hidden')).toBe(false);
    expect($('hardening-recommended-note').textContent).toBe('Switched on: empty result (warn me), required field “Gericht” (warn me).');
  });

  test('without fields: only "empty result", and the note names what is missing', async () => {
    await mount([]);
    $('btn-hardening-recommended').click();
    expect(state.hardening.noResult.enabled).toBe(true);
    expect(state.hardening.requiredFields.enabled).toBe(false);
    expect($('hardening-recommended-note').textContent).toContain('Switched on: empty result (warn me).');
    expect($('hardening-recommended-note').textContent).toContain('Add fields first');
  });

  test('a second click changes nothing and says the checks are already on', async () => {
    await mount([{ name: 'Gericht' }]);
    $('btn-hardening-recommended').click();
    const after = JSON.stringify(state.hardening);
    $('btn-hardening-recommended').click();
    expect(JSON.stringify(state.hardening)).toBe(after);
    expect($('hardening-recommended-note').textContent).toBe('The recommended checks are already on.');
  });

  test('checks the user set up themselves are left alone', async () => {
    await mount([{ name: 'Gericht' }, { name: 'Preis' }]);
    state.hardening.baseline = { enabled: true, severity: 'Error', dropThresholdPercent: 35 };
    state.hardening.requiredFields = { enabled: true, severity: 'Error', fields: ['Preis'] };
    $('btn-hardening-recommended').click();
    expect(state.hardening.baseline).toEqual({ enabled: true, severity: 'Error', dropThresholdPercent: 35 });
    expect(state.hardening.requiredFields).toEqual({ enabled: true, severity: 'Error', fields: ['Preis'] });
    expect(state.hardening.noResult.enabled).toBe(true);
  });

  test('the resulting state becomes exactly the expected wire checks', async () => {
    await mount([{ name: 'Gericht' }, { name: 'Preis' }]);
    $('btn-hardening-recommended').click();
    const { buildHardeningConfig } = require('./scraping-config-builder');
    expect(buildHardeningConfig(state.hardening)).toEqual([
      { kind: 'noResult', severity: 'Warning' },
      { kind: 'requiredFields', severity: 'Warning', fieldNames: ['Gericht'] },
    ]);
  });
});

describe('plain-language wording in the markup', () => {
  test('the severity buttons say what happens, with no hover-only exit-code tooltips', async () => {
    await mount([]);
    for (const id of ['no-result', 'baseline', 'blocking', 'required-fields']) {
      expect($(`btn-hardening-${id}-warning`).textContent).toBe('Warn me');
      expect($(`btn-hardening-${id}-error`).textContent).toBe('Stop the run');
      expect($(`btn-hardening-${id}-warning`).hasAttribute('title')).toBe(false);
      expect($(`btn-hardening-${id}-error`).hasAttribute('title')).toBe(false);
    }
  });

  test('the section intro popover, the severity popover and one popover per check exist', async () => {
    await mount([]);
    // Issue #354: the intro sits behind a "?" next to the section title (and no paragraph is left).
    expect(document.querySelector('#monitoring-section-toggle .help-host').dataset.help).toBe('help.monitoring.intro');
    expect(document.querySelector('.monitoring-intro')).toBeNull();
    const keys = Array.from(document.querySelectorAll('#hardening-config .help-host')).map((h) => h.dataset.help);
    expect(keys).toEqual([
      'help.hardening.severity', 'help.hardening.recommended', 'help.hardening.noResult', 'help.hardening.nullRate',
      'help.hardening.baseline', 'help.hardening.blocking', 'help.hardening.blockingAdvanced', 'help.hardening.requiredFields',
    ]);
  });

  test('thresholds read as sentences', async () => {
    await mount([{ name: 'Preis' }]);
    const baseline = $('input-hardening-baseline-threshold').closest('label');
    expect(baseline.textContent.replace(/\s+/g, ' ').trim()).toBe('Trigger if there are % fewer rows than in the last run');
    ui.renderHardeningNullRateList(bridge, [{ fieldName: 'Preis', threshold: 50, severity: 'Warning' }], ['Preis']);
    const row = document.querySelector('.hardening-null-rate-row');
    expect(row.querySelector('select').value).toBe('Preis');
    expect(Array.from(row.querySelectorAll('.hardening-sentence-text')).map((s) => s.textContent)).toEqual(['is empty in more than', '% of the rows']);
    expect(row.querySelector('.btn-null-rate-warning').textContent).toBe('Warn me');
    expect(row.querySelector('.btn-null-rate-error').textContent).toBe('Stop the run');
  });

  test('min. length and block phrases sit in an "Advanced" disclosure, collapsed by default', async () => {
    await mount([]);
    const details = $('input-hardening-blocking-min-body-length').closest('details');
    expect(details.dataset.advanced).toBe('hardening-blocking');
    expect(details.open).toBe(false);
    expect(details.contains($('input-hardening-blocking-phrases'))).toBe(true);
    expect(details.querySelector('summary').textContent).toBe('Advanced: short pages and block phrases');
    expect($('input-hardening-blocking-min-body-length').placeholder).toBe('e.g. 1000');
  });
});
