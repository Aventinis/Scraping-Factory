// Issue #396: keeps the help texts (help.<area>.<field>.text/.example) in
// sync across de/en/es and with the HTML that references them. Fails when
//   - a `data-help="…"` key used in popup.html or screens/*.html has no entry
//     in some language,
//   - a `help.*` entry exists in one language but not in all three,
//   - an entry is malformed (no text, unknown property, key not help.<area>.<field>),
//   - a help host uses a key that is not a valid help key.
// Over-long texts are only reported (console.warn), not failed — see the
// conventions in popup/help-popover.js.
const fs = require('fs');
const path = require('path');
const {
  collectHelpKeysFromHtml, collectHelpEntries, helpEntryProblems, helpEntryLengthWarnings, isValidHelpKey,
} = require('../popup/help-popover');

const LANGUAGES = ['de', 'en', 'es'];
const dictionaries = Object.fromEntries(LANGUAGES.map((l) => [l, require(`./${l}.json`)]));

const POPUP_DIR = path.join(__dirname, '..', 'popup');
const HTML_FILES = ['popup.html', ...fs.readdirSync(path.join(POPUP_DIR, 'screens')).filter((f) => f.endsWith('.html')).map((f) => `screens/${f}`)];

/** Problems found for a set of dictionaries + HTML; exported to the self-check below. */
function findHelpProblems(dicts, htmlByFile) {
  const problems = [];
  const entriesByLang = Object.fromEntries(Object.entries(dicts).map(([l, d]) => [l, collectHelpEntries(d)]));

  for (const [lang, entries] of Object.entries(entriesByLang)) {
    for (const [key, entry] of Object.entries(entries)) {
      helpEntryProblems(key, entry).forEach((p) => problems.push(`[${lang}] ${p}`));
    }
  }

  const everyKey = new Set(Object.values(entriesByLang).flatMap((e) => Object.keys(e)));
  for (const key of everyKey) {
    for (const lang of Object.keys(dicts)) {
      if (!(key in entriesByLang[lang])) problems.push(`[${lang}] ${key}: missing (present in another language)`);
    }
  }

  for (const [file, html] of Object.entries(htmlByFile)) {
    for (const key of collectHelpKeysFromHtml(html)) {
      if (!isValidHelpKey(key)) { problems.push(`${file}: data-help="${key}" is not a help.<area>.<field> key`); continue; }
      for (const lang of Object.keys(dicts)) {
        if (!(key in entriesByLang[lang])) problems.push(`[${lang}] ${key}: referenced in ${file} but missing`);
      }
    }
  }
  return problems;
}

const realHtml = Object.fromEntries(HTML_FILES.map((f) => [f, fs.readFileSync(path.join(POPUP_DIR, f), 'utf8')]));

test('help texts are complete and consistent in de/en/es and match the HTML', () => {
  expect(findHelpProblems(dictionaries, realHtml)).toEqual([]);
});

test('over-long help texts are reported (soft limit)', () => {
  const warnings = Object.entries(dictionaries).flatMap(([lang, d]) =>
    Object.entries(collectHelpEntries(d)).flatMap(([key, entry]) => helpEntryLengthWarnings(key, entry).map((w) => `[${lang}] ${w}`)));
  warnings.forEach((w) => console.warn(w));
  expect(Array.isArray(warnings)).toBe(true);
});

test('every help host in the HTML lives in a file the loader actually fetches', () => {
  // idle.html / api-config.html / settings.html / modals.html are fetched at
  // runtime (popup.ts's loadScreenPartials) — a host in any other file would
  // never be rendered.
  const loadable = ['popup.html', 'screens/idle.html', 'screens/api-config.html', 'screens/settings.html', 'screens/modals.html'];
  for (const file of HTML_FILES) {
    if (collectHelpKeysFromHtml(realHtml[file]).length > 0) expect(loadable).toContain(file);
  }
});

describe('the sync check really catches problems (deliberately broken inputs)', () => {
  const good = { help: { a: { b: { text: 'T', example: 'e' } } } };
  const html = { 'x.html': '<span data-help="help.a.b"></span>' };
  const dicts = () => ({ de: JSON.parse(JSON.stringify(good)), en: JSON.parse(JSON.stringify(good)), es: JSON.parse(JSON.stringify(good)) });

  test('the baseline is clean', () => {
    expect(findHelpProblems(dicts(), html)).toEqual([]);
  });

  test('a key referenced in the HTML but missing in one language', () => {
    const d = dicts();
    delete d.es.help.a.b;
    expect(findHelpProblems(d, html)).toContain('[es] help.a.b: referenced in x.html but missing');
  });

  test('a help key present in one language only', () => {
    const d = dicts();
    d.en.help.a.extra = { text: 'only English' };
    expect(findHelpProblems(d, html)).toEqual(expect.arrayContaining([
      '[de] help.a.extra: missing (present in another language)',
      '[es] help.a.extra: missing (present in another language)',
    ]));
  });

  test('an entry without text', () => {
    const d = dicts();
    delete d.de.help.a.b.text;
    expect(findHelpProblems(d, html)).toContain('[de] help.a.b: missing "text"');
  });

  test('a host with a malformed key', () => {
    expect(findHelpProblems(dicts(), { 'x.html': '<span data-help="proxy"></span>' })).toHaveLength(1);
  });
});
