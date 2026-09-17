const { renderHardeningNullRateList } = require('./settings-panel-ui');

// A trivial bridge stub — every test below passes nullRate/fieldNames
// explicitly, so renderHardeningNullRateList never actually dereferences
// bridge.getState() to compute its defaults.
function makeBridge() {
  return { getState: () => ({}) };
}

describe('renderHardeningNullRateList (Issue #130)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="hardening-null-rate-list"></div>';
  });

  test('renders one row per entry, with the field select populated from fieldNames', () => {
    renderHardeningNullRateList(
      makeBridge(),
      [{ fieldName: 'Preis', threshold: 30, severity: 'Warning' }],
      ['Titel', 'Preis'],
    );

    const rows = document.querySelectorAll('.hardening-null-rate-row');
    expect(rows).toHaveLength(1);
    const select = rows[0].querySelector('.hardening-null-rate-field');
    const optionValues = [...select.options].map(o => o.value);
    expect(optionValues).toEqual(['', 'Titel', 'Preis']);
    expect(select.value).toBe('Preis');
    expect(rows[0].querySelector('.hardening-null-rate-threshold').value).toBe('30');
    expect(rows[0].querySelector('.btn-null-rate-warning').classList.contains('active')).toBe(true);
    expect(rows[0].querySelector('.btn-null-rate-error').classList.contains('active')).toBe(false);
  });

  test('keeps a stale field name (renamed/removed since the row was added) selectable instead of silently switching it', () => {
    renderHardeningNullRateList(
      makeBridge(),
      [{ fieldName: 'AlterName', threshold: 50, severity: 'Error' }],
      ['Titel', 'Preis'],
    );

    const select = document.querySelector('.hardening-null-rate-field');
    const optionValues = [...select.options].map(o => o.value);
    expect(optionValues).toContain('AlterName');
    expect(select.value).toBe('AlterName');
  });

  test('renders nothing for an empty list', () => {
    renderHardeningNullRateList(
      makeBridge(),[], ['Titel']);
    expect(document.querySelectorAll('.hardening-null-rate-row')).toHaveLength(0);
  });
});

// ── Pagination: pick the "next page" link by clicking it (Issue #174 follow-up) ──
// Same click-based selection flow browser actions' own pick button already
// uses (see the "Engine + browser actions integration" tests above), just
// writing into a single fixed field (pagination.nextLinkSelector) instead of
// a per-index browserActions entry.

describe('Pagination: pick next-link selector', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-idle" class="hidden">
        <label>
          <input type="checkbox" id="toggle-pagination" />
        </label>
        <div id="pagination-config" class="hidden">
          <div class="mode-toggle">
            <div class="mode-toggle-thumb"></div>
            <button id="btn-pagination-next-link" class="mode-btn active" type="button"></button>
            <button id="btn-pagination-page-number" class="mode-btn" type="button"></button>
          </div>
          <div id="pagination-next-link-fields">
            <input type="text" id="input-pagination-next-link-selector" />
            <button id="btn-pick-pagination-next-link" type="button"></button>
          </div>
          <div id="pagination-page-number-fields" class="hidden">
            <input type="text" id="input-pagination-url-template" />
          </div>
          <input type="number" id="input-pagination-max-pages" />
        </div>
        <button id="btn-generate" disabled></button>
      </section>
      <section id="screen-selecting" class="hidden">
        <input type="checkbox" id="toggle-dom-view" />
        <div id="dom-tree-wrapper" class="hidden">
          <p id="dom-tree-loading"></p>
          <p id="dom-tree-error" class="hidden"></p>
          <p id="dom-tree-truncated" class="hidden"></p>
          <ul id="dom-tree-root"></ul>
        </div>
        <button id="btn-cancel-selection"></button>
      </section>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
      tabs: { query: jest.fn((_, cb) => cb([{ url: 'https://example.com' }])) },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockResolvedValue({ ok: true });

    require('./popup');
    await flushMicrotasks(); // → STATES.IDLE
  });

  test('clicking the pick button starts a plain (unscoped) selection round', () => {
    document.getElementById('btn-pick-pagination-next-link').click();

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'START_SELECTION' });
    expect(document.getElementById('screen-selecting').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(true);
  });

  test('the picked selector is written straight into pagination.nextLinkSelector — no modal', async () => {
    document.getElementById('btn-pick-pagination-next-link').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'a.next' });
    await flushMicrotasks();

    expect(document.getElementById('screen-idle').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('input-pagination-next-link-selector').value).toBe('a.next');
  });

  test('picking again overwrites a previously picked selector', async () => {
    document.getElementById('btn-pick-pagination-next-link').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: 'a.next' });
    await flushMicrotasks();

    document.getElementById('btn-pick-pagination-next-link').click();
    capturedListener({ type: 'ELEMENT_SELECTED', selector: '.pagination__next' });
    await flushMicrotasks();

    expect(document.getElementById('input-pagination-next-link-selector').value).toBe('.pagination__next');
  });
});
