// Issue #407: the rarely used options sit under remembered "Advanced"
// disclosures (real idle/settings/modals markup), and a disclosure opens by
// itself when its option is in use.
Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

const fs = require('fs');
const path = require('path');

const read = (name) => fs.readFileSync(path.join(__dirname, 'screens', name), 'utf8');
const $ = (id) => document.getElementById(id);

async function mount(html) {
  jest.resetModules();
  document.body.innerHTML = html;
  global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn() } } };
  const { setLanguage, t } = require('../i18n/i18n');
  await setLanguage('en');
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
}

afterEach(() => { delete global.chrome; document.body.innerHTML = ''; });

describe('markup: each rare option lives inside its Advanced disclosure', () => {
  test.each([
    ['idle.html', 'input-retry-status-codes', 'retry-status-codes'],
    ['idle.html', 'input-dedup-retention-value', 'dedup-retention'],
    ['idle.html', 'toggle-persistent-session', 'persistent-session'],
    ['modals.html', 'input-field-download-max-size', 'download-limits-container'],
    ['modals.html', 'input-field-download-allowed-types', 'download-limits-container'],
    ['modals.html', 'input-field-name-download-max-size', 'download-limits-flat'],
    ['modals.html', 'input-field-name-download-allowed-types', 'download-limits-flat'],
  ])('%s: #%s is under data-advanced="%s", collapsed by default', async (file, id, section) => {
    await mount(read(file));
    const details = $(id).closest('details.advanced-disclosure');
    expect(details).not.toBeNull();
    expect(details.dataset.advanced).toBe(section);
    expect(details.open).toBe(false);
    expect(details.querySelector('summary').textContent).not.toBe('');
    expect(details.querySelector('summary').textContent).not.toMatch(/^[a-z]+\.[a-zA-Z.]+$/); // a real translation, not the key
  });
});

describe('auto-open', () => {
  test('persistent session: opens once when it is on, and not when it is off', async () => {
    await mount(read('idle.html'));
    const { renderBrowserActionsSection } = require('./browser-actions-ui');
    let state = { engine: 'Browser', browserActions: [], persistentSession: false, mode: 'flat' };
    const bridge = { getState: () => state, setState: jest.fn(), patchState: jest.fn() };
    renderBrowserActionsSection(bridge);
    const details = $('toggle-persistent-session').closest('details');
    expect(details.open).toBe(false);

    state = { ...state, persistentSession: true };
    renderBrowserActionsSection(bridge);
    expect(details.open).toBe(true);

    // The user closes it on purpose: a later render must not force it open again.
    details.open = false;
    renderBrowserActionsSection(bridge);
    expect(details.open).toBe(false);
  });

  test('deduplication: a changed retention opens the disclosure, the default does not', async () => {
    await mount(read('idle.html'));
    const { renderDedupSection } = require('./dedup-config-ui');
    const { createDefaultDeduplication } = require('./dedup-config');
    let state = { mode: 'flat', fields: [], groups: [], apiConfig: null, deduplication: { ...createDefaultDeduplication(), enabled: true, incremental: true } };
    const bridge = { getState: () => state, setState: jest.fn(), patchState: jest.fn() };
    renderDedupSection(bridge);
    const details = $('input-dedup-retention-value').closest('details');
    expect(details.open).toBe(false);

    state = { ...state, deduplication: { ...state.deduplication, retentionValueText: '500' } };
    renderDedupSection(bridge);
    expect(details.open).toBe(true);
  });
});
