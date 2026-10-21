// Issue #352: which companion addresses the extension talks to, and that the
// development-only escape hatch (plain http:// to another machine) cannot be
// switched on in a release build — not through the stored flag, not through
// the setter.
function loadConfig(channel, storedFlag) {
  jest.resetModules();
  jest.doMock('./build-config', () => ({
    CHANNEL: channel,
    isDevelopmentBuild: () => channel === 'development',
  }));
  const stored = storedFlag === undefined ? {} : { devAllowInsecureHttp: storedFlag };
  global.chrome = {
    storage: {
      local: {
        get: jest.fn(async () => stored),
        set: jest.fn(async (values) => Object.assign(stored, values)),
      },
    },
  };
  return { config: require('./companion-config'), stored };
}

afterEach(() => {
  delete global.chrome;
  jest.dontMock('./build-config');
  jest.resetModules();
});

describe.each(['development', 'release'])('checkCompanionUrl (%s build)', (channel) => {
  test.each([
    'https://companion.example.com',
    'https://192.168.1.5:5000/',
    'http://localhost:5000',
    'http://127.0.0.1:5000',
    'http://127.5.6.7:5000',
    'http://[::1]:5000',
  ])('accepts %s', (url) => {
    expect(loadConfig(channel).config.checkCompanionUrl(url).ok).toBe(true);
  });

  test.each(['', 'not a url', 'ftp://localhost', 'javascript:alert(1)'])('rejects %j as invalid', (url) => {
    expect(loadConfig(channel).config.checkCompanionUrl(url)).toEqual({ ok: false, reason: 'invalid' });
  });

  test.each([
    'http://192.168.1.5:5000',
    'http://companion.example.com',
    'http://localhost.evil.example',
    'http://127.0.0.1.evil.example',
  ])('refuses %s while the developer option is off', (url) => {
    expect(loadConfig(channel).config.checkCompanionUrl(url)).toEqual({ ok: false, reason: 'insecure' });
  });

  test('normalizes the accepted URL (trailing slash)', () => {
    expect(loadConfig(channel).config.checkCompanionUrl(' https://a.example/ ')).toEqual({ ok: true, url: 'https://a.example' });
  });
});

describe('developer option', () => {
  test('development build: switching it on allows plain http to another machine, and it persists', async () => {
    const { config, stored } = loadConfig('development');
    await config.setInsecureHttpAllowed(true);
    expect(stored.devAllowInsecureHttp).toBe(true);
    expect(config.checkCompanionUrl('http://192.168.1.5:5000').ok).toBe(true);

    const reloaded = loadConfig('development', true).config;
    await reloaded.loadDeveloperOptions();
    expect(reloaded.isInsecureHttpAllowed()).toBe(true);
  });

  test('release build: the setter does nothing and a stored flag is ignored', async () => {
    const { config, stored } = loadConfig('release');
    await config.setInsecureHttpAllowed(true);
    expect(config.isInsecureHttpAllowed()).toBe(false);
    expect(stored.devAllowInsecureHttp).toBeUndefined();
    expect(config.checkCompanionUrl('http://192.168.1.5:5000')).toEqual({ ok: false, reason: 'insecure' });

    const withStoredFlag = loadConfig('release', true).config;
    await withStoredFlag.loadDeveloperOptions();
    expect(withStoredFlag.isInsecureHttpAllowed()).toBe(false);
    expect(withStoredFlag.checkCompanionUrl('http://192.168.1.5:5000').ok).toBe(false);
  });
});

describe('getCompanionUrl with a stored address the policy no longer allows', () => {
  test('falls back to the default (release build with a leftover plain-http override)', async () => {
    const { config, stored } = loadConfig('release');
    stored.companionUrlOverride = 'http://192.168.1.5:5000';
    expect(await config.getCompanionUrl()).toBe(config.DEFAULT_COMPANION_URL);
  });

  test('uses it in a development build once the option is on', async () => {
    const { config, stored } = loadConfig('development', true);
    stored.companionUrlOverride = 'http://192.168.1.5:5000/';
    await config.loadDeveloperOptions();
    expect(await config.getCompanionUrl()).toBe('http://192.168.1.5:5000');
  });
});

describe('build-config.js', () => {
  test('the repository itself is the development channel (the release bundle rewrites it)', () => {
    jest.resetModules();
    jest.dontMock('./build-config');
    const buildConfig = require('./build-config');
    expect(buildConfig.CHANNEL).toBe('development');
    expect(buildConfig.isDevelopmentBuild()).toBe(true);
  });

  test("keeps the exact line install/build-bundle.sh rewrites to 'release'", () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, 'build-config.js'), 'utf8');
    expect(source).toContain("const CHANNEL = 'development';");
  });
});
