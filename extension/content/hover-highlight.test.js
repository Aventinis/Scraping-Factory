// Issue #233: the content-script side of the single-row hover highlight —
// matchHoverHighlight's selector-chain resolution (mirroring matchGroupTree's
// semantics) and the HOVER_HIGHLIGHT/HOVER_HIGHLIGHT_CLEAR message handling.
const MENU_HTML = `
  <section class="category">
    <h2>Vorspeisen</h2>
    <div class="dish"><h3>Suppe</h3><span class="price">4,50</span></div>
    <div class="dish"><h3>Salat</h3></div>
  </section>
  <section class="category">
    <h2>Hauptgerichte</h2>
    <div class="dish"><h3>Schnitzel</h3><span class="price">12,90</span></div>
  </section>
  <iframe id="embedded"></iframe>
`;

describe('matchHoverHighlight', () => {
  let matchHoverHighlight;

  beforeEach(() => {
    jest.resetModules();
    delete global.chrome;
    ({ matchHoverHighlight } = require('./content-script'));
    document.body.innerHTML = MENU_HTML;
  });

  const texts = ({ elements }) => elements.map(e => e.querySelector('h3, h2')?.textContent ?? e.textContent);

  test('a flat field (all: true) matches every element page-wide', () => {
    const result = matchHoverHighlight([{ selector: '.dish h3', all: true }], null);
    expect(result.inIframe).toBe(false);
    expect(result.elements.map(e => e.textContent)).toEqual(['Suppe', 'Salat', 'Schnitzel']);
  });

  test('a repeating group matches every instance', () => {
    expect(texts(matchHoverHighlight([{ selector: '.category', all: true }], null))).toEqual(['Vorspeisen', 'Hauptgerichte']);
  });

  test('a non-repeating group matches only the first instance', () => {
    expect(texts(matchHoverHighlight([{ selector: '.category', all: false }], null))).toEqual(['Vorspeisen']);
  });

  test('a nested field is matched once per enclosing repeating instance, and skipped where absent', () => {
    const result = matchHoverHighlight([
      { selector: '.category', all: true },
      { selector: '.dish', all: true },
      { selector: '.price', all: false },
    ], null);
    expect(result.elements.map(e => e.textContent)).toEqual(['4,50', '12,90']);
  });

  test('a field under a non-repeating ancestor is scoped to that first instance only', () => {
    const result = matchHoverHighlight([
      { selector: '.category', all: false },
      { selector: 'h2', all: false },
    ], null);
    expect(result.elements.map(e => e.textContent)).toEqual(['Vorspeisen']);
  });

  test('a selector matching nothing yields no elements', () => {
    expect(matchHoverHighlight([{ selector: '.category', all: true }, { selector: '.nope', all: false }], null).elements).toEqual([]);
  });

  test('an invalid selector yields no elements instead of throwing', () => {
    expect(matchHoverHighlight([{ selector: 'div[', all: true }], null).elements).toEqual([]);
  });

  test('a framePath highlights the outermost iframe instead', () => {
    const result = matchHoverHighlight([{ selector: '.inside-frame', all: true }], ['#embedded', '#inner']);
    expect(result.inIframe).toBe(true);
    expect(result.elements.map(e => e.id)).toEqual(['embedded']);
  });

  test('empty steps yield no elements', () => {
    expect(matchHoverHighlight([], null).elements).toEqual([]);
  });
});

describe('HOVER_HIGHLIGHT message handling', () => {
  let capturedListener;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = MENU_HTML;
    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
    };
    require('./content-script');
  });

  afterEach(() => {
    capturedListener({ type: 'HOVER_HIGHLIGHT_CLEAR' });
    capturedListener({ type: 'PREVIEW_STOP' });
    delete global.chrome;
  });

  const boxes = () => Array.from(document.querySelectorAll('.sf-preview-box'));
  const greenBoxes = () => boxes().filter(b => b.style.border.includes('rgb(22, 163, 74)') || b.style.border.includes('#16a34a'));

  test('draws one green, labelled box per match, with a count when there are several', () => {
    capturedListener({ type: 'HOVER_HIGHLIGHT', name: 'Gericht', steps: [{ selector: '.dish', all: true }], framePath: null });
    expect(greenBoxes()).toHaveLength(3);
    expect(greenBoxes()[0].textContent).toBe('Gericht ×3');
  });

  test('a single match is labelled with just the name', () => {
    capturedListener({ type: 'HOVER_HIGHLIGHT', name: 'Kategorie', steps: [{ selector: '.category', all: false }], framePath: null });
    expect(greenBoxes().map(b => b.textContent)).toEqual(['Kategorie']);
  });

  test('an iframe field is labelled as such', () => {
    capturedListener({ type: 'HOVER_HIGHLIGHT', name: 'Preis', steps: [{ selector: '.price', all: true }], framePath: ['#embedded'] });
    expect(greenBoxes().map(b => b.textContent)).toEqual(['Preis (iframe)']);
  });

  test('the next hovered row replaces the previous highlight, CLEAR removes it', () => {
    capturedListener({ type: 'HOVER_HIGHLIGHT', name: 'Gericht', steps: [{ selector: '.dish', all: true }], framePath: null });
    capturedListener({ type: 'HOVER_HIGHLIGHT', name: 'Kategorie', steps: [{ selector: '.category', all: true }], framePath: null });
    expect(greenBoxes().map(b => b.textContent)).toEqual(['Kategorie ×2', 'Kategorie ×2']);

    capturedListener({ type: 'HOVER_HIGHLIGHT_CLEAR' });
    expect(greenBoxes()).toHaveLength(0);
  });

  test('coexists with the full preview: clearing the hover keeps the blue preview boxes, and vice versa', () => {
    capturedListener({ type: 'PREVIEW_START', mode: 'flat', fields: [{ name: 'Name', selector: '.dish h3' }] });
    capturedListener({ type: 'HOVER_HIGHLIGHT', name: 'Gericht', steps: [{ selector: '.dish', all: true }], framePath: null });
    expect(boxes()).toHaveLength(6);

    capturedListener({ type: 'HOVER_HIGHLIGHT_CLEAR' });
    expect(boxes()).toHaveLength(3);
    expect(greenBoxes()).toHaveLength(0);

    capturedListener({ type: 'HOVER_HIGHLIGHT', name: 'Gericht', steps: [{ selector: '.dish', all: true }], framePath: null });
    capturedListener({ type: 'PREVIEW_STOP' });
    expect(boxes()).toHaveLength(3);
    expect(greenBoxes()).toHaveLength(3);
  });
});
