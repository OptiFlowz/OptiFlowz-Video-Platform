import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { encryptTotpSecret } from '../src/modules/auth/helpers/totpSecret.js';

const id = '12345678-1234-4234-8234-123456789def';
const password = 'current-test-password';
const passwordHash = await bcrypt.hash(password, 4);
const secret = 'JBSWY3DPEHPK3PXP';
const now = Math.floor(Date.now() / 30_000) * 30_000 + 15_000;
const time = Math.floor(now / 1000);
const step = Math.floor(time / 30);
const envNames = ['JWT_SECRET', 'TWO_FACTOR_TOKEN_SECRET', 'TWO_FACTOR_ENCRYPTION_KEY', 'BCRYPT_ROUNDS', 'GOOGLE_ALLOWED_HD'];
const previousEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
let user, calls, logs, googlePayload, googleFailure, googleMode, connections, releases;
let lockTail, beforeLock, failCommit;

function baseUser() {
  return {
    id, email: 'member@example.com', full_name: 'Member', image_url: 'image',
    description: 'Description', eaes_member: false, password_hash: passwordHash,
    status: 'active', authz_version: 1, is_2fa_enabled: true,
    totp_secret_encrypted: encryptTotpSecret(secret, id),
    totp_last_used_step: String(step - 2), last_login_at: null,
  };
}
const rows = value => ({ rows: value ? [{ ...value }] : [], rowCount: value ? 1 : 0 });
const pool = {
  async query(sql, params) {
    calls.push({ sql, params });
    assert.match(sql, /SELECT/);
    if (/lower\(email\)/.test(sql)) return rows(user?.email === params[0] ? user : null);
    return rows(user?.id === params[0] ? user : null);
  },
  async connect() {
    connections++;
    let unlock, snapshot;
    return {
      async query(sql, params) {
        calls.push({ sql, params });
        if (sql === 'BEGIN') return rows(null);
        if (sql === 'COMMIT') {
          if (failCommit) throw new Error('commit failed');
          unlock?.(); unlock = undefined;
          return rows(null);
        }
        if (sql === 'ROLLBACK') {
          if (snapshot) user = { ...snapshot };
          unlock?.(); unlock = undefined;
          return rows(null);
        }
        if (/FOR UPDATE/.test(sql)) {
          const previous = lockTail;
          lockTail = new Promise(resolve => { unlock = resolve; });
          await previous;
          beforeLock?.();
          snapshot = user ? { ...user } : null;
          return rows(user?.id === params[0] ? user : null);
        }
        if (/FROM public.auth_identities/.test(sql)) return rows(googleMode === 'existing' ? user : null);
        if (/FROM public.users/.test(sql)) return rows(user);
        if (/INSERT INTO public.users/.test(sql)) {
          user = { ...baseUser(), is_2fa_enabled: false, totp_secret_encrypted: null, password_hash: params[1] };
          return rows(user);
        }
        if (/FROM roles/.test(sql)) return rows({ id: 1 });
        if (/INSERT INTO (public.auth_identities|user_roles)/.test(sql)) return rows(null);
        if (/SET totp_last_used_step/.test(sql)) {
          assert.ok(unlock, 'OTP consumption must hold the user lock');
          user.totp_last_used_step = String(params[1]);
          return rows(user);
        }
        if (/SET last_login_at/.test(sql)) {
          assert.ok(unlock, 'Login completion must hold the user lock');
          user.last_login_at = 'logged-in';
          return rows(user);
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      release() { releases++; },
    };
  },
};

mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: pool, readPool: pool },
});
mock.module(new URL('../src/common/logger.js', import.meta.url).href, {
  namedExports: { logEvent: (...args) => logs.push(args) },
});
mock.module('google-auth-library', {
  namedExports: { OAuth2Client: class {
    async getToken() {
      if (googleFailure) throw new Error('invalid Google code');
      return { tokens: { id_token: 'verified-google-id-token' } };
    }
    async verifyIdToken() { return { getPayload: () => googlePayload }; }
  } },
});

const { loginInternal } = await import('../src/modules/auth/handlers/login.js');
const { oAuthLoginInternal } = await import('../src/modules/auth/handlers/oAuthLogin.js');
const { twoFactorLoginInternal } = await import('../src/modules/auth/handlers/twoFactorLogin.js');
const { createTwoFactorToken, verifyTwoFactorToken } = await import('../src/modules/auth/helpers/twoFactorToken.js');
const { createAccessToken } = await import('../src/modules/auth/helpers/createAccessToken.js');
const { default: authRoutes } = await import('../src/modules/auth/auth.routes.js');
const { requireAuth, optionalAuth } = await import('../src/middleware/auth.js');
const { twoFactorLoginLimiter } = await import('../src/modules/auth/auth.middleware.js');
let server, baseUrl;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  app.get('/private', requireAuth, (_req, res) => res.json({ success: true }));
  app.get('/optional', optionalAuth, (_req, res) => res.json({ success: true }));
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  mock.method(Date, 'now', () => now);
  process.env.JWT_SECRET = 'normal-access-test-secret-32-characters';
  process.env.TWO_FACTOR_TOKEN_SECRET = randomBytes(32).toString('base64');
  process.env.TWO_FACTOR_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.BCRYPT_ROUNDS = '4';
  delete process.env.GOOGLE_ALLOWED_HD;
  user = baseUser();
  calls = []; logs = []; connections = 0; releases = 0;
  lockTail = Promise.resolve(); beforeLock = undefined; failCommit = false;
  googleMode = 'existing'; googleFailure = false;
  googlePayload = { sub: 'google-user-id', email: user.email, email_verified: true, name: 'Member', picture: 'image' };
  twoFactorLoginLimiter.resetKey(id);
});
afterEach(() => {
  assert.equal(connections, releases, 'All database connections must be released');
  mock.restoreAll();
});
after(async () => {
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  for (const [name, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[name]; else process.env[name] = value;
  }
});

const passwordLogin = () => loginInternal({ body: { email: user.email, password } });
const googleLogin = () => oAuthLoginInternal({ params: { provider: 'google' }, body: { code: 'google-auth-code' } });
const otp = (offset = 0) => speakeasy.totp({ secret, encoding: 'base32', time: time + offset * 30 });
const finish = (twoFactorToken, code = otp()) => twoFactorLoginInternal({ body: { twoFactorToken, otp: code } });
function wrongOtp() {
  const valid = [-1, 0, 1].map(otp);
  return Array.from({ length: 10 }, (_, i) => String(i).padStart(6, '0')).find(code => !valid.includes(code));
}
async function post(path, body) {
  const response = await fetch(`${baseUrl}/api/auth${path}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const result = await response.json();
  assert.equal(typeof result.success, 'boolean');
  if (!response.ok) assert.equal(result.success, false);
  return { response, result };
}
function assertPending(result) {
  assert.deepEqual(Object.keys(result).sort(), ['requires2fa', 'success', 'twoFactorToken']);
  assert.equal(result.success, false);
  assert.equal(result.requires2fa, true);
  const claims = verifyTwoFactorToken(result.twoFactorToken);
  assert.equal(claims.sub, id);
  assert.equal(claims.purpose, '2fa-login');
  assert.equal(claims.exp - claims.iat, 300);
  assert.equal(user.last_login_at, null);
  assert.ok(!logs.some(([event]) => event === 'auth.login_success'));
  assert.ok(!JSON.stringify(jwt.decode(result.twoFactorToken)).includes(passwordHash));
  return claims;
}

test('password login returns a pending token, then the shared endpoint returns a full session', async () => {
  const first = await post('/login', { email: user.email, password });
  assert.equal(first.response.status, 200);
  assert.equal(first.response.headers.get('cache-control'), 'no-store');
  assertPending(first.result);
  const completed = await post('/2fa/login', { twoFactorToken: first.result.twoFactorToken, otp: otp() });
  assert.equal(completed.response.status, 200);
  assert.equal(completed.result.success, true);
  assert.equal(completed.result.user.email, user.email);
  assert.equal(jwt.verify(completed.result.token, process.env.JWT_SECRET).purpose, 'access');
  assert.equal(user.last_login_at, 'logged-in');
  assert.equal(user.totp_last_used_step, String(step));
});

test('Google login uses the same completion endpoint and preserves provider metadata', async () => {
  const first = await post('/oauth/google', { code: 'google-code' });
  assert.equal(first.response.status, 200);
  const claims = assertPending(first.result);
  assert.equal(claims.context.provider, 'google');
  const { result, response } = await post('/2fa/login', { twoFactorToken: first.result.twoFactorToken, otp: otp() });
  assert.equal(response.status, 200);
  assert.equal(result.success, true);
  assert.equal(result.provider, 'google');
  assert.equal(result.is_new_user, false);
  assert.equal(result.linked_existing_account, false);
});

test('users without 2FA still receive immediate sessions from either login method', async () => {
  user.is_2fa_enabled = false;
  user.totp_secret_encrypted = null;
  for (const login of [passwordLogin, googleLogin]) {
    const result = await login();
    assert.equal(result.success, true);
    assert.ok(result.token);
    assert.equal(result.requires2fa, undefined);
    assert.equal(result.twoFactorToken, undefined);
  }
});

test('new Google accounts and existing email links go through the common gate', async () => {
  googleMode = 'link';
  const linked = await googleLogin();
  assert.equal(assertPending(linked).context.linked_existing_account, true);
  googleMode = 'new'; user = null;
  const created = await googleLogin();
  assert.equal(created.success, true);
  assert.equal(created.is_new_user, true);
  assert.ok(created.token);
});

test('invalid password or Google identity never produces a pending token', async () => {
  await assert.rejects(loginInternal({ body: { email: user.email, password: 'wrong-password' } }), { status: 401 });
  googleFailure = true;
  await assert.rejects(googleLogin(), { status: 500 });
  googleFailure = false; googlePayload.email_verified = false;
  await assert.rejects(googleLogin(), { status: 401 });
  assert.equal(connections, 0);
  assert.equal(user.last_login_at, null);
});

test('disabled accounts cannot start login and OAuth HTTP errors roll back their transaction', async () => {
  user.status = 'disabled';
  await assert.rejects(passwordLogin(), { status: 401 });
  await assert.rejects(googleLogin(), { status: 401 });
  assert.equal(calls.filter(call => call.sql === 'ROLLBACK').length, 2);
  assert.equal(user.last_login_at, null);
});

test('credential changes or newly enabled 2FA between password check and issuance cannot bypass the gate', async () => {
  beforeLock = () => { user.password_hash = 'changed'; };
  await assert.rejects(passwordLogin(), { status: 401 });
  user = baseUser(); user.is_2fa_enabled = false;
  beforeLock = () => { user.is_2fa_enabled = true; };
  assertPending(await passwordLogin());
});

test('temporary JWTs cannot authorize required or optional auth, even when signed with the access key', async () => {
  const pending = createTwoFactorToken(user);
  const wrongPurpose = jwt.sign({ sub: id, authzVersion: 1, purpose: '2fa-login' }, process.env.JWT_SECRET);
  for (const token of [pending, wrongPurpose]) {
    for (const path of ['/private', '/optional']) {
      const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(res.status, 401);
      assert.equal((await res.json()).success, false);
    }
  }
  assert.equal(calls.length, 0);
});

test('access tokens, tampered tokens, wrong purpose, and expired temporary tokens fail', async () => {
  const pending = createTwoFactorToken(user);
  const payload = jwt.decode(pending);
  const wrongPurpose = jwt.sign({ ...payload, purpose: 'access' }, process.env.TWO_FACTOR_TOKEN_SECRET);
  const expired = jwt.sign({ ...payload, iat: time - 301, exp: time - 1 }, process.env.TWO_FACTOR_TOKEN_SECRET);
  const missingExpiry = { ...payload }; delete missingExpiry.exp;
  const invalid = [createAccessToken(user), `${pending}x`, wrongPurpose, expired,
    jwt.sign(missingExpiry, process.env.TWO_FACTOR_TOKEN_SECRET)];
  for (const token of invalid) {
    const { response } = await post('/2fa/login', { twoFactorToken: token, otp: otp() });
    assert.equal(response.status, 401);
  }
  assert.equal(connections, 0);
});

test('changed password, MFA secret, authorization, or disabled account invalidate pending login', async () => {
  for (const change of [
    () => { user.password_hash = 'changed'; },
    () => { user.totp_secret_encrypted = encryptTotpSecret(secret, id); },
    () => { user.authz_version++; },
    () => { user.is_2fa_enabled = false; },
    () => { user.status = 'disabled'; },
  ]) {
    user = baseUser();
    const token = createTwoFactorToken(user);
    change();
    await assert.rejects(finish(token), { status: 401 });
    assert.equal(user.last_login_at, null);
  }
});

test('wrong or already-consumed OTP does not update last-login time or consume pending login', async () => {
  const token = createTwoFactorToken(user);
  await assert.rejects(finish(token, wrongOtp()), { status: 401 });
  assert.equal(user.last_login_at, null);
  assert.equal(user.totp_last_used_step, String(step - 2));
  assert.equal((await finish(token)).success, true);
  // A newly issued temporary token still cannot reuse the same OTP.
  await assert.rejects(finish(createTwoFactorToken(user)), { status: 401 });
});

test('used pending tokens cannot be replayed, including with the next valid OTP', async () => {
  const token = createTwoFactorToken(user);
  await finish(token);
  await assert.rejects(finish(token, otp(1)), { status: 401 });
  assert.equal(user.totp_last_used_step, String(step));
});

test('concurrent completions serialize and issue only one session', async () => {
  const token = createTwoFactorToken(user);
  const results = await Promise.allSettled([finish(token), finish(token)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 401);
});

test('commit failure rolls back OTP consumption and last-login time', async () => {
  const token = createTwoFactorToken(user);
  failCommit = true;
  await assert.rejects(finish(token), { status: 500 });
  assert.equal(user.totp_last_used_step, String(step - 2));
  assert.equal(user.last_login_at, null);
  assert.ok(!logs.some(([event]) => event === 'auth.login_success'));
});

test('bad input is rejected and missing or reused signing keys fail closed', async () => {
  for (const body of [{}, { twoFactorToken: 'x', otp: 123456 },
    { twoFactorToken: 'x', otp: '12345' }, { twoFactorToken: 'x', otp: '123456', userId: id }]) {
    await assert.rejects(twoFactorLoginInternal({ body }), { status: 400 });
  }
  for (const key of ['', 'short', process.env.JWT_SECRET, process.env.TWO_FACTOR_ENCRYPTION_KEY]) {
    process.env.TWO_FACTOR_TOKEN_SECRET = key;
    await assert.rejects(passwordLogin(), { status: 500 });
  }
  assert.equal(user.last_login_at, null);
});

test('OTP guess limits are shared across newly issued tokens for the same account', async () => {
  for (let i = 0; i < 5; i++) {
    const pending = await passwordLogin();
    const { response } = await post('/2fa/login', { twoFactorToken: pending.twoFactorToken, otp: wrongOtp() });
    assert.equal(response.status, 401);
  }
  const next = await googleLogin();
  const { response } = await post('/2fa/login', { twoFactorToken: next.twoFactorToken, otp: otp() });
  assert.equal(response.status, 429);
  assert.equal(user.last_login_at, null);
});
