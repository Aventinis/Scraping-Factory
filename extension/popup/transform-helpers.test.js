// Issue #400: regex recipes and date-format inference (transform-helpers.js).
const { spawnSync } = require('child_process');
const { escapeRegexLiteral, RECIPES, buildRecipe, previewRecipe, inferDateFormat } = require('./transform-helpers');
const { applyTransformsPreview } = require('./field-transforms');

// [recipe id, args, raw value, expected extraction ('' = no match)]
const RECIPE_CASES = [
  ['firstNumber', [], 'Preis: 12,99 €', '12,99'],
  ['firstNumber', [], 'ab 1.234,56 EUR', '1.234,56'],
  ['firstNumber', [], '1,234.56 USD', '1,234.56'],
  ['firstNumber', [], 'Temperatur -5 Grad', '-5'],
  ['firstNumber', [], 'Nummer 42', '42'],
  ['firstNumber', [], 'keine Zahl', ''],
  ['digits', [], 'Art.-Nr. 4711-B', '4711'],
  ['digits', [], 'abc', ''],
  ['textAfter', ['Preis:'], 'Preis: 12,99 €', '12,99 €'],
  ['textAfter', ['Preis:'], 'Preis:12,99', '12,99'],
  ['textAfter', ['Art.-Nr.'], 'Art.-Nr. 4711', '4711'],
  ['textAfter', ['Art.-Nr.'], 'ArtXNrX 4711', ''],          // the "." is a literal dot, not "any character"
  ['textAfter', ['a+b'], 'a+b = 3', '= 3'],
  ['textAfter', ['aab'], 'a+b = 3', ''],                      // "+" is a literal plus
  ['textAfter', ['(inkl.)'], 'Preis (inkl.) 5', '5'],
  ['textAfter', ['[x]'], '[x] erledigt', 'erledigt'],
  ['textAfter', ['$'], 'Kosten $ 7', '7'],
  ['textAfter', ['\\'], 'Pfad \\ unten', 'unten'],
  ['textAfter', ['{n}'], 'Wert {n} 9', '9'],
  ['textAfter', ['a|b'], 'a|b -> 1', '-> 1'],
  ['textAfter', ['^'], 'Dach ^ oben', 'oben'],
  ['textAfter', ['Größe:'], 'Größe: 42', '42'],
  ['textAfter', ['Preis:'], 'kein Treffer hier', ''],
  ['textAfter', ['  Preis:  '], 'Preis: 3', '3'],           // surrounding spaces in the typed text are ignored
  ['textBefore', ['€'], '12,99 € netto', '12,99'],
  ['textBefore', ['('], 'Müller (Berlin)', 'Müller'],
  ['textBefore', ['.'], 'v1.2.3', 'v1'],
  ['textBefore', ['*'], 'Hinweis * kleingedruckt', 'Hinweis'],
  ['textBefore', ['?'], 'Wirklich? Ja', 'Wirklich'],
  ['textBefore', ['€'], 'ohne Währung', ''],
  ['textBetween', ['(', ')'], 'Müller (Berlin) GmbH', 'Berlin'],
  ['textBetween', ['[', ']'], 'Tag [gelb] rot', 'gelb'],
  ['textBetween', ['a.b', 'c|d'], 'x a.b mitte c|d y', 'mitte'],
  ['textBetween', ['"', '"'], 'sagt "Hallo Welt" laut', 'Hallo Welt'],
  ['textBetween', ['von', 'bis'], 'von 8 bis 17', '8'],
  ['textBetween', ['von', 'bis'], 'nur von 8', ''],
  ['brackets', ['('], 'Preis (inkl. MwSt.)', 'inkl. MwSt.'],
  ['brackets', ['['], 'Tag [gelb] rot', 'gelb'],
  ['brackets', ['{'], 'Wert {n} da', 'n'],
  ['brackets', ['<'], 'Name <a@b.de>', 'a@b.de'],
  ['brackets', [], 'Preis (netto) und (brutto)', 'netto'],   // default: round brackets, first pair
  ['brackets', ['('], 'ohne Klammern', ''],
];

describe('escapeRegexLiteral', () => {
  test('escapes every regex metacharacter and leaves everything else alone', () => {
    expect(escapeRegexLiteral('a.b')).toBe('a\\.b');
    expect(escapeRegexLiteral('(x)[y]{z}')).toBe('\\(x\\)\\[y\\]\\{z\\}');
    expect(escapeRegexLiteral('1+1=2? $5 ^ | \\')).toBe('1\\+1=2\\? \\$5 \\^ \\| \\\\');
    expect(escapeRegexLiteral('Größe: 42 €')).toBe('Größe: 42 €');
    expect(escapeRegexLiteral('')).toBe('');
  });

  test('the escaped text always matches itself literally', () => {
    for (const text of ['a.b', '(x)', '[y]', 'a+b', '$5', '^', '|', '\\', '{3}', '*?']) {
      expect(new RegExp(escapeRegexLiteral(text)).exec(`..${text}..`)?.[0]).toBe(text);
    }
  });
});

describe('buildRecipe', () => {
  test.each(RECIPE_CASES)('%s %j on %j → %j', (id, args, raw, expected) => {
    const recipe = buildRecipe(id, args);
    expect(recipe).not.toBeNull();
    expect(previewRecipe(raw, recipe)).toBe(expected);
  });

  test('the generated pattern runs through the editor\'s own live preview exactly like a hand-typed one', () => {
    const recipe = buildRecipe('textAfter', ['Preis:']);
    const viaChain = applyTransformsPreview('Preis: 12,99 €', [{ kind: 'regexExtract', pattern: recipe.pattern, group: recipe.group }]);
    expect(viaChain).toBe('12,99 €');
  });

  test('a recipe that still lacks its text is incomplete (null), not an empty pattern', () => {
    expect(buildRecipe('textAfter', [])).toBeNull();
    expect(buildRecipe('textAfter', ['   '])).toBeNull();
    expect(buildRecipe('textBefore', [''])).toBeNull();
    expect(buildRecipe('textBetween', ['a'])).toBeNull();
    expect(buildRecipe('textBetween', ['', 'b'])).toBeNull();
    expect(buildRecipe('nonsense', ['x'])).toBeNull();
    expect(previewRecipe('anything', null)).toBeNull();
  });

  test('the recipe list matches what the builder supports', () => {
    expect(RECIPES.map((r) => r.id)).toEqual(['firstNumber', 'digits', 'textAfter', 'textBefore', 'textBetween', 'brackets']);
    for (const recipe of RECIPES) {
      const args = Array.from({ length: recipe.args }, () => 'x');
      expect(buildRecipe(recipe.id, args)).not.toBeNull();
    }
  });

  test('only constructs both .NET and Python read the same way', () => {
    for (const [id, args] of RECIPE_CASES) {
      const { pattern } = buildRecipe(id, args);
      expect(pattern).not.toMatch(/\(\?<?[=!]/);   // no look-ahead / look-behind
      expect(pattern).not.toMatch(/\(\?<\w/);      // no named groups (syntax differs: (?<n> vs (?P<n>)
      expect(pattern).not.toMatch(/\(\?[a-z]/i);   // no inline flags
    }
  });
});

// The generated script runs Python's `re`, the companion validates with .NET's
// Regex: prove the same patterns give the same answers in Python (the .NET side
// runs real generated scripts in RegexRecipeEndToEndTests.cs).
const python = spawnSync('python3', ['--version']);
const pythonAvailable = python.status === 0;
(pythonAvailable ? describe : describe.skip)('Python `re` agrees with the preview for every recipe case', () => {
  test('re.search gives the same extraction', () => {
    const cases = RECIPE_CASES.map(([id, args, raw]) => ({ ...buildRecipe(id, args), raw }));
    const script = [
      'import json, re, sys',
      'cases = json.load(sys.stdin)',
      'out = []',
      'for c in cases:',
      '    m = re.search(c["pattern"], c["raw"])',
      '    g = m.group(c["group"]) if m else None',
      '    out.append(g if g is not None else "")',
      'sys.stdout.write(json.dumps(out, ensure_ascii=False))',
    ].join('\n');
    const result = spawnSync('python3', ['-c', script], { input: JSON.stringify(cases), encoding: 'utf8' });
    expect(result.status).toBe(0);
    const pythonResults = JSON.parse(result.stdout);
    expect(pythonResults).toEqual(RECIPE_CASES.map((c) => c[3]));
  });
});

describe('inferDateFormat', () => {
  test.each([
    ['28.08.2026', '{dd}.{mm}.{yyyy}', []],
    ['1.9.2026', '{dd}.{mm}.{yyyy}', []],
    ['03.04.2026', '{dd}.{mm}.{yyyy}', []],       // dotted dates are day first
    ['2026-08-28', '{yyyy}-{mm}-{dd}', []],
    ['2026/8/5', '{yyyy}/{mm}/{dd}', []],
    ['2026.08.28', '{yyyy}.{mm}.{dd}', []],
    ['28-08-2026', '{dd}-{mm}-{yyyy}', []],
    ['08/28/2026', '{mm}/{dd}/{yyyy}', []],       // 28 can't be a month
    ['28/08/2026', '{dd}/{mm}/{yyyy}', []],
    ['03/04/2026', '{dd}/{mm}/{yyyy}', ['{mm}/{dd}/{yyyy}']],   // genuinely ambiguous: day first, the other reading is named
    ['05/05/2026', '{dd}/{mm}/{yyyy}', []],       // same either way
    ['20260828', '{yyyy}{mm}{dd}', []],
    ['  28.08.2026  ', '{dd}.{mm}.{yyyy}', []],
  ])('%j → %s %j', (raw, format, alternatives) => {
    expect(inferDateFormat(raw)).toEqual({ format, alternatives });
  });

  test.each([
    '28 Aug 2026',            // month names aren't supported by the format
    'August 28, 2026',
    'Stand: 28.08.2026',      // text around the date
    '28.08.2026 14:30',
    '31.02.2026',             // matches the shape, isn't a real date
    '13/13/2026',
    '2026-13-01',
    '28.08.26',
    'morgen',
    '12345',
    '',
    null,
    undefined,
  ])('%j gets no guess', (raw) => {
    expect(inferDateFormat(raw)).toBeNull();
  });

  test('a guess always converts the value (checked against the real preview)', () => {
    const { toDatePreview } = require('./field-transforms');
    for (const raw of ['28.08.2026', '2026-08-28', '08/28/2026', '20260828', '1.9.2026']) {
      const { format } = inferDateFormat(raw);
      expect(toDatePreview(raw, format)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
