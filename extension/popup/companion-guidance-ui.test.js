// Issue #406: the COMPANION_ERROR screen's structured guidance
// (companion-guidance-ui.js), against the real markup in popup.html.
const fs = require('fs');
const path = require('path');

const popupHtml = fs.readFileSync(path.join(__dirname, 'popup.html'), 'utf8');
const errorSection = popupHtml.match(/<section id="screen-error"[\s\S]*?<\/section>/)[0];

function setUserAgent(userAgent) {
  Object.defineProperty(window.navigator, 'userAgent', { value: userAgent, configurable: true });
}

// Loads the UI module fresh with a stubbed companion client (what the last
// health check said) and a chosen "reached" flag.
async function load({ url = 'http://localhost:5000', failure = { message: 'Failed to fetch' }, reached = false, language = 'en' } = {}) {
  jest.resetModules();
  jest.doMock('./companion-client', () => ({
    getResolvedCompanionUrl: () => url,
    getCompanionFailure: () => failure,
  }));
  const { setLanguage, t } = require('../i18n/i18n');
  await setLanguage(language);
  const guidance = require('./companion-guidance');
  if (reached) await guidance.markCompanionReached();
  const { renderCompanionGuidance } = require('./companion-guidance-ui');
  const { initHelpPopovers } = require('./help-popover-ui');
  document.body.innerHTML = errorSection;
  // what popup.js's applyStaticTranslations() does for the static texts
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  initHelpPopovers();
  return { renderCompanionGuidance, initHelpPopovers };
}

const $ = (id) => document.getElementById(id);
const isHidden = (id) => $(id).classList.contains('hidden');
const likelyIds = () => ['install', 'start', 'address'].filter((s) => !$(`error-situation-${s}`).querySelector('.error-likely').classList.contains('hidden'));

afterEach(() => {
  delete global.chrome;
  jest.dontMock('./companion-client');
  setUserAgent('jsdom');
});

describe('first run (no companion has ever answered)', () => {
  test('shows the long explanation: what it is, and the three situations', async () => {
    const { renderCompanionGuidance } = await load();
    renderCompanionGuidance();
    expect(isHidden('error-guidance-long')).toBe(false);
    expect(isHidden('error-hint-short')).toBe(true);
    expect(document.querySelector('.error-intro').textContent).toMatch(/small helper program on your computer/);
    const titles = Array.from(document.querySelectorAll('.error-situation h3')).map((h) => h.firstElementChild.textContent);
    expect(titles).toEqual(['1 · Not installed yet', '2 · Installed, but not running', '3 · Running on another address or port']);
    expect($('error-situation-address').querySelector('p').textContent).toMatch(/http:\/\/localhost:5050/);
  });

  test.each([
    ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'install.ps1', 'powershell -ExecutionPolicy Bypass -File .\\install.ps1 -Autostart', '%APPDATA%\\ScrapingFactory\\app\\companion\\ScrapingFactory.Companion.exe'],
    ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'install.sh', './install.sh --autostart', '~/Library/Application Support/ScrapingFactory/app/companion/ScrapingFactory.Companion'],
    ['Mozilla/5.0 (X11; Linux x86_64)', 'install.sh', './install.sh --autostart', '~/.config/ScrapingFactory/app/companion/ScrapingFactory.Companion'],
  ])('names the installer, command and program path for %s', async (userAgent, installer, command, programPath) => {
    setUserAgent(userAgent);
    const { renderCompanionGuidance } = await load();
    renderCompanionGuidance();
    expect($('error-install-text').textContent).toContain(`(${installer})`);
    expect($('error-install-command').textContent).toBe(command);
    expect($('error-start-path').textContent).toBe(programPath);
  });

  test('marks the likely situations: install + start for the default address, address for a custom one or an HTTP answer', async () => {
    let ui = await load();
    ui.renderCompanionGuidance();
    expect(likelyIds()).toEqual(['install', 'start']);
    expect($('error-situation-install').classList.contains('likely')).toBe(true);
    expect($('error-situation-address').classList.contains('likely')).toBe(false);

    ui = await load({ url: 'http://localhost:5050' });
    ui.renderCompanionGuidance();
    expect(likelyIds()).toEqual(['address']);

    ui = await load({ failure: { message: 'HTTP 404' } });
    ui.renderCompanionGuidance();
    expect(likelyIds()).toEqual(['address']);
  });

  test('re-rendering after the failure changes (e.g. a custom address was entered) moves the mark', async () => {
    const ui = await load();
    ui.renderCompanionGuidance();
    expect(likelyIds()).toEqual(['install', 'start']);
    ui.renderCompanionGuidance();
    expect(likelyIds()).toEqual(['install', 'start']);
  });

  test.each([
    ['de', /kleines Hilfsprogramm auf deinem Rechner/, /Entpacke den Scraping-Factory-Download/],
    ['es', /pequeño programa auxiliar en tu ordenador/, /Descomprime la descarga de Scraping Factory/],
  ])('speaks %s', async (language, intro, install) => {
    const { renderCompanionGuidance } = await load({ language });
    renderCompanionGuidance();
    expect(document.querySelector('.error-intro').textContent).toMatch(intro);
    expect($('error-install-text').textContent).toMatch(install);
  });
});

describe('once a companion has answered', () => {
  test('only the one-line hint is shown', async () => {
    global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue() } } };
    const { renderCompanionGuidance } = await load({ reached: true });
    renderCompanionGuidance();
    expect(isHidden('error-guidance-long')).toBe(true);
    expect(isHidden('error-hint-short')).toBe(false);
  });

  test('switching back to the long form is not possible by accident: the flag survives a reload of the module', async () => {
    const stored = {};
    global.chrome = { storage: { local: {
      get: jest.fn(async () => ({ ...stored })),
      set: jest.fn(async (values) => Object.assign(stored, values)),
    } } };
    await load({ reached: true });
    jest.resetModules();
    const guidance = require('./companion-guidance');
    await guidance.loadCompanionReached();
    expect(guidance.isCompanionReached()).toBe(true);
  });
});

describe('"Why can\'t it connect?" popover', () => {
  test('is a help host with the four usual causes, in both forms', async () => {
    for (const reached of [false, true]) {
      global.chrome = { storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn().mockResolvedValue() } } };
      const { renderCompanionGuidance } = await load({ reached });
      renderCompanionGuidance();
      const host = document.querySelector('.error-why .help-host');
      expect(host.dataset.help).toBe('help.companionError.causes');
      const panel = document.getElementById(host.querySelector('.help-btn').getAttribute('aria-controls'));
      const lines = panel.querySelector('.help-popover-text').textContent.split('\n');
      expect(lines).toHaveLength(4);
      expect(lines[0]).toMatch(/Not started/);
      expect(lines[2]).toMatch(/https:\/\//);
      expect(lines[3]).toMatch(/access key/);
    }
  });
});

test('the custom-address controls stay on the screen, unchanged', () => {
  document.body.innerHTML = errorSection;
  for (const id of ['input-companion-url', 'btn-use-companion-url', 'btn-reset-companion-url', 'btn-retry', 'error-current-url']) {
    expect($(id)).not.toBeNull();
  }
});
