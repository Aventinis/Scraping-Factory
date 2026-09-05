const {
  DEFAULT_COMPANION_URL, getCompanionUrl, setCompanionUrlOverride, resetCompanionUrlOverride, normalizeUrl,
} = require('./companion-config');

describe('normalizeUrl', () => {
  test('trims whitespace and a trailing slash', () => {
    expect(normalizeUrl('  http://localhost:5050/  ')).toBe('http://localhost:5050');
  });

  test('strips multiple trailing slashes', () => {
    expect(normalizeUrl('http://localhost:5050///')).toBe('http://localhost:5050');
  });

  test('leaves a URL without a trailing slash unchanged', () => {
    expect(normalizeUrl('http://localhost:5050')).toBe('http://localhost:5050');
  });

  test('handles empty/missing input', () => {
    expect(normalizeUrl('')).toBe('');
    expect(normalizeUrl(undefined)).toBe('');
  });
});

describe('getCompanionUrl', () => {
  afterEach(() => {
    delete global.chrome;
  });

  test('with no stored override, returns the default', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}) } } };
    expect(await getCompanionUrl()).toBe(DEFAULT_COMPANION_URL);
  });

  test('a stored override takes precedence over the default', async () => {
    global.chrome = {
      storage: { local: { get: jest.fn().mockResolvedValue({ companionUrlOverride: 'http://localhost:5050' }) } },
    };
    expect(await getCompanionUrl()).toBe('http://localhost:5050');
  });

  test('works without chrome.storage at all (falls back to the default)', async () => {
    expect(await getCompanionUrl()).toBe(DEFAULT_COMPANION_URL);
  });

  test('a storage read failure falls back to the default instead of throwing', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockRejectedValue(new Error('boom')) } } };
    expect(await getCompanionUrl()).toBe(DEFAULT_COMPANION_URL);
  });
});

describe('setCompanionUrlOverride / resetCompanionUrlOverride', () => {
  afterEach(() => {
    delete global.chrome;
  });

  test('persists a normalized override', async () => {
    const set = jest.fn().mockResolvedValue(undefined);
    global.chrome = { storage: { local: { set } } };

    const result = await setCompanionUrlOverride('http://localhost:5050/');

    expect(result).toBe('http://localhost:5050');
    expect(set).toHaveBeenCalledWith({ companionUrlOverride: 'http://localhost:5050' });
  });

  test('works without chrome.storage at all (still returns the normalized value)', async () => {
    expect(await setCompanionUrlOverride('http://localhost:5050/')).toBe('http://localhost:5050');
  });

  test('resetCompanionUrlOverride removes the stored key', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    global.chrome = { storage: { local: { remove } } };

    await resetCompanionUrlOverride();

    expect(remove).toHaveBeenCalledWith('companionUrlOverride');
  });

  test('a round trip through set then get reflects the new override', async () => {
    let stored = {};
    global.chrome = {
      storage: {
        local: {
          set: jest.fn(async (values) => { stored = { ...stored, ...values }; }),
          get: jest.fn(async () => stored),
        },
      },
    };

    await setCompanionUrlOverride('http://192.168.1.5:5000');
    expect(await getCompanionUrl()).toBe('http://192.168.1.5:5000');
  });
});
