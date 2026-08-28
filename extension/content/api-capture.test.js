// api-capture.js is injected in the MAIN world in the real extension, but
// its buffering/truncation logic (buildEntry, truncateBody, recordEntry,
// startRecording/stopRecording) is plain JS with no chrome/DOM dependency —
// exported for testing the same way content-script.js exports its pure
// functions. The actual fetch/XHR monkey-patching is skipped under Jest
// (guarded by `typeof module === 'undefined'`, see the file) so these tests
// exercise the buffer/cap behavior directly instead.

let capture;

beforeEach(() => {
  jest.resetModules();
  sessionStorage.clear();
  capture = require('./api-capture');
});

describe('truncateBody', () => {
  test('returns the text unchanged when under the cap', () => {
    expect(capture.truncateBody('hello')).toEqual({ body: 'hello', truncated: false });
  });

  test('truncates text over MAX_BODY_CHARS and flags it', () => {
    const text = 'x'.repeat(capture.MAX_BODY_CHARS + 10);
    const { body, truncated } = capture.truncateBody(text);
    expect(body).toHaveLength(capture.MAX_BODY_CHARS);
    expect(truncated).toBe(true);
  });

  test('treats a missing/non-string body as an empty, non-truncated string', () => {
    expect(capture.truncateBody(undefined)).toEqual({ body: '', truncated: false });
  });
});

describe('shouldSkipBody', () => {
  test('skips known binary content types', () => {
    expect(capture.shouldSkipBody('image/png', null)).toBe(true);
    expect(capture.shouldSkipBody('video/mp4', null)).toBe(true);
    expect(capture.shouldSkipBody('font/woff2', null)).toBe(true);
  });

  test('does not skip JSON or other text-ish content types', () => {
    expect(capture.shouldSkipBody('application/json', null)).toBe(false);
    expect(capture.shouldSkipBody('text/html', null)).toBe(false);
    expect(capture.shouldSkipBody(null, null)).toBe(false);
  });

  test('skips when content-length exceeds the read cutoff, regardless of content type', () => {
    const tooLarge = String(capture.MAX_BODY_BYTES_TO_READ + 1);
    expect(capture.shouldSkipBody('application/json', tooLarge)).toBe(true);
  });

  test('does not skip when content-length is under the cutoff or missing', () => {
    expect(capture.shouldSkipBody('application/json', '10')).toBe(false);
    expect(capture.shouldSkipBody('application/json', undefined)).toBe(false);
    expect(capture.shouldSkipBody('application/json', 'not-a-number')).toBe(false);
  });
});

describe('resolveUrl (Issue #53 Phase 5)', () => {
  test('leaves an already-absolute URL unchanged', () => {
    expect(capture.resolveUrl('https://example.com/api/items')).toBe('https://example.com/api/items');
  });

  test('resolves a relative URL against the page location (jsdom default: http://localhost/)', () => {
    expect(capture.resolveUrl('/api/items')).toBe('http://localhost/api/items');
  });

  test('falls back to the raw string for a genuinely unparseable value instead of throwing', () => {
    expect(capture.resolveUrl('http://')).toBe('http://');
  });
});

describe('normalizeHeaders (Issue #53 Phase 5)', () => {
  test('normalizes a plain {name: value} object', () => {
    expect(capture.normalizeHeaders({ 'Content-Type': 'application/json', 'X-Api-Key': 'abc' })).toEqual([
      { name: 'Content-Type', value: 'application/json' },
      { name: 'X-Api-Key', value: 'abc' },
    ]);
  });

  test('normalizes a Headers-like instance via .entries()', () => {
    const headersLike = { entries: () => [['accept', 'application/json']][Symbol.iterator]() };
    expect(capture.normalizeHeaders(headersLike)).toEqual([{ name: 'accept', value: 'application/json' }]);
  });

  test('normalizes an array of [name, value] pairs (not mistaken for a Headers-like object)', () => {
    expect(capture.normalizeHeaders([['x-a', '1'], ['x-b', '2']])).toEqual([
      { name: 'x-a', value: '1' },
      { name: 'x-b', value: '2' },
    ]);
  });

  test('returns an empty array for null/undefined', () => {
    expect(capture.normalizeHeaders(null)).toEqual([]);
    expect(capture.normalizeHeaders(undefined)).toEqual([]);
  });

  test('caps the number of headers at MAX_REQUEST_HEADERS', () => {
    const many = Object.fromEntries(Array.from({ length: capture.MAX_REQUEST_HEADERS + 10 }, (_, i) => [`h${i}`, 'v']));
    expect(capture.normalizeHeaders(many)).toHaveLength(capture.MAX_REQUEST_HEADERS);
  });

  test('truncates an over-long header value at MAX_HEADER_VALUE_CHARS', () => {
    const longValue = 'x'.repeat(capture.MAX_HEADER_VALUE_CHARS + 10);
    const [header] = capture.normalizeHeaders({ 'x-long': longValue });
    expect(header.value).toHaveLength(capture.MAX_HEADER_VALUE_CHARS);
  });
});

describe('buildEntry', () => {
  test('builds an entry with an incrementing id and uppercased method', () => {
    const first = capture.buildEntry('https://example.com/a', 'get', 200, 'application/json', '{}');
    const second = capture.buildEntry('https://example.com/b', 'post', 201, 'application/json', '{}');

    expect(first.method).toBe('GET');
    expect(second.id).toBe(first.id + 1);
  });

  test('carries the given requestHeaders through, defaulting to an empty array', () => {
    const withHeaders = capture.buildEntry('https://example.com/a', 'GET', 200, 'application/json', '{}', false, [{ name: 'x-a', value: '1' }]);
    expect(withHeaders.requestHeaders).toEqual([{ name: 'x-a', value: '1' }]);

    const withoutHeaders = capture.buildEntry('https://example.com/a', 'GET', 200, 'application/json', '{}');
    expect(withoutHeaders.requestHeaders).toEqual([]);
  });

  test('defaults method to GET when none is given', () => {
    const entry = capture.buildEntry('https://example.com/a', undefined, 200, null, '');
    expect(entry.method).toBe('GET');
  });

  test('carries the truncation flag through from truncateBody', () => {
    const longBody = 'x'.repeat(capture.MAX_BODY_CHARS + 1);
    const entry = capture.buildEntry('https://example.com/a', 'GET', 200, 'application/json', longBody);
    expect(entry.bodyTruncated).toBe(true);
    expect(entry.body).toHaveLength(capture.MAX_BODY_CHARS);
  });

  test('marks a skipped body without truncating and without keeping the passed-in text', () => {
    const entry = capture.buildEntry('https://example.com/a', 'GET', 200, 'image/png', 'ignored', true);
    expect(entry.bodySkipped).toBe(true);
    expect(entry.bodyTruncated).toBe(false);
    expect(entry.body).toBe('');
  });

  test('defaults bodySkipped to false when not given', () => {
    const entry = capture.buildEntry('https://example.com/a', 'GET', 200, 'application/json', '{}');
    expect(entry.bodySkipped).toBe(false);
  });
});

describe('recordEntry (buffering + cap)', () => {
  let postMessageSpy;

  beforeEach(() => {
    postMessageSpy = jest.spyOn(window, 'postMessage').mockImplementation(() => {});
  });

  afterEach(() => {
    postMessageSpy.mockRestore();
  });

  test('does nothing while not recording', () => {
    capture.recordEntry('https://example.com/a', 'GET', 200, 'application/json', '{}');
    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  test('posts an API_CAPTURE_ENTRY message once recording is active', () => {
    capture.startRecording();
    capture.recordEntry('https://example.com/a', 'GET', 200, 'application/json', '{"x":1}');

    expect(postMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        source: 'sf-api-capture',
        type: 'API_CAPTURE_ENTRY',
        entry: expect.objectContaining({ url: 'https://example.com/a', method: 'GET', status: 200 }),
      }),
      '*',
    );
  });

  test('stopRecording suppresses further captures', () => {
    capture.startRecording();
    capture.stopRecording();

    capture.recordEntry('https://example.com/a', 'GET', 200, 'application/json', '{}');

    expect(postMessageSpy).not.toHaveBeenCalled();
  });

  test('startRecording resets the buffer so a previous cap does not carry over', () => {
    capture.startRecording();
    for (let i = 0; i < capture.MAX_CAPTURED_ENTRIES; i++) {
      capture.recordEntry(`https://example.com/${i}`, 'GET', 200, 'application/json', '{}');
    }
    postMessageSpy.mockClear();

    // Buffer is at cap — one more entry should be dropped silently.
    capture.recordEntry('https://example.com/over-cap', 'GET', 200, 'application/json', '{}');
    expect(postMessageSpy).not.toHaveBeenCalled();

    // A fresh recording resets the buffer, so capturing works again.
    capture.startRecording();
    capture.recordEntry('https://example.com/fresh', 'GET', 200, 'application/json', '{}');
    expect(postMessageSpy).toHaveBeenCalledTimes(1);
  });
});

describe('recording resume flag (survives same-origin navigation)', () => {
  test('shouldResumeRecording is false before any recording started', () => {
    expect(capture.shouldResumeRecording()).toBe(false);
  });

  test('startRecording persists the resume flag, stopRecording clears it', () => {
    capture.startRecording();
    expect(capture.shouldResumeRecording()).toBe(true);

    capture.stopRecording();
    expect(capture.shouldResumeRecording()).toBe(false);
  });

  test('a fresh module instance picks up a resume flag left by a previous one', () => {
    capture.startRecording();

    jest.resetModules();
    const freshCapture = require('./api-capture');
    expect(freshCapture.shouldResumeRecording()).toBe(true);
  });
});
