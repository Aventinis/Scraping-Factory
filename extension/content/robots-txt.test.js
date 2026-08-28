/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "https://example.com/produkte/schuhe?farbe=rot"}
 */
const { parseRobotsTxt, evaluateRobotsTxt, checkRobotsTxt } = require('./content-script');

describe('parseRobotsTxt', () => {
  test('groups rules under their preceding User-agent line', () => {
    const groups = parseRobotsTxt('User-agent: *\nDisallow: /admin\nAllow: /admin/public');
    expect(groups).toEqual([
      { agents: ['*'], rules: [{ type: 'disallow', pattern: '/admin' }, { type: 'allow', pattern: '/admin/public' }] },
    ]);
  });

  test('several consecutive User-agent lines share one rule set', () => {
    const groups = parseRobotsTxt('User-agent: Googlebot\nUser-agent: Bingbot\nDisallow: /private');
    expect(groups).toEqual([
      { agents: ['googlebot', 'bingbot'], rules: [{ type: 'disallow', pattern: '/private' }] },
    ]);
  });

  test('a User-agent line after a rule line starts a new group', () => {
    const groups = parseRobotsTxt('User-agent: Googlebot\nDisallow: /a\nUser-agent: *\nDisallow: /b');
    expect(groups).toEqual([
      { agents: ['googlebot'], rules: [{ type: 'disallow', pattern: '/a' }] },
      { agents: ['*'], rules: [{ type: 'disallow', pattern: '/b' }] },
    ]);
  });

  test('ignores comments, blank lines and unrelated directives', () => {
    const groups = parseRobotsTxt('# comment\n\nUser-agent: *\nCrawl-delay: 10\nSitemap: https://example.com/sitemap.xml\nDisallow: /x');
    expect(groups).toEqual([{ agents: ['*'], rules: [{ type: 'disallow', pattern: '/x' }] }]);
  });

  test('an empty Disallow value is not recorded as a rule', () => {
    const groups = parseRobotsTxt('User-agent: *\nDisallow:');
    expect(groups).toEqual([{ agents: ['*'], rules: [] }]);
  });

  test('a rule line before any User-agent line is ignored', () => {
    const groups = parseRobotsTxt('Disallow: /orphan\nUser-agent: *\nDisallow: /x');
    expect(groups).toEqual([{ agents: ['*'], rules: [{ type: 'disallow', pattern: '/x' }] }]);
  });
});

describe('evaluateRobotsTxt', () => {
  test('no groups at all → allowed', () => {
    expect(evaluateRobotsTxt('', '/anything')).toEqual({ allowed: true, matchedRule: null });
  });

  test('no matching rule for the path → allowed', () => {
    const result = evaluateRobotsTxt('User-agent: *\nDisallow: /admin', '/produkte/schuhe');
    expect(result).toEqual({ allowed: true, matchedRule: null });
  });

  test('a matching Disallow → not allowed', () => {
    const result = evaluateRobotsTxt('User-agent: *\nDisallow: /admin', '/admin/users');
    expect(result).toEqual({ allowed: false, matchedRule: { type: 'disallow', pattern: '/admin' } });
  });

  test('the longest matching pattern wins over a shorter one', () => {
    const text = 'User-agent: *\nDisallow: /admin\nAllow: /admin/public';
    expect(evaluateRobotsTxt(text, '/admin/public/page')).toEqual({
      allowed: true, matchedRule: { type: 'allow', pattern: '/admin/public' },
    });
    expect(evaluateRobotsTxt(text, '/admin/secret')).toEqual({
      allowed: false, matchedRule: { type: 'disallow', pattern: '/admin' },
    });
  });

  test('a tie in pattern length is decided in favor of Allow', () => {
    const result = evaluateRobotsTxt('User-agent: *\nDisallow: /x\nAllow: /x', '/x');
    expect(result).toEqual({ allowed: true, matchedRule: { type: 'allow', pattern: '/x' } });
  });

  test('"*" wildcard matches any sequence', () => {
    const result = evaluateRobotsTxt('User-agent: *\nDisallow: /produkte/*/ausverkauft', '/produkte/schuhe/ausverkauft');
    expect(result.allowed).toBe(false);
  });

  test('a trailing "$" anchors the pattern to the end of the path', () => {
    const text = 'User-agent: *\nDisallow: /produkte$';
    expect(evaluateRobotsTxt(text, '/produkte').allowed).toBe(false);
    expect(evaluateRobotsTxt(text, '/produkte/schuhe').allowed).toBe(true);
  });

  test('only the catch-all "*" group is considered, not a named-only group', () => {
    const result = evaluateRobotsTxt('User-agent: Googlebot\nDisallow: /admin', '/admin');
    expect(result).toEqual({ allowed: true, matchedRule: null });
  });
});

describe('checkRobotsTxt', () => {
  beforeEach(() => {
    global.chrome = { runtime: { sendMessage: jest.fn() } };
  });

  afterEach(() => {
    delete global.chrome;
    delete global.fetch;
  });

  test('fetches robots.txt from the page origin and evaluates the current path', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, text: () => Promise.resolve('User-agent: *\nDisallow: /produkte'),
    });

    const result = await checkRobotsTxt();

    expect(fetch).toHaveBeenCalledWith('https://example.com/robots.txt', { cache: 'no-store' });
    expect(result).toEqual({
      ok: true,
      robotsUrl: 'https://example.com/robots.txt',
      path: '/produkte/schuhe?farbe=rot',
      notFound: false,
      allowed: false,
      matchedRule: { type: 'disallow', pattern: '/produkte' },
    });
  });

  test('a page allowed by robots.txt', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, text: () => Promise.resolve('User-agent: *\nDisallow: /admin'),
    });

    const result = await checkRobotsTxt();

    expect(result.allowed).toBe(true);
    expect(result.matchedRule).toBeNull();
  });

  test('a missing robots.txt (404) is treated as fully allowed', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 404 });

    const result = await checkRobotsTxt();

    expect(result).toEqual({
      ok: true,
      robotsUrl: 'https://example.com/robots.txt',
      path: '/produkte/schuhe?farbe=rot',
      notFound: true,
      allowed: true,
      matchedRule: null,
    });
  });

  test('a non-404 error status is reported instead of guessing an outcome', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 });

    const result = await checkRobotsTxt();

    expect(result).toEqual({
      ok: false,
      robotsUrl: 'https://example.com/robots.txt',
      path: '/produkte/schuhe?farbe=rot',
      error: 'HTTP 500',
    });
  });

  test('a network failure is reported with its error message', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('Failed to fetch'));

    const result = await checkRobotsTxt();

    expect(result).toEqual({
      ok: false,
      robotsUrl: 'https://example.com/robots.txt',
      path: '/produkte/schuhe?farbe=rot',
      error: 'Failed to fetch',
    });
  });
});

describe('CHECK_ROBOTS_TXT message wiring', () => {
  let capturedListener;

  beforeEach(() => {
    jest.resetModules();
    global.chrome = {
      runtime: {
        onMessage: { addListener: (fn) => { capturedListener = fn; } },
        sendMessage: jest.fn(),
      },
    };
    global.fetch = jest.fn().mockResolvedValue({
      ok: true, status: 200, text: () => Promise.resolve('User-agent: *\nDisallow: /produkte'),
    });
    require('./content-script');
  });

  afterEach(() => {
    delete global.chrome;
    delete global.fetch;
  });

  test('returns true to keep the message channel open for the async response', () => {
    const result = capturedListener({ type: 'CHECK_ROBOTS_TXT' }, {}, jest.fn());
    expect(result).toBe(true);
  });

  test('resolves sendResponse with the check result', async () => {
    const sendResponse = jest.fn();
    capturedListener({ type: 'CHECK_ROBOTS_TXT' }, {}, sendResponse);

    await new Promise(resolve => setTimeout(resolve, 0));

    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ ok: true, allowed: false }));
  });
});
