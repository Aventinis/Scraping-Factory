// Issue #399: the "Recommended checks" preset (hardening-presets.js).
const { applyRecommendedHardening } = require('./hardening-presets');
const { buildHardeningConfig } = require('./scraping-config-builder');

const initial = () => ({
  noResult: { enabled: false, severity: 'Warning' },
  nullRate: [],
  baseline: { enabled: false, severity: 'Warning', dropThresholdPercent: 20 },
  blocking: { enabled: false, severity: 'Warning', minBodyLengthText: '', phrasesText: '' },
  requiredFields: { enabled: false, severity: 'Warning', fields: [] },
});

describe('applyRecommendedHardening', () => {
  test('a fresh configuration with fields: "empty result" as a warning plus the first field as required', () => {
    const { hardening, applied, needsFields } = applyRecommendedHardening(initial(), ['Gericht', 'Preis', 'Beschreibung']);
    expect(hardening.noResult).toEqual({ enabled: true, severity: 'Warning' });
    expect(hardening.requiredFields).toEqual({ enabled: true, severity: 'Warning', fields: ['Gericht'] });
    expect(applied).toEqual({ noResult: true, requiredField: 'Gericht' });
    expect(needsFields).toBe(false);
  });

  test('the resulting wire config holds exactly those two checks, both warnings', () => {
    const { hardening } = applyRecommendedHardening(initial(), ['Gericht', 'Preis']);
    expect(buildHardeningConfig(hardening)).toEqual([
      { kind: 'noResult', severity: 'Warning' },
      { kind: 'requiredFields', severity: 'Warning', fieldNames: ['Gericht'] },
    ]);
  });

  test('without fields only "empty result" is switched on, and the caller is told why the rest is missing', () => {
    const { hardening, applied, needsFields } = applyRecommendedHardening(initial(), []);
    expect(hardening.noResult.enabled).toBe(true);
    expect(hardening.requiredFields.enabled).toBe(false);
    expect(applied).toEqual({ noResult: true, requiredField: null });
    expect(needsFields).toBe(true);
    expect(buildHardeningConfig(hardening)).toEqual([{ kind: 'noResult', severity: 'Warning' }]);
  });

  test('never touches the other three checks', () => {
    const start = initial();
    start.nullRate = [{ fieldName: 'Preis', threshold: 30, severity: 'Error' }];
    start.baseline = { enabled: true, severity: 'Error', dropThresholdPercent: 35 };
    start.blocking = { enabled: true, severity: 'Warning', minBodyLengthText: '500', phrasesText: 'Access Denied' };
    const { hardening } = applyRecommendedHardening(start, ['A']);
    expect(hardening.nullRate).toEqual(start.nullRate);
    expect(hardening.baseline).toEqual(start.baseline);
    expect(hardening.blocking).toEqual(start.blocking);
  });

  test('a check the user already switched on is left exactly as it is (even as "stop the run")', () => {
    const start = initial();
    start.noResult = { enabled: true, severity: 'Error' };
    start.requiredFields = { enabled: true, severity: 'Error', fields: ['Preis'] };
    const { hardening, applied, needsFields } = applyRecommendedHardening(start, ['Gericht', 'Preis']);
    expect(hardening.noResult).toEqual({ enabled: true, severity: 'Error' });
    expect(hardening.requiredFields).toEqual({ enabled: true, severity: 'Error', fields: ['Preis'] });
    expect(applied).toEqual({ noResult: false, requiredField: null });
    expect(needsFields).toBe(false);
  });

  test('fields the user already listed for "required" are not replaced, even while the check is off', () => {
    const start = initial();
    start.requiredFields = { enabled: false, severity: 'Warning', fields: ['Preis'] };
    const { hardening, applied } = applyRecommendedHardening(start, ['Gericht']);
    expect(hardening.requiredFields.fields).toEqual(['Preis']);
    expect(hardening.requiredFields.enabled).toBe(false);
    expect(applied.requiredField).toBeNull();
  });

  test('a switched-off "empty result" that was left on "stop the run" comes back as a warning', () => {
    const start = initial();
    start.noResult = { enabled: false, severity: 'Error' };
    expect(applyRecommendedHardening(start, []).hardening.noResult).toEqual({ enabled: true, severity: 'Warning' });
  });

  test('applying it twice changes nothing the second time', () => {
    const once = applyRecommendedHardening(initial(), ['Gericht']).hardening;
    const twice = applyRecommendedHardening(once, ['Gericht']);
    expect(twice.hardening).toEqual(once);
    expect(twice.applied).toEqual({ noResult: false, requiredField: null });
  });

  test('does not mutate its input', () => {
    const start = initial();
    const snapshot = JSON.stringify(start);
    applyRecommendedHardening(start, ['A']);
    expect(JSON.stringify(start)).toBe(snapshot);
  });
});
