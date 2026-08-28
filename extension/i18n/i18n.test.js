const { SUPPORTED_LANGUAGES, FALLBACK_LANGUAGE, detectDefaultLanguage, initI18n, setLanguage, getLanguage, t } = require('./i18n');

describe('detectDefaultLanguage', () => {
  test('maps a supported two-letter prefix to itself', () => {
    expect(detectDefaultLanguage('de-DE')).toBe('de');
    expect(detectDefaultLanguage('en-US')).toBe('en');
    expect(detectDefaultLanguage('es-ES')).toBe('es');
    expect(detectDefaultLanguage('de')).toBe('de');
  });

  test('falls back to English for an unsupported language', () => {
    expect(detectDefaultLanguage('fr-FR')).toBe(FALLBACK_LANGUAGE);
    expect(detectDefaultLanguage('ja')).toBe(FALLBACK_LANGUAGE);
  });

  test('falls back to English for an empty/missing value', () => {
    expect(detectDefaultLanguage('')).toBe(FALLBACK_LANGUAGE);
    expect(detectDefaultLanguage(undefined)).toBe(FALLBACK_LANGUAGE);
  });
});

describe('initI18n / getLanguage / t', () => {
  afterEach(() => {
    delete global.chrome;
  });

  test('with no stored preference, uses the detected browser language', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}) } } };
    await initI18n('de-DE');
    expect(getLanguage()).toBe('de');
    expect(t('common.cancel')).toBe('Abbrechen');
  });

  test('a stored preference overrides the detected browser language', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({ language: 'es' }) } } };
    await initI18n('de-DE');
    expect(getLanguage()).toBe('es');
    expect(t('common.cancel')).toBe('Cancelar');
  });

  test('works without chrome.storage at all (falls back to detection)', async () => {
    await initI18n('en-US');
    expect(getLanguage()).toBe('en');
    expect(t('common.cancel')).toBe('Cancel');
  });

  test('an unsupported detected language falls back to English', async () => {
    await initI18n('fr-FR');
    expect(getLanguage()).toBe(FALLBACK_LANGUAGE);
    expect(t('common.cancel')).toBe('Cancel');
  });
});

describe('setLanguage', () => {
  afterEach(() => {
    delete global.chrome;
  });

  test('switches the active dictionary and persists the choice', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set } } };
    await initI18n('en-US');

    await setLanguage('de');

    expect(getLanguage()).toBe('de');
    expect(t('common.cancel')).toBe('Abbrechen');
    expect(set).toHaveBeenCalledWith({ language: 'de' });
  });

  test('ignores an unsupported language and keeps the current one', async () => {
    await initI18n('en-US');
    const result = await setLanguage('fr');
    expect(result).toBe('en');
    expect(getLanguage()).toBe('en');
  });

  test('works without chrome.storage at all (switch still applies, just isn\'t persisted)', async () => {
    await initI18n('en-US');
    await setLanguage('es');
    expect(getLanguage()).toBe('es');
  });
});

describe('t', () => {
  beforeEach(async () => {
    await initI18n('en-US');
  });

  test('interpolates {placeholders} from the params object', () => {
    expect(t('idle.apiCaptureSummary', { count: 3 })).toBe('3 request(s) recorded');
  });

  test('leaves an unmatched placeholder untouched', () => {
    expect(t('idle.apiCaptureSummary', {})).toBe('{count} request(s) recorded');
  });

  test('a missing key resolves to the key itself', () => {
    expect(t('nonexistent.key')).toBe('nonexistent.key');
  });

  test('all three dictionaries expose every key from the English source', async () => {
    const flatten = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) =>
      typeof v === 'string' ? [`${prefix}${k}`] : flatten(v, `${prefix}${k}.`));
    const en = require('./en.json');
    const de = require('./de.json');
    const es = require('./es.json');
    const enKeys = flatten(en).sort();
    expect(flatten(de).sort()).toEqual(enKeys);
    expect(flatten(es).sort()).toEqual(enKeys);
  });
});

describe('SUPPORTED_LANGUAGES', () => {
  test('is exactly German, English, Spanish', () => {
    expect(SUPPORTED_LANGUAGES).toEqual(['de', 'en', 'es']);
  });
});
