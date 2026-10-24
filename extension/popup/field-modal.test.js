const { renderMatchCountHint, populateAttributeSelect } = require('./field-modal');
const { initI18n } = require('../i18n/i18n');

beforeAll(async () => { await initI18n('en'); });

beforeEach(() => {
  document.body.innerHTML = '<p id="hint" class="hidden"></p><select id="attr"></select>';
});

describe('renderMatchCountHint', () => {
  test('is hidden and empty without a count', () => {
    const hint = document.getElementById('hint');
    hint.textContent = 'stale';
    renderMatchCountHint('hint', null);
    expect(hint.textContent).toBe('');
    expect(hint.classList.contains('hidden')).toBe(true);
    renderMatchCountHint('hint', undefined);
    expect(hint.classList.contains('hidden')).toBe(true);
  });

  test('shows the count, and warns on zero matches', () => {
    const hint = document.getElementById('hint');
    renderMatchCountHint('hint', 3);
    expect(hint.classList.contains('hidden')).toBe(false);
    expect(hint.classList.contains('warn')).toBe(false);
    expect(hint.textContent).toContain('3');
    renderMatchCountHint('hint', 0);
    expect(hint.classList.contains('warn')).toBe(true);
  });

  test('a missing element is a no-op', () => {
    expect(() => renderMatchCountHint('nope', 2)).not.toThrow();
  });
});

describe('populateAttributeSelect', () => {
  test('lists the attributes with a value preview and preselects the likeliest URL attribute', () => {
    populateAttributeSelect('attr', { class: 'row', href: '/a/very/long/link/that/is/definitely/longer/than/forty/characters' });
    const options = [...document.querySelectorAll('#attr option')];
    expect(options.map(o => o.value)).toEqual(['class', 'href']);
    expect(options[1].textContent.endsWith('…')).toBe(true);
    expect(document.getElementById('attr').value).toBe('href');
  });

  test('offers a single empty option when the element has no attributes', () => {
    populateAttributeSelect('attr', {});
    const options = [...document.querySelectorAll('#attr option')];
    expect(options).toHaveLength(1);
    expect(options[0].value).toBe('');
  });

  test('escapes names and values', () => {
    populateAttributeSelect('attr', { 'data-x': '<b>"1"</b>' });
    expect(document.querySelector('#attr option').textContent).toBe('data-x: <b>"1"</b>');
  });
});
