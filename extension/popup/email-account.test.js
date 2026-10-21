const email = require('./email-account');

function response({ ok = true, status = 200, body = null, headers = {} } = {}) {
  return {
    ok,
    status,
    json: async () => { if (body === null) throw new Error('no body'); return body; },
    headers: { get: (name) => headers[name] ?? null },
  };
}

describe('normalizeCode', () => {
  test.each([
    ['12345678', '12345678'],
    [' 1234 5678 ', '12345678'],
    ['1234-5678', '12345678'],
    ['00000001', '00000001'],
    ['1234567', null],
    ['123456789', null],
    ['1234abcd', null],
    ['', null],
    [undefined, null],
  ])('%j -> %j', (typed, expected) => expect(email.normalizeCode(typed)).toBe(expected));
});

describe('looksLikeEmail', () => {
  test.each([
    ['a@example.com', true], [' a@example.com ', true], ['a@b', false], ['a b@example.com', false], ['@example.com', false], ['', false],
  ])('%j -> %s', (value, expected) => expect(email.looksLikeEmail(value)).toBe(expected));
});

describe('verifyEmail', () => {
  test('sends the normalized code to /auth/verify-email', async () => {
    const fetchFn = jest.fn(async () => response({ body: { emailVerified: true } }));
    const result = await email.verifyEmail(fetchFn, 'https://c', '1234 5678');
    expect(result.ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe('https://c/auth/verify-email');
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ code: '12345678' });
  });

  test('a malformed code never reaches the companion', async () => {
    const fetchFn = jest.fn();
    const result = await email.verifyEmail(fetchFn, 'https://c', '12');
    expect(result).toMatchObject({ ok: false, invalidCode: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  test("a wrong code carries the companion's message", async () => {
    const fetchFn = async () => response({ ok: false, status: 400, body: { error: 'The code is wrong.' } });
    expect(await email.verifyEmail(fetchFn, 'https://c', '12345678')).toMatchObject({ ok: false, status: 400, error: 'The code is wrong.' });
  });
});

describe('resendVerification / setEmail', () => {
  test('resend posts to its endpoint; a cooldown exposes Retry-After', async () => {
    const fetchFn = jest.fn(async () => response({ ok: false, status: 429, body: { error: 'Please wait 40 seconds' }, headers: { 'Retry-After': '40' } }));
    const result = await email.resendVerification(fetchFn, 'https://c');
    expect(fetchFn.mock.calls[0][0]).toBe('https://c/auth/resend-verification');
    expect(result).toMatchObject({ ok: false, status: 429, retryAfter: 40 });
  });

  test('setEmail sends the address and the current password and returns the new state', async () => {
    const fetchFn = jest.fn(async () => response({ body: { email: 'n@example.com', emailVerified: false, verificationSent: true } }));
    const result = await email.setEmail(fetchFn, 'https://c', ' n@example.com ', 'pw');
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ email: 'n@example.com', currentPassword: 'pw' });
    expect(result).toEqual({ ok: true, email: 'n@example.com', emailVerified: false, verificationSent: true });
  });
});

describe('forgotPassword / resetPassword', () => {
  test('forgot sends the typed account', async () => {
    const fetchFn = jest.fn(async () => response({ status: 202, body: { message: 'x' } }));
    expect((await email.forgotPassword(fetchFn, 'https://c', ' alice ')).ok).toBe(true);
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ account: 'alice' });
  });

  test('reset sends account, normalized code and new password; 204 is success', async () => {
    const fetchFn = jest.fn(async () => response({ status: 204 }));
    const result = await email.resetPassword(fetchFn, 'https://c', 'alice', '1234-5678', 'a-new-long-password');
    expect(result.ok).toBe(true);
    expect(fetchFn.mock.calls[0][0]).toBe('https://c/auth/reset-password');
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toEqual({ account: 'alice', code: '12345678', newPassword: 'a-new-long-password' });
  });

  test('reset with a malformed code is refused locally', async () => {
    const fetchFn = jest.fn();
    expect(await email.resetPassword(fetchFn, 'https://c', 'alice', 'abc', 'pw')).toMatchObject({ ok: false, invalidCode: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
