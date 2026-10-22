// Issue #354 Part B: the panel carries one line per hint — the long explanations
// live in the bundled user documentation (docs/user, "Learn more"). This keeps a
// `*Hint` text from growing back into a paragraph; reword it short and put the
// detail on the matching docs page instead.
const en = require('./en.json');
const de = require('./de.json');
const es = require('./es.json');

// German and Spanish run longer than English for the same sentence.
const LIMITS = { en: 160, de: 190, es: 200 };

function hints(dict, prefix = '') {
  return Object.entries(dict).flatMap(([k, v]) =>
    (v && typeof v === 'object' ? hints(v, `${prefix}${k}.`) : (k.endsWith('Hint') ? [[`${prefix}${k}`, String(v)]] : [])));
}

describe.each([['en', en], ['de', de], ['es', es]])('hint texts (%s)', (lang, dict) => {
  test(`no *Hint is longer than ${LIMITS[lang]} characters`, () => {
    const tooLong = hints(dict).filter(([, text]) => text.length > LIMITS[lang]).map(([key, text]) => `${key} (${text.length})`);
    expect(tooLong).toEqual([]);
  });
});
