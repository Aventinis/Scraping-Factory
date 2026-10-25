const { createStepRecorder, SCROLL_SETTLE_MS } = require('./step-recorder');

// Issue #508: the recorder in a jsdom page. Scripted events are accepted here (isUserEvent) — the real recorder only takes the user's.
describe('step recorder', () => {
  let sent;
  let recorder;

  const flush = () => Promise.resolve().then(() => Promise.resolve());

  function make(overrides = {}) {
    sent = [];
    recorder = createStepRecorder({
      selectorFor: (el) => (el.id ? `#${el.id}` : el.tagName.toLowerCase()),
      resolveFramePath: () => Promise.resolve([]),
      send: (step) => sent.push(step),
      log: () => {},
      isUserEvent: () => true,
      ...overrides,
    });
    recorder.start();
  }

  beforeEach(() => {
    document.body.innerHTML = '<form><input id="user" type="text"><input id="pass" type="password"><input id="agree" type="checkbox"><button id="go"><span id="label">Log in</span></button></form><div id="feed" style="height:50px;overflow:auto"></div>';
    jest.useFakeTimers();
  });

  afterEach(() => { recorder.stop(); jest.useRealTimers(); });

  const type = (el, value) => { el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };

  test('a click is recorded with the element\'s selector; a click on a child counts for the button', async () => {
    make();
    document.getElementById('label').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent).toEqual([{ kind: 'click', selector: '#go', framePath: null, late: false }]);
  });

  test('typing records the field and its type once per run — and never the typed text', async () => {
    make();
    const secret = 'correct-horse-battery-staple';
    type(document.getElementById('pass'), secret);
    type(document.getElementById('pass'), `${secret}!`);
    await flush();
    expect(sent).toEqual([{ kind: 'fill', selector: '#pass', framePath: null, late: false, inputType: 'password' }]);
    expect(JSON.stringify(sent)).not.toContain('correct-horse');
  });

  test('a different field, or typing again after a click, is a new fill', async () => {
    make();
    type(document.getElementById('user'), 'a');
    type(document.getElementById('pass'), 'b');
    document.getElementById('go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    type(document.getElementById('pass'), 'c');
    await flush();
    expect(sent.map(s => `${s.kind}:${s.selector}`)).toEqual(['fill:#user', 'fill:#pass', 'click:#go', 'fill:#pass']);
  });

  test('inputs that are not text (a checkbox) are no fill', async () => {
    make();
    type(document.getElementById('agree'), 'x');
    await flush();
    expect(sent).toEqual([]);
  });

  test('scripted events are not the user\'s', async () => {
    make({ isUserEvent: undefined });
    document.getElementById('go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    type(document.getElementById('user'), 'a');
    await flush();
    expect(sent).toEqual([]);
  });

  test('a target that appeared after the recording began is marked late, one that was there is not', async () => {
    make();
    const late = document.createElement('button');
    late.id = 'later';
    const wrapper = document.createElement('div');
    wrapper.appendChild(late);
    document.body.appendChild(wrapper);
    await flush(); // MutationObserver callbacks are microtasks
    await Promise.resolve();
    late.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    document.getElementById('go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent.map(s => [s.selector, s.late])).toEqual([['#later', true], ['#go', false]]);
  });

  describe('scrolling', () => {
    const grow = (el, height) => Object.defineProperty(el, 'scrollHeight', { configurable: true, value: height });

    test('a scroll that makes the container grow is recorded with its selector', async () => {
      make();
      const feed = document.getElementById('feed');
      grow(feed, 100);
      feed.dispatchEvent(new Event('scroll'));
      grow(feed, 200); // the page loaded more
      jest.advanceTimersByTime(SCROLL_SETTLE_MS + 10);
      await flush();
      expect(sent).toEqual([{ kind: 'scroll', containerSelector: '#feed', framePath: null }]);
    });

    test('a scroll after which nothing new appeared is a plain reading scroll and is ignored', async () => {
      make();
      const feed = document.getElementById('feed');
      grow(feed, 100);
      feed.dispatchEvent(new Event('scroll'));
      jest.advanceTimersByTime(SCROLL_SETTLE_MS + 10);
      await flush();
      expect(sent).toEqual([]);
    });

    test('many scroll events in a burst are one step, measured from the burst\'s start', async () => {
      make();
      const feed = document.getElementById('feed');
      grow(feed, 100);
      feed.dispatchEvent(new Event('scroll'));
      grow(feed, 150);
      jest.advanceTimersByTime(300);
      feed.dispatchEvent(new Event('scroll'));
      grow(feed, 200);
      jest.advanceTimersByTime(SCROLL_SETTLE_MS + 10);
      await flush();
      expect(sent).toHaveLength(1);
    });

    test('scrolling the page itself has no container', async () => {
      make();
      Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 500 });
      document.dispatchEvent(new Event('scroll'));
      Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 900 });
      jest.advanceTimersByTime(SCROLL_SETTLE_MS + 10);
      await flush();
      expect(sent).toEqual([{ kind: 'scroll', containerSelector: null, framePath: null }]);
    });
  });

  test('inside an iframe the steps carry the frame path', async () => {
    make({ resolveFramePath: () => Promise.resolve(['iframe#login']) });
    document.getElementById('go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent[0].framePath).toEqual(['iframe#login']);
  });

  test('after stop nothing is recorded any more', async () => {
    make();
    recorder.stop();
    document.getElementById('go').dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flush();
    expect(sent).toEqual([]);
    expect(recorder.isActive()).toBe(false);
  });
});
