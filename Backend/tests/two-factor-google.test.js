import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { encryptTotpSecret, decryptTotpSecret } from '../src/modules/auth/helpers/totpSecret.js';

const userId = '12345678-1234-4234-8234-123456789def';
const subject = 'linked-google-subject';
const secret = 'JBSWY3DPEHPK3PXP';
const now = 1800000015000;
const time = Math.floor(now / 1000);
const code = () => speakeasy.totp({ secret, encoding: 'base32', time });
const envNames = ['JWT_SECRET', 'TWO_FACTOR_ENCRYPTION_KEY', 'GOOGLE_CLIENT_ID',
  'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI', 'GOOGLE_ALLOWED_HD'];
const originalEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
let user, payload, tokens, exchangeError, verificationError, linked, calls, googleCalls, usedCodes, beforeUpdate;

class GoogleClient {
  constructor(clientId, clientSecret, redirectUri) {
    this.config = [clientId, clientSecret, redirectUri];
  }
  async getToken(authorizationCode) {
    googleCalls.push(authorizationCode);
    assert.deepEqual(this.config, ['test-client', 'test-secret', 'http://localhost/callback']);
    if (exchangeError || usedCodes.has(authorizationCode)) throw new Error('sensitive Google error');
    usedCodes.add(authorizationCode);
    return { tokens };
  }
  async verifyIdToken(options) {
    assert.deepEqual(options, { idToken: 'signed-google-id-token', audience: 'test-client' });
    if (verificationError) throw new Error('expired, invalid signature, or wrong audience');
    return { getPayload: () => payload };
  }
}

async function query(sql, params) {
  calls.push({ sql, params });
  if (/^\s*SELECT 1 FROM public.auth_identities/.test(sql)) {
    assert.deepEqual(params, [userId, payload.sub]);
    const found = linked && params[1] === subject;
    return { rows: found ? [{}] : [], rowCount: found ? 1 : 0 };
  }
  if (/^\s*SELECT/.test(sql)) return { rows: [{ ...user, id: userId }], rowCount: 1 };
  assert.match(sql, /^UPDATE public.users/);
  const isSetup = /SET totp_secret_encrypted = \$2/.test(sql);
  assert.match(sql, /password_hash IS NOT DISTINCT FROM/);
  assert.match(sql, /EXISTS \(\s*SELECT 1 FROM public.auth_identities/);
  assert.match(sql, new RegExp(`provider_user_id = \\$${isSetup ? 6 : 7}`));
  assert.equal(params.at(-1), subject);
  assert.equal(params[isSetup ? 2 : 1], user.password_hash);
  beforeUpdate?.();
  if (!linked || user.authz_version !== params[isSetup ? 3 : 2]) return { rows: [], rowCount: 0 };
  if (isSetup) user.totp_secret_encrypted = params[1];
  else {
    user.is_2fa_enabled = false;
    user.totp_secret_encrypted = null;
  }
  user.totp_last_used_step = -1;
  return { rows: [{ id: userId }], rowCount: 1 };
}

mock.module('google-auth-library', { namedExports: { OAuth2Client: GoogleClient } });
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { query }, readPool: { query } },
});
const { default: authRoutes } = await import('../src/modules/auth/auth.routes.js');
const { twoFactorSetupLimiter, twoFactorDisableLimiter } = await import('../src/modules/auth/auth.middleware.js');
let server, baseUrl, accessToken;

before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth/2fa`;
});
beforeEach(() => {
  mock.method(Date, 'now', () => now);
  mock.method(bcrypt, 'compare', () => { throw new Error('Google verification must not use bcrypt'); });
  process.env.JWT_SECRET = 'google-reauthentication-test-secret';
  process.env.TWO_FACTOR_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  process.env.GOOGLE_CLIENT_ID = 'test-client';
  process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  process.env.GOOGLE_REDIRECT_URI = 'http://localhost/callback';
  delete process.env.GOOGLE_ALLOWED_HD;
  accessToken = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  user = {
    email: 'member@example.com', password_hash: null, status: 'active', authz_version: 1,
    is_2fa_enabled: false, totp_secret_encrypted: null, totp_last_used_step: -1,
  };
  payload = { sub: subject, email: user.email, email_verified: true };
  tokens = { id_token: 'signed-google-id-token' };
  linked = true;
  calls = [];
  googleCalls = [];
  usedCodes = new Set();
  exchangeError = verificationError = false;
  beforeUpdate = undefined;
  twoFactorSetupLimiter.resetKey(userId);
  twoFactorDisableLimiter.resetKey(userId);
});
afterEach(() => mock.restoreAll());
after(async () => {
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

async function request(endpoint, body, bearer = accessToken) {
  const res = await fetch(`${baseUrl}/${endpoint}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  assert.equal(json.success, res.ok);
  return { status: res.status, body: json };
}
function enable() {
  user.is_2fa_enabled = true;
  user.totp_secret_encrypted = encryptTotpSecret(secret, userId);
}
const unchanged = original => {
  assert.deepEqual(user, original);
  assert.ok(calls.every(({ sql }) => /^\s*SELECT/.test(sql)));
};

test('Google-only user can set up an encrypted secret and then confirm enrollment separately', async () => {
  const res = await request('setup', { googleCode: 'fresh-code' });
  assert.equal(res.status, 200);
  assert.match(res.body.qr, /^data:image\/png;base64,/);
  assert.equal(decryptTotpSecret(user.totp_secret_encrypted, userId), res.body.manual.yourKey);
  assert.equal(user.is_2fa_enabled, false);
  assert.equal(user.password_hash, null);
});
test('Google-only user can disable active 2FA with an unused authenticator code', async () => {
  enable();
  const res = await request('disable', { googleCode: 'fresh-code', token: code() });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { success: true, message: '2FA disabled' });
  assert.equal(user.is_2fa_enabled, false);
  assert.equal(user.totp_secret_encrypted, null);
});
test('Google verification can cancel pending setup without an authenticator code', async () => {
  user.totp_secret_encrypted = encryptTotpSecret(secret, userId);
  assert.equal((await request('disable', { googleCode: 'fresh-code' })).status, 200);
  assert.equal(user.totp_secret_encrypted, null);
});
test('Google verification cannot disable active 2FA with missing, invalid, or replayed OTPs', async () => {
  enable();
  const original = { ...user };
  const valid = [-1, 0, 1].map(offset => speakeasy.totp({ secret, encoding: 'base32', time: time + offset * 30 }));
  const invalid = Array.from({ length: 10 }, (_, i) => String(i).padStart(6, '0')).find(value => !valid.includes(value));
  assert.equal((await request('disable', { googleCode: 'code-1' })).status, 401);
  assert.equal((await request('disable', { googleCode: 'code-2', token: invalid })).status, 401);
  unchanged(original);
  user.totp_last_used_step = Math.floor(time / 30);
  assert.equal((await request('disable', { googleCode: 'code-3', token: code() })).status, 401);
  assert.equal(user.is_2fa_enabled, true);
});

for (const endpoint of ['setup', 'disable']) {
  const body = (googleCode = 'fresh-code') => ({ googleCode, ...(endpoint === 'disable' ? { token: code() } : {}) });
  test(`${endpoint}: requires a normal bearer token before exchanging Google codes`, async () => {
    assert.equal((await request(endpoint, body(), null)).status, 401);
    assert.equal(googleCalls.length, 0);
    assert.equal(calls.length, 0);
  });
  test(`${endpoint}: linked users with a local password may also verify through Google`, async () => {
    user.password_hash = 'existing-password-hash';
    if (endpoint === 'disable') enable();
    assert.equal((await request(endpoint, body())).status, 200);
    assert.equal(user.password_hash, 'existing-password-hash');
  });
  test(`${endpoint}: rejects both credentials and malformed Google codes`, async () => {
    for (const input of [{ ...body(), password: 'password' }, { googleCode: '' },
      { googleCode: ' ' }, { googleCode: 123 }, { googleCode: 'x'.repeat(4097) }]) {
      assert.equal((await request(endpoint, input)).status, 400);
    }
    assert.equal(googleCalls.length, 0);
    assert.ok(calls.every(({ sql }) => !sql.includes('auth_identities') && !sql.includes('UPDATE')));
  });
  test(`${endpoint}: matching email alone cannot authorize an unlinked Google subject`, async () => {
    payload.sub = 'another-google-account';
    const original = { ...user };
    assert.equal((await request(endpoint, body())).status, 403);
    unchanged(original);
  });
  test(`${endpoint}: rejects invalid exchanges, ID tokens, and unverified identities`, async () => {
    const original = { ...user };
    exchangeError = true;
    assert.equal((await request(endpoint, body('code-1'))).status, 401);
    exchangeError = false;
    verificationError = true;
    assert.equal((await request(endpoint, body('code-2'))).status, 401);
    verificationError = false;
    tokens = { access_token: 'access-token-alone-is-not-accepted' };
    assert.equal((await request(endpoint, body('code-3'))).status, 401);
    tokens = { id_token: 'signed-google-id-token' };
    payload.email_verified = false;
    assert.equal((await request(endpoint, body('code-4'))).status, 401);
    payload.email_verified = true;
    delete payload.sub;
    assert.equal((await request(endpoint, body('code-5'))).status, 401);
    unchanged(original);
  });
  test(`${endpoint}: checks Google configuration and allowed hosted domain`, async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    assert.equal((await request(endpoint, body())).status, 500);
    assert.equal(googleCalls.length, 0);
    process.env.GOOGLE_CLIENT_ID = 'test-client';
    process.env.GOOGLE_ALLOWED_HD = 'allowed.example';
    payload.hd = 'another.example';
    assert.equal((await request(endpoint, body())).status, 403);
  });
  test(`${endpoint}: refuses a Google identity removed before the update`, async () => {
    if (endpoint === 'disable') enable();
    const original = { ...user };
    beforeUpdate = () => { linked = false; };
    assert.equal((await request(endpoint, body())).status, 409);
    assert.deepEqual(user, original);
  });
  test(`${endpoint}: account changes during verification prevent the update`, async () => {
    if (endpoint === 'disable') enable();
    const originalSecret = user.totp_secret_encrypted;
    beforeUpdate = () => { user.authz_version++; };
    assert.equal((await request(endpoint, body())).status, 409);
    assert.equal(user.totp_secret_encrypted, originalSecret);
  });
  test(`${endpoint}: already consumed authorization codes fail without changes`, async () => {
    usedCodes.add('used-code');
    const original = { ...user };
    const res = await request(endpoint, body('used-code'));
    assert.equal(res.status, 401);
    assert.ok(!JSON.stringify(res.body).includes('sensitive'));
    unchanged(original);
  });
  test(`${endpoint}: Google attempts use the existing per-account rate limit`, async () => {
    exchangeError = true;
    for (let i = 0; i < 5; i++) assert.equal((await request(endpoint, body(`code-${i}`))).status, 401);
    assert.equal((await request(endpoint, body('code-6'))).status, 429);
    assert.equal(googleCalls.length, 5);
  });
}
