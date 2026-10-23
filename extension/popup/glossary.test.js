// Issue #407: the glossary lists the renamed terms with the help popovers' texts.
Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

const fs = require('fs');
const path = require('path');

async function load(lang) {
  jest.resetModules();
  global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn() } } };
  const i18n = require('../i18n/i18n');
  await i18n.setLanguage(lang);
  return { t: i18n.t, glossary: require('./glossary'), ui: require('./glossary-ui') };
}

afterEach(() => { delete global.chrome; document.body.innerHTML = ''; });

describe.each(['en', 'de', 'es'])('glossary (%s)', (lang) => {
  test('every entry resolves to a term and a sentence, no raw keys', async () => {
    const { t, glossary } = await load(lang);
    const entries = glossary.buildGlossary(t);
    expect(entries).toHaveLength(glossary.GLOSSARY_ENTRIES.length);
    for (const { term, text } of entries) {
      expect(term).not.toMatch(/^[a-z]+\.[A-Za-z.]+$/);
      expect(text.length).toBeGreaterThan(20);
    }
  });
});

test('the terms are the renamed UI labels', async () => {
  const { t, glossary } = await load('en');
  const terms = glossary.buildGlossary(t).map((e) => e.term);
  expect(terms).toEqual(expect.arrayContaining(['Output layout', 'Safety checks', "Skip if the page hasn't changed", 'Remove duplicates']));
});

test('an entry whose texts are missing is left out instead of showing a key', async () => {
  const { glossary } = await load('en');
  const entries = glossary.buildGlossary((key) => (key === 'idle.dedupToggle' ? 'Remove duplicates' : key));
  expect(entries).toEqual([]);
});

test('renderGlossary writes term/explanation pairs as plain text', async () => {
  const { ui } = await load('en');
  document.body.innerHTML = '<dl id="settings-glossary-list"></dl>';
  ui.renderGlossary();
  const list = document.getElementById('settings-glossary-list');
  expect(list.querySelectorAll('dt').length).toBeGreaterThanOrEqual(6);
  expect(list.querySelectorAll('dt').length).toBe(list.querySelectorAll('dd').length);
  ui.renderGlossary(); // idempotent: a re-render does not duplicate
  expect(list.querySelectorAll('dt').length).toBe(list.querySelectorAll('dd').length);
});

test('settings.html carries the glossary section as a remembered Advanced disclosure', () => {
  const html = fs.readFileSync(path.join(__dirname, 'screens/settings.html'), 'utf8');
  document.body.innerHTML = html;
  const details = document.getElementById('settings-glossary-section');
  expect(details.tagName).toBe('DETAILS');
  expect(details.dataset.advanced).toBe('settings-glossary');
  expect(details.querySelector('#settings-glossary-list')).not.toBeNull();
});
