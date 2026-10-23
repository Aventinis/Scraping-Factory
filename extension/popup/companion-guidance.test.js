// Issue #406: pure logic of the companion-unreachable guidance
// (companion-guidance.js).
const guidance = require('./companion-guidance');

const {
  STORAGE_KEY, detectPlatform, installerName, installCommand, installedProgramPath, likelySituations,
} = guidance;

describe('detectPlatform', () => {
  test.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130', 'windows'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/130', 'mac'],
    ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/130', 'linux'],
    ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36', 'linux'],
    ['', 'linux'],
    [undefined, 'linux'],
    [null, 'linux'],
  ])('%s → %s', (userAgent, expected) => {
    expect(detectPlatform(userAgent)).toBe(expected);
  });
});

describe('per-platform instructions', () => {
  test('the installer and its command', () => {
    expect(installerName('windows')).toBe('install.ps1');
    expect(installerName('mac')).toBe('install.sh');
    expect(installerName('linux')).toBe('install.sh');
    expect(installCommand('windows')).toBe('powershell -ExecutionPolicy Bypass -File .\\install.ps1 -Autostart');
    expect(installCommand('linux')).toBe('./install.sh --autostart');
    expect(installCommand('mac')).toBe('./install.sh --autostart');
  });

  test("where the installers put the companion program (as install.sh / install.ps1 do)", () => {
    expect(installedProgramPath('linux')).toBe('~/.config/ScrapingFactory/app/companion/ScrapingFactory.Companion');
    expect(installedProgramPath('mac')).toBe('~/Library/Application Support/ScrapingFactory/app/companion/ScrapingFactory.Companion');
    expect(installedProgramPath('windows')).toBe('%APPDATA%\\ScrapingFactory\\app\\companion\\ScrapingFactory.Companion.exe');
  });
});

describe('likelySituations', () => {
  const defaultUrl = 'http://localhost:5000';

  test('the default address that does not answer at all: not installed / not running', () => {
    expect(likelySituations({ url: defaultUrl, defaultUrl, errorMessage: 'Failed to fetch' })).toEqual(['install', 'start']);
    expect(likelySituations({ url: null, defaultUrl, errorMessage: null })).toEqual(['install', 'start']);
  });

  test('a custom address points at the address first', () => {
    expect(likelySituations({ url: 'http://localhost:5050', defaultUrl, errorMessage: 'Failed to fetch' })).toEqual(['address']);
  });

  test('something answering with an HTTP error is not a healthy companion — wrong port or program', () => {
    expect(likelySituations({ url: defaultUrl, defaultUrl, errorMessage: 'HTTP 404' })).toEqual(['address']);
    expect(likelySituations({ url: defaultUrl, defaultUrl, errorMessage: 'HTTP 503' })).toEqual(['address']);
  });
});

describe('the "a companion has answered" flag', () => {
  afterEach(() => { delete global.chrome; jest.resetModules(); });

  test('starts false, is loaded from chrome.storage.local, and is only ever written once', async () => {
    jest.resetModules();
    const fresh = require('./companion-guidance');
    const set = jest.fn().mockResolvedValue();
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set } } };
    expect(fresh.isCompanionReached()).toBe(false);
    expect(await fresh.loadCompanionReached()).toBe(false);

    await fresh.markCompanionReached();
    await fresh.markCompanionReached();
    expect(fresh.isCompanionReached()).toBe(true);
    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith({ [STORAGE_KEY]: true });
  });

  test('a stored true is restored', async () => {
    jest.resetModules();
    const fresh = require('./companion-guidance');
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({ [STORAGE_KEY]: true }) } } };
    expect(await fresh.loadCompanionReached()).toBe(true);
    expect(fresh.isCompanionReached()).toBe(true);
  });

  test('unusable storage degrades to "not reached" without throwing', async () => {
    jest.resetModules();
    const fresh = require('./companion-guidance');
    expect(await fresh.loadCompanionReached()).toBe(false); // no chrome at all
    global.chrome = { storage: { local: { get: jest.fn().mockRejectedValue(new Error('blocked')), set: jest.fn().mockRejectedValue(new Error('quota')) } } };
    expect(await fresh.loadCompanionReached()).toBe(false);
    await expect(fresh.markCompanionReached()).resolves.toBeUndefined();
  });
});
