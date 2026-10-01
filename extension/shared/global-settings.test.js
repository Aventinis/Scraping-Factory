const { DEFAULTS, loadGlobalSettings, getGlobalSettings, updateGlobalSettings } = require('./global-settings');

describe('loadGlobalSettings / getGlobalSettings', () => {
  afterEach(() => {
    delete global.chrome;
  });

  test('with nothing stored, caches and returns the defaults', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}) } } };
    expect(await loadGlobalSettings()).toEqual(DEFAULTS);
    expect(getGlobalSettings()).toEqual(DEFAULTS);
  });

  test('a stored value takes precedence, merged over the defaults', async () => {
    global.chrome = {
      storage: { local: { get: jest.fn().mockResolvedValue({ globalSettings: { outputAsJson: true, scriptNameMode: 'hostname' } }) } },
    };
    const result = await loadGlobalSettings();
    expect(result.outputAsJson).toBe(true);
    expect(result.scriptNameMode).toBe('hostname');
    // Untouched keys still fall back to the defaults.
    expect(result.includeDataPreview).toBe(false);
    expect(result.scriptNameFixed).toBe('scraper');
  });

  test('works without chrome.storage at all (falls back to the defaults)', async () => {
    expect(await loadGlobalSettings()).toEqual(DEFAULTS);
  });

  test('a storage read failure falls back to the defaults instead of throwing', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockRejectedValue(new Error('boom')) } } };
    expect(await loadGlobalSettings()).toEqual(DEFAULTS);
  });

  test('getGlobalSettings never re-reads storage — a synchronous cache read', async () => {
    const get = jest.fn().mockResolvedValue({ globalSettings: { outputAsJson: true } });
    global.chrome = { storage: { local: { get } } };
    await loadGlobalSettings();
    getGlobalSettings();
    getGlobalSettings();
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('updateGlobalSettings', () => {
  afterEach(() => {
    delete global.chrome;
  });

  test('merges the patch into the cache and persists the full merged object', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set } } };

    await loadGlobalSettings();
    const result = await updateGlobalSettings({ includeOutputFile: true });

    expect(result.includeOutputFile).toBe(true);
    expect(getGlobalSettings().includeOutputFile).toBe(true);
    expect(set).toHaveBeenCalledWith({ globalSettings: expect.objectContaining({ includeOutputFile: true }) });
  });

  test('works without chrome.storage at all (still updates the in-memory cache)', async () => {
    await updateGlobalSettings({ scriptNameFixed: 'myscript' });
    expect(getGlobalSettings().scriptNameFixed).toBe('myscript');
  });

  test('a round trip through update then a fresh load reflects the new value', async () => {
    let stored = {};
    global.chrome = {
      storage: {
        local: {
          set: jest.fn(async (values) => { stored = { ...stored, ...values }; }),
          get: jest.fn(async () => stored),
        },
      },
    };

    await updateGlobalSettings({ scriptNameMode: 'hostname' });
    const reloaded = await loadGlobalSettings();
    expect(reloaded.scriptNameMode).toBe('hostname');
  });
});
