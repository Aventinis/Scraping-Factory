// Renders translated copy via i18n's t(), so a real dictionary has to be loaded.
global.chrome = global.chrome || { storage: { local: { get: (k, cb) => cb({}), set: (o, cb) => cb && cb() } } };
const { initI18n } = require('../i18n/i18n');
beforeAll(() => initI18n('de-DE'));

const {
  buildScrapingConfig,
  buildChangeDetectionConfig,
  buildHardeningConfig,
  computeInitialMonitoringSectionOpen,
  collectFieldNames,
  addNullRateCheck,
  removeNullRateCheck,
  updateNullRateCheck,
  addRequiredField,
  removeRequiredField,
} = require('./scraping-config-builder');
const { buildGroupNode } = require('./container-tree');

// Issue #129
describe('buildHardeningConfig', () => {
  test('returns null when noResult is disabled', () => {
    expect(buildHardeningConfig({ noResult: { enabled: false, severity: 'Warning' } })).toBeNull();
  });

  test('returns null for null/undefined input', () => {
    expect(buildHardeningConfig(null)).toBeNull();
    expect(buildHardeningConfig(undefined)).toBeNull();
  });

  test('builds a one-item array with the camelCase kind and the severity as-is', () => {
    expect(buildHardeningConfig({ noResult: { enabled: true, severity: 'Error' } })).toEqual([
      { kind: 'noResult', severity: 'Error' },
    ]);
    expect(buildHardeningConfig({ noResult: { enabled: true, severity: 'Warning' } })).toEqual([
      { kind: 'noResult', severity: 'Warning' },
    ]);
  });
});

describe('buildScrapingConfig (hardening, Issue #129)', () => {
  test('omits hardening entirely when disabled (the default)', () => {
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
    });
    expect(result.hardening).toBeUndefined();
  });

  test('includes hardening when enabled and configured', () => {
    const hardening = { noResult: { enabled: true, severity: 'Error' } };
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      hardening,
    });
    expect(result.hardening).toEqual([{ kind: 'noResult', severity: 'Error' }]);
  });

  test('works the same way for container and api modes', () => {
    const hardening = { noResult: { enabled: true, severity: 'Warning' } };
    const groups = [buildGroupNode('Kategorie', 'section', true)];
    const containerResult = buildScrapingConfig({ url: 'https://example.com', mode: 'container', groups, hardening });
    expect(containerResult.hardening).toEqual([{ kind: 'noResult', severity: 'Warning' }]);

    const apiResult = buildScrapingConfig({ url: 'https://example.com', mode: 'api', apiConfig: { fields: [] }, hardening });
    expect(apiResult.hardening).toEqual([{ kind: 'noResult', severity: 'Warning' }]);
  });
});

// Issue #130
describe('buildHardeningConfig (nullRate)', () => {
  test('omits an incomplete row (no field chosen)', () => {
    expect(buildHardeningConfig({ nullRate: [{ fieldName: '', threshold: 30, severity: 'Warning' }] })).toBeNull();
  });

  test('converts the percent threshold into a 0.0-1.0 fraction', () => {
    expect(buildHardeningConfig({ nullRate: [{ fieldName: 'Preis', threshold: 30, severity: 'Error' }] })).toEqual([
      { kind: 'nullRate', severity: 'Error', fieldName: 'Preis', threshold: 0.3 },
    ]);
  });

  test('clamps an out-of-range or non-numeric threshold, defaulting to 50%', () => {
    expect(buildHardeningConfig({ nullRate: [{ fieldName: 'A', threshold: 150, severity: 'Warning' }] })).toEqual([
      { kind: 'nullRate', severity: 'Warning', fieldName: 'A', threshold: 1 },
    ]);
    expect(buildHardeningConfig({ nullRate: [{ fieldName: 'A', threshold: -20, severity: 'Warning' }] })).toEqual([
      { kind: 'nullRate', severity: 'Warning', fieldName: 'A', threshold: 0 },
    ]);
    expect(buildHardeningConfig({ nullRate: [{ fieldName: 'A', threshold: NaN, severity: 'Warning' }] })).toEqual([
      { kind: 'nullRate', severity: 'Warning', fieldName: 'A', threshold: 0.5 },
    ]);
  });

  test('combines multiple complete rows with noResult', () => {
    const hardening = {
      noResult: { enabled: true, severity: 'Error' },
      nullRate: [
        { fieldName: 'Preis', threshold: 30, severity: 'Error' },
        { fieldName: '', threshold: 10, severity: 'Warning' }, // incomplete, skipped
        { fieldName: 'Titel', threshold: 10, severity: 'Warning' },
      ],
    };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'noResult', severity: 'Error' },
      { kind: 'nullRate', severity: 'Error', fieldName: 'Preis', threshold: 0.3 },
      { kind: 'nullRate', severity: 'Warning', fieldName: 'Titel', threshold: 0.1 },
    ]);
  });

  test('returns null when everything is empty/disabled', () => {
    expect(buildHardeningConfig({ noResult: { enabled: false, severity: 'Warning' }, nullRate: [] })).toBeNull();
  });
});

// Issue #131
describe('buildHardeningConfig (baseline)', () => {
  test('returns null when baseline is disabled', () => {
    expect(buildHardeningConfig({ baseline: { enabled: false, severity: 'Warning', dropThresholdPercent: 20 } })).toBeNull();
  });

  test('converts dropThresholdPercent into a 0.0-1.0 fraction', () => {
    expect(buildHardeningConfig({ baseline: { enabled: true, severity: 'Error', dropThresholdPercent: 20 } })).toEqual([
      { kind: 'baseline', severity: 'Error', dropThreshold: 0.2 },
    ]);
  });

  test('clamps an out-of-range or non-numeric percent, defaulting to 20%', () => {
    expect(buildHardeningConfig({ baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: 150 } })).toEqual([
      { kind: 'baseline', severity: 'Warning', dropThreshold: 1 },
    ]);
    expect(buildHardeningConfig({ baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: -10 } })).toEqual([
      { kind: 'baseline', severity: 'Warning', dropThreshold: 0 },
    ]);
    expect(buildHardeningConfig({ baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: NaN } })).toEqual([
      { kind: 'baseline', severity: 'Warning', dropThreshold: 0.2 },
    ]);
  });

  test('combines with noResult and nullRate', () => {
    const hardening = {
      noResult: { enabled: true, severity: 'Error' },
      nullRate: [{ fieldName: 'Preis', threshold: 30, severity: 'Error' }],
      baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: 20 },
    };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'noResult', severity: 'Error' },
      { kind: 'nullRate', severity: 'Error', fieldName: 'Preis', threshold: 0.3 },
      { kind: 'baseline', severity: 'Warning', dropThreshold: 0.2 },
    ]);
  });
});

describe('buildScrapingConfig (baseline hardening, Issue #131)', () => {
  test('threads a baseline check through the wire config', () => {
    const hardening = { baseline: { enabled: true, severity: 'Error', dropThresholdPercent: 25 } };
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      hardening,
    });
    expect(result.hardening).toEqual([{ kind: 'baseline', severity: 'Error', dropThreshold: 0.25 }]);
  });
});

// Issue #132
describe('buildHardeningConfig (blocking)', () => {
  test('returns null when blocking is disabled', () => {
    expect(buildHardeningConfig({ blocking: { enabled: false, severity: 'Warning', minBodyLengthText: '', phrasesText: '' } })).toBeNull();
  });

  test('includes minBodyLength and blockPhrases when both are set', () => {
    const hardening = { blocking: { enabled: true, severity: 'Error', minBodyLengthText: '200', phrasesText: 'Access Denied\nPlease verify you are human' } };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'blocking', severity: 'Error', minBodyLength: 200, blockPhrases: ['Access Denied', 'Please verify you are human'] },
    ]);
  });

  // Unlike nullRate, there's no "at least one signal configured"
  // requirement — the cross-origin-redirect signal is always active, so an
  // enabled BlockingCheck with neither field filled in is still valid.
  test('omits minBodyLength (null) and blockPhrases (empty array) when both are blank', () => {
    const hardening = { blocking: { enabled: true, severity: 'Warning', minBodyLengthText: '', phrasesText: '' } };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'blocking', severity: 'Warning', minBodyLength: null, blockPhrases: [] },
    ]);
  });

  test('treats a non-positive or non-numeric minBodyLengthText as unset', () => {
    expect(buildHardeningConfig({ blocking: { enabled: true, severity: 'Warning', minBodyLengthText: '0', phrasesText: '' } })).toEqual([
      { kind: 'blocking', severity: 'Warning', minBodyLength: null, blockPhrases: [] },
    ]);
    expect(buildHardeningConfig({ blocking: { enabled: true, severity: 'Warning', minBodyLengthText: 'not a number', phrasesText: '' } })).toEqual([
      { kind: 'blocking', severity: 'Warning', minBodyLength: null, blockPhrases: [] },
    ]);
  });

  // One phrase per line (not comma-split like API mode's value list) —
  // blank lines are dropped, a comma inside a phrase is preserved verbatim.
  test('splits phrasesText on newlines only, dropping blank lines', () => {
    const hardening = { blocking: { enabled: true, severity: 'Warning', minBodyLengthText: '', phrasesText: 'Access Denied\n\n  \nRate limit, try again later' } };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'blocking', severity: 'Warning', minBodyLength: null, blockPhrases: ['Access Denied', 'Rate limit, try again later'] },
    ]);
  });

  test('combines with noResult, nullRate, and baseline', () => {
    const hardening = {
      noResult: { enabled: true, severity: 'Error' },
      nullRate: [{ fieldName: 'Preis', threshold: 30, severity: 'Error' }],
      baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: 20 },
      blocking: { enabled: true, severity: 'Error', minBodyLengthText: '200', phrasesText: 'Access Denied' },
    };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'noResult', severity: 'Error' },
      { kind: 'nullRate', severity: 'Error', fieldName: 'Preis', threshold: 0.3 },
      { kind: 'baseline', severity: 'Warning', dropThreshold: 0.2 },
      { kind: 'blocking', severity: 'Error', minBodyLength: 200, blockPhrases: ['Access Denied'] },
    ]);
  });
});

describe('buildScrapingConfig (blocking hardening, Issue #132)', () => {
  test('threads a blocking check through the wire config', () => {
    const hardening = { blocking: { enabled: true, severity: 'Error', minBodyLengthText: '200', phrasesText: 'Access Denied' } };
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      hardening,
    });
    expect(result.hardening).toEqual([{ kind: 'blocking', severity: 'Error', minBodyLength: 200, blockPhrases: ['Access Denied'] }]);
  });
});

// Issue #133
describe('addRequiredField / removeRequiredField', () => {
  test('adds a field name', () => {
    expect(addRequiredField(['Titel'], 'Preis')).toEqual(['Titel', 'Preis']);
  });

  test('adding an already-present field name is a no-op', () => {
    expect(addRequiredField(['Titel', 'Preis'], 'Preis')).toEqual(['Titel', 'Preis']);
  });

  test('adding a blank/undefined field name is a no-op', () => {
    expect(addRequiredField(['Titel'], '')).toEqual(['Titel']);
    expect(addRequiredField(['Titel'], undefined)).toEqual(['Titel']);
  });

  test('removes a field name by index', () => {
    expect(removeRequiredField(['Titel', 'Preis', 'Menge'], 1)).toEqual(['Titel', 'Menge']);
  });
});

describe('buildHardeningConfig (requiredFields)', () => {
  test('returns null when disabled', () => {
    expect(buildHardeningConfig({ requiredFields: { enabled: false, severity: 'Warning', fields: ['Titel'] } })).toBeNull();
  });

  // Unlike blocking (still meaningful with nothing configured, thanks to
  // its always-on redirect signal), an enabled requiredFields check with no
  // fields chosen yet has nothing to do at all — same "incomplete draft,
  // not sent" convention as an unfinished nullRate row.
  test('returns null when enabled but no fields chosen yet', () => {
    expect(buildHardeningConfig({ requiredFields: { enabled: true, severity: 'Warning', fields: [] } })).toBeNull();
  });

  test('includes the configured field names and shared severity', () => {
    const hardening = { requiredFields: { enabled: true, severity: 'Error', fields: ['Titel', 'Preis'] } };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'requiredFields', severity: 'Error', fieldNames: ['Titel', 'Preis'] },
    ]);
  });

  test('combines with the other four checks', () => {
    const hardening = {
      noResult: { enabled: true, severity: 'Error' },
      nullRate: [{ fieldName: 'Preis', threshold: 30, severity: 'Error' }],
      baseline: { enabled: true, severity: 'Warning', dropThresholdPercent: 20 },
      blocking: { enabled: true, severity: 'Error', minBodyLengthText: '200', phrasesText: 'Access Denied' },
      requiredFields: { enabled: true, severity: 'Error', fields: ['Titel'] },
    };
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'noResult', severity: 'Error' },
      { kind: 'nullRate', severity: 'Error', fieldName: 'Preis', threshold: 0.3 },
      { kind: 'baseline', severity: 'Warning', dropThreshold: 0.2 },
      { kind: 'blocking', severity: 'Error', minBodyLength: 200, blockPhrases: ['Access Denied'] },
      { kind: 'requiredFields', severity: 'Error', fieldNames: ['Titel'] },
    ]);
  });
});

describe('buildScrapingConfig (requiredFields hardening, Issue #133)', () => {
  test('threads a requiredFields check through the wire config', () => {
    const hardening = { requiredFields: { enabled: true, severity: 'Error', fields: ['Titel'] } };
    const result = buildScrapingConfig({
      url: 'https://example.com',
      mode: 'flat',
      fields: [{ name: 'Titel', selector: 'h1' }],
      hardening,
    });
    expect(result.hardening).toEqual([{ kind: 'requiredFields', severity: 'Error', fieldNames: ['Titel'] }]);
  });
});

// Issue #183
describe('computeInitialMonitoringSectionOpen', () => {
  const allDisabledHardening = {
    noResult: { enabled: false, severity: 'Warning' },
    nullRate: [],
    baseline: { enabled: false, severity: 'Warning', dropThresholdPercent: 20 },
    blocking: { enabled: false, severity: 'Warning', minBodyLengthText: '', phrasesText: '' },
    requiredFields: { enabled: false, severity: 'Warning', fields: [] },
  };

  test('returns false when neither change detection nor any hardening check is configured', () => {
    expect(computeInitialMonitoringSectionOpen(null, allDisabledHardening)).toBe(false);
  });

  test('returns true when change detection is configured', () => {
    const changeDetection = {
      enabled: true, notify: 'Webhook', email: null, webhook: { urlEnvVar: 'SF_WEBHOOK' },
    };
    expect(computeInitialMonitoringSectionOpen(changeDetection, allDisabledHardening)).toBe(true);
  });

  test('returns true when a hardening check is configured', () => {
    const hardening = { ...allDisabledHardening, noResult: { enabled: true, severity: 'Error' } };
    expect(computeInitialMonitoringSectionOpen(null, hardening)).toBe(true);
  });

  // An enabled-but-incomplete draft (e.g. change detection toggled on but
  // its required fields still blank) is exactly what
  // buildChangeDetectionConfig/buildHardeningConfig already treat as "not
  // actually configured" — reusing that logic means this stays consistent
  // automatically, with no separate "is it complete" check duplicated here.
  test('returns false for an enabled-but-incomplete change-detection draft', () => {
    const changeDetection = {
      enabled: true, notify: 'Webhook', email: null, webhook: { urlEnvVar: '' },
    };
    expect(computeInitialMonitoringSectionOpen(changeDetection, allDisabledHardening)).toBe(false);
  });

  test('returns false for an enabled-but-empty requiredFields draft', () => {
    const hardening = { ...allDisabledHardening, requiredFields: { enabled: true, severity: 'Warning', fields: [] } };
    expect(computeInitialMonitoringSectionOpen(null, hardening)).toBe(false);
  });
});

describe('collectFieldNames (Issue #130)', () => {
  test('flat mode: reads field names straight off the fields array', () => {
    const fields = [{ name: 'Titel', selector: 'h1' }, { name: 'Preis', selector: '.price' }];
    expect(collectFieldNames('flat', fields, [], null)).toEqual(['Titel', 'Preis']);
  });

  test('container mode: walks the live draft tree, deduplicating repeated leaf names', () => {
    const groups = [
      {
        kind: 'group', name: 'Kategorie', children: [
          { kind: 'field', name: 'Titel' },
          { kind: 'field', name: 'Preis' },
          {
            kind: 'group', name: 'Unterkategorie', children: [
              { kind: 'field', name: 'Preis' }, // same leaf name, nested deeper
            ],
          },
        ],
      },
    ];
    expect(collectFieldNames('container', [], groups, null)).toEqual(['Titel', 'Preis']);
  });

  test('api mode, flat shape: reads apiConfig.fields', () => {
    const apiConfig = { fields: [{ name: 'Titel' }, { name: 'Preis' }] };
    expect(collectFieldNames('api', [], [], apiConfig)).toEqual(['Titel', 'Preis']);
  });

  test('api mode, tree shape: walks the serialized apiConfig.groups (structural children discriminator)', () => {
    const apiConfig = {
      groups: [
        {
          name: 'Kategorie', path: 'categories[*]', children: [
            { name: 'Titel', path: 'name' },
            { name: 'Unterkategorie', path: 'items[*]', children: [{ name: 'Preis', path: 'price' }] },
          ],
        },
      ],
    };
    expect(collectFieldNames('api', [], [], apiConfig)).toEqual(['Titel', 'Preis']);
  });

  test('returns an empty array when there is nothing configured yet', () => {
    expect(collectFieldNames('flat', [], [], null)).toEqual([]);
    expect(collectFieldNames('container', [], [], null)).toEqual([]);
    expect(collectFieldNames('api', [], [], null)).toEqual([]);
  });
});

describe('addNullRateCheck / removeNullRateCheck / updateNullRateCheck (Issue #130)', () => {
  test('addNullRateCheck appends a row with a default 50% threshold and Warning severity', () => {
    expect(addNullRateCheck([], 'Preis')).toEqual([{ fieldName: 'Preis', threshold: 50, severity: 'Warning' }]);
  });

  test('addNullRateCheck tolerates no field chosen yet', () => {
    expect(addNullRateCheck([], undefined)).toEqual([{ fieldName: '', threshold: 50, severity: 'Warning' }]);
  });

  test('removeNullRateCheck drops the row at the given index only', () => {
    const rows = [
      { fieldName: 'A', threshold: 10, severity: 'Warning' },
      { fieldName: 'B', threshold: 20, severity: 'Error' },
    ];
    expect(removeNullRateCheck(rows, 0)).toEqual([{ fieldName: 'B', threshold: 20, severity: 'Error' }]);
  });

  test('updateNullRateCheck patches only the targeted row, leaving others untouched', () => {
    const rows = [
      { fieldName: 'A', threshold: 10, severity: 'Warning' },
      { fieldName: 'B', threshold: 20, severity: 'Error' },
    ];
    expect(updateNullRateCheck(rows, 1, { severity: 'Warning' })).toEqual([
      { fieldName: 'A', threshold: 10, severity: 'Warning' },
      { fieldName: 'B', threshold: 20, severity: 'Warning' },
    ]);
  });
});
