const { createLogger, getLogBuffer, clearLogBuffer } = require('./logger');

beforeEach(() => {
  clearLogBuffer();
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  console.log.mockRestore();
});

test('createLogger returns a function that appends to the shared buffer', () => {
  const log = createLogger('SF:Test');
  log('SOME_EVENT', { a: 1 });

  const buffer = getLogBuffer();
  expect(buffer).toHaveLength(1);
  expect(buffer[0]).toMatchObject({ event: 'SOME_EVENT', data: { a: 1 } });
  expect(buffer[0].ts).toEqual(expect.any(String));
});

test('data defaults to null when omitted', () => {
  const log = createLogger('SF:Test');
  log('NO_DATA_EVENT');

  expect(getLogBuffer()[0]).toMatchObject({ event: 'NO_DATA_EVENT', data: null });
});

test('the buffer is shared across loggers with different prefixes', () => {
  const logA = createLogger('SF:A');
  const logB = createLogger('SF:B');
  logA('FROM_A');
  logB('FROM_B');

  expect(getLogBuffer().map(e => e.event)).toEqual(['FROM_A', 'FROM_B']);
});

test('still logs to console with the given prefix', () => {
  const log = createLogger('SF:Test');
  log('EVENT', { x: 1 });

  expect(console.log).toHaveBeenCalledWith(expect.stringContaining('[SF:Test'), 'EVENT', { x: 1 });
});

test('caps the buffer at 300 entries, dropping the oldest first', () => {
  const log = createLogger('SF:Test');
  for (let i = 0; i < 305; i++) log(`EVENT_${i}`);

  const buffer = getLogBuffer();
  expect(buffer).toHaveLength(300);
  expect(buffer[0].event).toBe('EVENT_5');
  expect(buffer[299].event).toBe('EVENT_304');
});

test('getLogBuffer returns a copy, not a live reference', () => {
  const log = createLogger('SF:Test');
  log('EVENT');
  const buffer = getLogBuffer();
  buffer.push({ ts: 'x', event: 'INJECTED', data: null });

  expect(getLogBuffer()).toHaveLength(1);
});

test('clearLogBuffer empties the buffer', () => {
  const log = createLogger('SF:Test');
  log('EVENT');
  clearLogBuffer();

  expect(getLogBuffer()).toHaveLength(0);
});
