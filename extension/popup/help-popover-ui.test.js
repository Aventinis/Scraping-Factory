// Issue #396: the help popover's DOM behavior (help-popover-ui.js).
const { setLanguage } = require('../i18n/i18n');
const { initHelpPopovers, wireHelpPopoverEvents } = require('./help-popover-ui');

const KEY = 'help.requestHeaders.headers';

function mount() {
  document.body.innerHTML = `
    <label class="output-settings-toggle" id="row-a">
      <input type="checkbox" id="cb-a" />
      <span>Option A</span>
      <span class="help-host" data-help="${KEY}"></span>
    </label>
    <div id="row-b"><span>Option B</span><span class="help-host" data-help="help.appendOutput.append"></span></div>
    <button id="outside">Outside</button>`;
  initHelpPopovers();
}

const buttons = () => Array.from(document.querySelectorAll('.help-btn'));
const panelOf = (button) => document.getElementById(button.getAttribute('aria-controls'));
const isOpen = (button) => button.getAttribute('aria-expanded') === 'true' && !panelOf(button).classList.contains('hidden');

beforeAll(async () => {
  await setLanguage('en');
  wireHelpPopoverEvents();
  wireHelpPopoverEvents(); // idempotent: a second call must not double every handler
});

beforeEach(mount);

describe('rendering', () => {
  test('every host gets a "?" button and a hidden panel after its row', () => {
    expect(buttons()).toHaveLength(2);
    const [first] = buttons();
    expect(first.textContent).toBe('?');
    expect(first.getAttribute('aria-expanded')).toBe('false');
    const panel = panelOf(first);
    expect(panel.classList.contains('hidden')).toBe(true);
    // the panel follows the host's <label>, not the host inside it
    expect(document.getElementById('row-a').nextElementSibling).toBe(panel);
    expect(first.getAttribute('aria-describedby')).toBe(panel.id);
    expect(panel.getAttribute('role')).toBe('note');
  });

  test('shows the text and the example in the current language', () => {
    const panel = panelOf(buttons()[0]);
    expect(panel.querySelector('.help-popover-text').textContent).toMatch(/Extra headers/);
    const example = panel.querySelector('.help-popover-example');
    expect(example.textContent).toBe('Accept-Language: de-CH');
    expect(example.classList.contains('hidden')).toBe(false);
    expect(buttons()[0].getAttribute('aria-label')).toBe('Help');
  });

  test('is idempotent: re-running adds neither buttons nor panels', () => {
    initHelpPopovers();
    initHelpPopovers();
    expect(buttons()).toHaveLength(2);
    expect(document.querySelectorAll('.help-popover')).toHaveLength(2);
  });

  test('a language change re-translates, and an open panel stays open', async () => {
    const [first] = buttons();
    first.click();
    await setLanguage('de');
    initHelpPopovers();
    expect(isOpen(first)).toBe(true);
    expect(panelOf(first).querySelector('.help-popover-text').textContent).toMatch(/Zusätzliche Header/);
    expect(first.getAttribute('aria-label')).toBe('Hilfe');
    await setLanguage('en');
  });

  test('a host without an example hides the example block; an unknown key falls back to the key', () => {
    document.body.innerHTML = '<div><span class="help-host" data-help="help.nothing.here"></span></div>';
    initHelpPopovers();
    const panel = panelOf(buttons()[0]);
    expect(panel.querySelector('.help-popover-text').textContent).toBe('help.nothing.here');
    expect(panel.querySelector('.help-popover-example').classList.contains('hidden')).toBe(true);
  });

  test('an invalid key is ignored', () => {
    document.body.innerHTML = '<div><span class="help-host" data-help="oops"></span></div>';
    initHelpPopovers();
    expect(buttons()).toHaveLength(0);
  });
});

describe('interaction', () => {
  test('click opens, a second click closes', () => {
    const [first] = buttons();
    first.click();
    expect(isOpen(first)).toBe(true);
    first.click();
    expect(isOpen(first)).toBe(false);
  });

  test('only one popover is open at a time', () => {
    const [first, second] = buttons();
    first.click();
    second.click();
    expect(isOpen(first)).toBe(false);
    expect(isOpen(second)).toBe(true);
  });

  test('Escape closes the open popover and returns focus to its button', () => {
    const [first] = buttons();
    first.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(isOpen(first)).toBe(false);
    expect(document.activeElement).toBe(first);
  });

  test('other keys do nothing', () => {
    const [first] = buttons();
    first.click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    expect(isOpen(first)).toBe(true);
  });

  test('a click elsewhere closes it, a click inside the panel does not', () => {
    const [first] = buttons();
    first.click();
    panelOf(first).querySelector('.help-popover-text').click();
    expect(isOpen(first)).toBe(true);
    document.getElementById('outside').click();
    expect(isOpen(first)).toBe(false);
  });

  test('a button inside a checkbox label does not toggle the checkbox', () => {
    const checkbox = document.getElementById('cb-a');
    expect(checkbox.checked).toBe(false);
    buttons()[0].click();
    expect(checkbox.checked).toBe(false);
  });
});
