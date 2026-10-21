const account = require('./account');

function response({ ok = true, status = 200, body = null, headers = {} } = {}) {
  return {
    ok,
    status,
    json: async () => { if (body === null) throw new Error('no body'); return body; },
    headers: { get: (name) => headers[name] ?? null },
  };
}

describe('authenticate', () => {
  test('posts name/password/device to /auth/login and returns the token', async () => {
    const fetchFn = jest.fn(async () => response({ body: { name: 'alice', token: 'sf_tok' } }));
    const result = await account.authenticate(fetchFn, 'https://c', 'login', ' alice ', 'pw');
    expect(result).toEqual({ ok: true, name: 'alice', token: 'sf_tok', email: null, emailVerified: false, verificationSent: false });
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://c/auth/login');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ name: 'alice', password: 'pw', device: 'Browser extension' });
  });

  test('register sends a given email (never on login) and returns the email state', async () => {
    const fetchFn = jest.fn(async () => response({ status: 201, body: { name: 'bob', token: 't', email: 'bob@example.com', emailVerified: false, verificationSent: true } }));
    const result = await account.authenticate(fetchFn, 'https://c', 'register', 'bob', 'pw', ' bob@example.com ');
    expect(JSON.parse(fetchFn.mock.calls[0][1].body).email).toBe('bob@example.com');
    expect(result).toMatchObject({ email: 'bob@example.com', emailVerified: false, verificationSent: true });

    await account.authenticate(fetchFn, 'https://c', 'login', 'bob', 'pw', 'bob@example.com');
    expect(JSON.parse(fetchFn.mock.calls[1][1].body).email).toBeUndefined();
    await account.authenticate(fetchFn, 'https://c', 'register', 'bob', 'pw', '   ');
    expect(JSON.parse(fetchFn.mock.calls[2][1].body).email).toBeUndefined();
  });

  test('register uses /auth/register', async () => {
    const fetchFn = jest.fn(async () => response({ status: 201, body: { name: 'bob', token: 't' } }));
    await account.authenticate(fetchFn, 'https://c', 'register', 'bob', 'pw');
    expect(fetchFn.mock.calls[0][0]).toBe('https://c/auth/register');
  });

  test("a failure carries the companion's own message", async () => {
    const fetchFn = async () => response({ ok: false, status: 401, body: { error: 'Invalid user name or password.' } });
    expect(await account.authenticate(fetchFn, 'https://c', 'login', 'a', 'b'))
      .toEqual({ ok: false, status: 401, error: 'Invalid user name or password.', retryAfter: 0 });
  });

  test('a throttle response exposes Retry-After', async () => {
    const fetchFn = async () => response({ ok: false, status: 429, body: { error: 'Too many' }, headers: { 'Retry-After': '42' } });
    expect((await account.authenticate(fetchFn, 'https://c', 'login', 'a', 'b')).retryAfter).toBe(42);
  });

  test('an unreachable companion is status 0', async () => {
    const fetchFn = async () => { throw new TypeError('Failed to fetch'); };
    expect(await account.authenticate(fetchFn, 'https://c', 'login', 'a', 'b')).toMatchObject({ ok: false, status: 0 });
  });

  test('a success without a token is treated as a failure', async () => {
    const fetchFn = async () => response({ body: { name: 'alice' } });
    expect((await account.authenticate(fetchFn, 'https://c', 'login', 'a', 'b')).ok).toBe(false);
  });
});

describe('the other endpoints', () => {
  test('signOut / signOutEverywhere / changePassword hit their paths; 204 is a success', async () => {
    const fetchFn = jest.fn(async () => response({ status: 204 }));
    expect((await account.signOut(fetchFn, 'https://c')).ok).toBe(true);
    expect((await account.signOutEverywhere(fetchFn, 'https://c')).ok).toBe(true);
    expect((await account.changePassword(fetchFn, 'https://c', 'old', 'new')).ok).toBe(true);
    expect(fetchFn.mock.calls.map((c) => c[0])).toEqual([
      'https://c/auth/logout', 'https://c/auth/logout-all', 'https://c/auth/change-password']);
    expect(JSON.parse(fetchFn.mock.calls[2][1].body)).toEqual({ currentPassword: 'old', newPassword: 'new' });
  });
});

describe('checkRegistrationInput', () => {
  test.each([
    ['', 'pw', 'pw', 'nameMissing'],
    ['a', '', '', 'passwordMissing'],
    ['a', 'pw', 'px', 'passwordMismatch'],
    ['a', 'pw', 'pw', 'ok'],
  ])('%j / %j / %j -> %s', (name, pw, repeat, expected) => {
    expect(account.checkRegistrationInput(name, pw, repeat)).toBe(expected);
  });
});
