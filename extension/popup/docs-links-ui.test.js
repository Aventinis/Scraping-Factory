// Issue #354 Part B: "Learn more" links open the bundled documentation.
Object.defineProperty(window.navigator, 'language', { value: 'en-US', configurable: true });

async function load() {
  jest.resetModules();
  global.chrome = {
    storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn() } },
    runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
    tabs: { create: jest.fn() },
  };
  const i18n = require('../i18n/i18n');
  await i18n.setLanguage('en');
  return { i18n, ui: require('./docs-links-ui'), help: require('./help-popover-ui') };
}

afterEach(() => { delete global.chrome; document.body.innerHTML = ''; });

test('initDocsLinks gives a link its bundled address and opens it in a new tab', async () => {
  const { ui } = await load();
  document.body.innerHTML = '<a class="learn-more" data-doc="safetyChecks" href="#">Learn more</a>';
  ui.initDocsLinks();
  const a = document.querySelector('a');
  expect(a.getAttribute('href')).toBe('chrome-extension://abc/docs/monitoring.html#safety-checks');
  expect(a.getAttribute('target')).toBe('_blank');
  expect(a.getAttribute('rel')).toBe('noopener');
});

test('a click opens the page through chrome.tabs.create and does not navigate the panel', async () => {
  const { ui } = await load();
  ui.wireDocsLinkEvents();
  document.body.innerHTML = '<p><a class="learn-more" data-doc="pause" href="#"><span>Learn more</span></a></p>';
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  document.querySelector('span').dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://abc/docs/network-settings.html#pause-between-requests' });
});

test('an unknown key opens nothing', async () => {
  const { ui } = await load();
  ui.wireDocsLinkEvents();
  document.body.innerHTML = '<a class="learn-more" data-doc="nope" href="#">x</a>';
  document.querySelector('a').click();
  expect(chrome.tabs.create).not.toHaveBeenCalled();
});

test('learnMoreHtml builds a translated link for DOM built in JS', async () => {
  const { ui } = await load();
  document.body.innerHTML = ui.learnMoreHtml('dedup');
  expect(document.querySelector('a.learn-more').textContent).toBe('Learn more');
  expect(document.querySelector('a.learn-more').dataset.doc).toBe('dedup');
});

describe('German panel', () => {
  const anchorsJson = { de: { monitoring: { 'safety-checks': 'sicherheitspruefungen' } } };

  async function loadGerman() {
    jest.resetModules();
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => anchorsJson });
    global.chrome = {
      storage: { local: { get: jest.fn().mockResolvedValue({}), set: jest.fn() } },
      runtime: { getURL: (p) => `chrome-extension://abc/${p}` },
      tabs: { create: jest.fn() },
    };
    const i18n = require('../i18n/i18n');
    await i18n.setLanguage('de');
    return { ui: require('./docs-links-ui') };
  }

  afterEach(() => { delete global.fetch; });

  test('a click opens the German page at the German heading', async () => {
    const { ui } = await loadGerman();
    ui.wireDocsLinkEvents();
    document.body.innerHTML = '<a class="learn-more" data-doc="safetyChecks" href="#">Mehr erfahren</a>';
    document.querySelector('a').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(global.fetch).toHaveBeenCalledWith('chrome-extension://abc/docs/anchors.json');
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://abc/docs/de/monitoring.html#sicherheitspruefungen' });
  });

  test('initDocsLinks points the link at the German page once the table has loaded', async () => {
    const { ui } = await loadGerman();
    document.body.innerHTML = '<a class="learn-more" data-doc="safetyChecks" href="#">x</a>';
    ui.initDocsLinks();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(document.querySelector('a').getAttribute('href')).toBe('chrome-extension://abc/docs/de/monitoring.html#sicherheitspruefungen');
  });

  test('without the table (a failed fetch) the English page opens', async () => {
    const { ui } = await loadGerman();
    global.fetch = jest.fn().mockRejectedValue(new Error('offline'));
    jest.resetModules();
    const i18n = require('../i18n/i18n');
    await i18n.setLanguage('de');
    const fresh = require('./docs-links-ui');
    fresh.wireDocsLinkEvents();
    document.body.innerHTML = '<a class="learn-more" data-doc="safetyChecks" href="#">x</a>';
    document.querySelector('a').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(chrome.tabs.create).toHaveBeenCalledWith({ url: 'chrome-extension://abc/docs/monitoring.html#safety-checks' });
    expect(ui).toBeDefined();
  });
});

describe('help popover', () => {
  test('a host with data-doc gets a "Learn more" link in its panel, one without does not', async () => {
    const { help } = await load();
    document.body.innerHTML = `
      <label><span class="help-host" id="a" data-help="help.hardening.recommended" data-doc="safetyChecks"></span></label>
      <label><span class="help-host" id="b" data-help="help.hardening.noResult"></span></label>`;
    help.initHelpPopovers();
    const panelA = document.getElementById('a').closest('label').nextElementSibling;
    const panelB = document.getElementById('b').closest('label').nextElementSibling;
    expect(panelA.querySelector('a.learn-more').dataset.doc).toBe('safetyChecks');
    expect(panelA.querySelector('a.learn-more').textContent).toBe('Learn more');
    expect(panelB.querySelector('a.learn-more')).toBeNull();
  });
});
