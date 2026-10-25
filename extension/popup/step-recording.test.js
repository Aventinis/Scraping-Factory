require('./test-support/popup-env');
const { stepsToActions } = require('./step-recording');

const click = (selector, extra = {}) => ({ kind: 'click', selector, framePath: null, late: false, ...extra });
const fill = (selector, extra = {}) => ({ kind: 'fill', selector, framePath: null, late: false, inputType: 'text', ...extra });
const scroll = (containerSelector = null, extra = {}) => ({ kind: 'scroll', containerSelector, framePath: null, ...extra });

describe('stepsToActions', () => {
  test('a login: fill, fill, click become the editor\'s own actions, fills still without an environment variable', () => {
    const actions = stepsToActions([fill('#username'), fill('#password', { inputType: 'password' }), click('#login-submit')]);
    expect(actions).toEqual([
      { kind: 'fill', selector: '#username', environmentVariableName: '' },
      { kind: 'fill', selector: '#password', environmentVariableName: '', role: 'password' },
      { kind: 'click', selector: '#login-submit', target: 'first', waitAfterMs: 250 },
    ]);
  });

  test('clicks on the same selector in a row collapse into one; an interleaved other click does not', () => {
    expect(stepsToActions([click('.a'), click('.a'), click('.a')])).toHaveLength(1);
    expect(stepsToActions([click('.a'), click('.b'), click('.a')]).map(a => a.selector)).toEqual(['.a', '.b', '.a']);
  });

  test('many keystrokes into one field are one fill', () => {
    expect(stepsToActions([fill('#q'), fill('#q')])).toHaveLength(1);
  });

  test('the same selector in another frame is another step', () => {
    expect(stepsToActions([click('.a'), click('.a', { framePath: ['iframe#x'] })])).toHaveLength(2);
  });

  test('a scroll becomes a Scroll action with the editor\'s defaults and the container when there is one', () => {
    expect(stepsToActions([scroll('#feed')])).toEqual([
      { kind: 'scroll', containerSelector: '#feed', loadMoreButtonSelector: '', maxIterations: 10, waitAfterMs: 1000, scrollStepPx: null },
    ]);
    expect(stepsToActions([scroll(null)])[0].containerSelector).toBe('');
    expect(stepsToActions([scroll('#feed'), scroll('#feed')])).toHaveLength(1);
  });

  test('a target that appeared later gets a Wait before it, with the editor\'s default timeout', () => {
    expect(stepsToActions([click('.menu', { late: true })])).toEqual([
      { kind: 'waitFor', selector: '.menu', timeoutMs: 5000 },
      { kind: 'click', selector: '.menu', target: 'first', waitAfterMs: 250 },
    ]);
  });

  test('a late field is waited for too; a scroll never is', () => {
    expect(stepsToActions([fill('#code', { late: true })]).map(a => a.kind)).toEqual(['waitFor', 'fill']);
    expect(stepsToActions([scroll('#feed')]).map(a => a.kind)).toEqual(['scroll']);
  });

  test('the frame path is kept on every action of a step, and absent otherwise', () => {
    const [wait, clickAction] = stepsToActions([click('.b', { late: true, framePath: ['iframe#f'] })]);
    expect(wait.framePath).toEqual(['iframe#f']);
    expect(clickAction.framePath).toEqual(['iframe#f']);
    expect(stepsToActions([click('.b')])[0]).not.toHaveProperty('framePath');
  });

  test('no steps, no actions', () => {
    expect(stepsToActions([])).toEqual([]);
  });
});
