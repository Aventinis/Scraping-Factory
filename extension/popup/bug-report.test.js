const { formatLogSection, buildGithubIssueUrl } = require('./bug-report');
const { setLastError } = require('./toast');

describe('formatLogSection', () => {
  test('lists entries with timestamp, event and JSON data', () => {
    const entries = [{ ts: '2024-01-01T00:00:00.000Z', event: 'FOO', data: { a: 1 } }];
    const section = formatLogSection('Side Panel', entries);
    expect(section).toContain('## Side Panel');
    expect(section).toContain('2024-01-01T00:00:00.000Z FOO {"a":1}');
  });

  test('omits the data suffix when data is null', () => {
    const entries = [{ ts: 't', event: 'FOO', data: null }];
    expect(formatLogSection('X', entries)).toBe('## X\nt FOO\n');
  });

  test('shows a placeholder for an empty or missing list', () => {
    expect(formatLogSection('Empty', [])).toBe('## Empty\n(no entries)\n');
    expect(formatLogSection('Missing', null)).toBe('## Missing\n(no entries)\n');
  });
});

describe('buildGithubIssueUrl', () => {
  test("points at the repo's new-issue page", () => {
    const url = buildGithubIssueUrl('some report text');
    expect(url.startsWith('https://github.com/Aventinis/Scraping-Factory/issues/new?')).toBe(true);
  });

  test('uses the last reported error as the title when set', () => {
    setLastError('HTTP 500', 'Script generation');
    const url = buildGithubIssueUrl('report');
    expect(url).toContain(`title=${encodeURIComponent('Error: HTTP 500')}`);
  });

  test('embeds the full report body when short', () => {
    const url = buildGithubIssueUrl('a short report');
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('a short report');
    expect(body).not.toContain('truncated');
  });

  test('truncates and adds a note when the report is very long', () => {
    const longReport = 'x'.repeat(10000);
    const url = buildGithubIssueUrl(longReport);
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('truncated');
    expect(body.length).toBeLessThan(longReport.length);
  });

  test('never exceeds GitHub\'s practical URL length limit, even for excerpt-hostile content', () => {
    // Lots of characters that balloon under percent-encoding (quotes/braces/
    // newlines, as real JSON log data would contain) — the raw-character
    // excerpt limit alone doesn't bound the *encoded* URL length.
    const hostileReport = '{"a":"\n"}'.repeat(2000);
    const url = buildGithubIssueUrl(hostileReport);
    expect(url.length).toBeLessThanOrEqual(8000);
    expect(url.startsWith('https://github.com/Aventinis/Scraping-Factory/issues/new')).toBe(true);
  });

  test('drops the log excerpt and points at the manual attachment when still too long', () => {
    const hostileReport = '{"a":"\n"}'.repeat(2000);
    const url = buildGithubIssueUrl(hostileReport);
    const body = decodeURIComponent(url.split('body=')[1]);
    expect(body).toContain('too long to prefill');
    expect(body).not.toContain('<details>');
  });

  test('falls back to a fully blank issue when even the title alone is too long', () => {
    setLastError('E'.repeat(9000), 'Script generation');
    const url = buildGithubIssueUrl('short report');
    expect(url).toBe('https://github.com/Aventinis/Scraping-Factory/issues/new');
  });
});

describe('reportBug end-to-end via the COMPANION_ERROR screen button', () => {
  let capturedListener;

  const flushMicrotasks = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  beforeEach(async () => {
    jest.resetModules();

    document.body.innerHTML = `
      <section id="screen-error" class="hidden">
        <button id="btn-report-bug-error"></button>
      </section>
    `;

    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn().mockResolvedValue({ background: [{ ts: 't', event: 'SW_EVENT', data: null }], content: [], contentError: null }),
        getManifest: jest.fn().mockReturnValue({ version: '0.1.0-test' }),
      },
      tabs: { query: jest.fn(), create: jest.fn() },
      storage: {
        session: {
          get:    jest.fn().mockResolvedValue({}),
          set:    jest.fn().mockResolvedValue(undefined),
          remove: jest.fn().mockResolvedValue(undefined),
        },
      },
    };
    global.fetch = jest.fn().mockRejectedValue(new Error('Companion nicht erreichbar'));
    global.URL.createObjectURL = jest.fn(() => 'blob:mock');
    global.URL.revokeObjectURL = jest.fn();

    require('./popup');
    await flushMicrotasks(); // → STATES.COMPANION_ERROR, lastReportedError set
  });

  test('downloads a bug-report.log and opens a prefilled GitHub issue tab', async () => {
    document.getElementById('btn-report-bug-error').click();
    await flushMicrotasks();

    expect(global.URL.createObjectURL).toHaveBeenCalled();
    expect(chrome.tabs.create).toHaveBeenCalledTimes(1);

    const { url } = chrome.tabs.create.mock.calls[0][0];
    expect(url).toContain('https://github.com/Aventinis/Scraping-Factory/issues/new');
    expect(decodeURIComponent(url)).toContain('Companion nicht erreichbar');
    expect(decodeURIComponent(url)).toContain('SW_EVENT');
  });
});
