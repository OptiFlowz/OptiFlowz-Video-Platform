import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { encryptTotpSecret, decryptTotpSecret } from '../src/modules/auth/helpers/totpSecret.js';

const userId = '12345678-1234-4234-8234-123456789def';
const secret = 'JBSWY3DPEHPK3PXP';
const key = randomBytes(32).toString('base64');
const now = Math.floor(Date.now() / 30_000) * 30_000 + 15_000;
const time = Math.floor(now / 1000);
const step = Math.floor(time / 30);
const previousKey = process.env.TWO_FACTOR_ENCRYPTION_KEY;
const previousJwtSecret = process.env.JWT_SECRET;
let user, calls, beforeUpdate, dbError;

async function query(sql, params) {
  calls.push({ sql, params });
  if (dbError) throw dbError;
  if (/^\s*SELECT/.test(sql)) {
    return { rows: user ? [{ ...user, id: userId }] : [], rowCount: user ? 1 : 0 };
  }
  assert.match(sql, /SET is_2fa_enabled = true, totp_last_used_step = \$2/);
  assert.match(sql, /WHERE id = \$1 AND is_2fa_enabled = false AND status = 'active'/);
  assert.match(sql, /totp_secret_encrypted = \$3 AND authz_version = \$4/);
  assert.match(sql, /totp_last_used_step < \$2/);
  beforeUpdate?.();
  if (!user || params[0] !== userId || user.is_2fa_enabled || user.status !== 'active'
    || user.totp_secret_encrypted !== params[2] || user.authz_version !== params[3]
    || Number(user.totp_last_used_step) >= params[1]) {
    return { rows: [], rowCount: 0 };
  }
  user.is_2fa_enabled = true;
  user.totp_last_used_step = params[1];
  return { rows: [{ id: userId }], rowCount: 1 };
}

mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { query }, readPool: { query } },
});
const { twoFactorVerifyInternal: verify } = await import('../src/modules/auth/handlers/twoFactorVerify.js');
const { default: authRoutes } = await import('../src/modules/auth/auth.routes.js');
const { twoFactorVerifyLimiter } = await import('../src/modules/auth/auth.middleware.js');
let server, baseUrl, accessToken;

before(async () => {
  process.env.JWT_SECRET = 'two-factor-verify-test-secret';
  accessToken = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth/2fa/verify`;
});

beforeEach(() => {
  mock.method(Date, 'now', () => now);
  process.env.TWO_FACTOR_ENCRYPTION_KEY = key;
  user = {
    status: 'active', authz_version: 1, is_2fa_enabled: false,
    totp_secret_encrypted: encryptTotpSecret(secret, userId), totp_last_used_step: '-1',
  };
  calls = [];
  beforeUpdate = undefined;
  dbError = null;
  twoFactorVerifyLimiter.resetKey(userId);
});
afterEach(() => mock.restoreAll());
after(async () => {
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  for (const [name, value] of [
    ['TWO_FACTOR_ENCRYPTION_KEY', previousKey], ['JWT_SECRET', previousJwtSecret],
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const code = (offset = 0) => speakeasy.totp({ secret, encoding: 'base32', time: time + offset * 30 });
const confirm = token => verify({ body: { token } }, userId);
const validCodes = () => [-1, 0, 1].map(code);
function invalidCode() {
  for (let value = 0; value < 10; value++) {
    const token = String(value).padStart(6, '0');
    if (!validCodes().includes(token)) return token;
  }
}
async function request(body, bearer = accessToken) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  assert.equal((await response.clone().json()).success, response.ok);
  return response;
}

test('authenticated confirmation enables 2FA and records the accepted time step without exposing secrets', async () => {
  const stored = user.totp_secret_encrypted;
  const res = await request({ token: code() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { success: true, message: '2FA enabled' });
  assert.equal(user.is_2fa_enabled, true);
  assert.equal(user.totp_last_used_step, step);
  assert.equal(user.totp_secret_encrypted, stored);
});

test('accepts one neighboring time step and records its actual counter', async () => {
  for (const offset of [-1, 1]) {
    user.is_2fa_enabled = false;
    user.totp_last_used_step = '-1';
    await confirm(code(offset));
    assert.equal(user.totp_last_used_step, step + offset);
  }
});

test('invalid and out-of-window codes do not enable 2FA', async () => {
  const tokens = [invalidCode(), ...[-3, -2, 2, 3].map(code).filter(token => !validCodes().includes(token))];
  for (const token of tokens) await assert.rejects(confirm(token), { status: 401 });
  assert.equal(user.is_2fa_enabled, false);
  assert.ok(calls.every(call => /^\s*SELECT/.test(call.sql)));
});

test('rejects a consumed time step and already-enabled accounts', async () => {
  user.totp_last_used_step = String(step);
  await assert.rejects(confirm(code()), { status: 401 });
  user.is_2fa_enabled = true;
  await assert.rejects(confirm(code()), { status: 409 });
  assert.ok(calls.every(call => /^\s*SELECT/.test(call.sql)));
});

test('missing setup, inactive users, and deleted users cannot confirm', async () => {
  user.totp_secret_encrypted = null;
  await assert.rejects(confirm(code()), { status: 400 });
  user.status = 'disabled';
  await assert.rejects(confirm(code()), { status: 401 });
  user = null;
  await assert.rejects(confirm(code()), { status: 401 });
});

test('requires a six-digit string and rejects actor spoofing before database access', async () => {
  for (const body of [undefined, {}, { token: 123456 }, { token: '12345' },
    { token: '1234567' }, { token: 'abcdef' }, { token: ' 123456' },
    { token: code(), userId: 'another-user' }]) {
    await assert.rejects(verify({ body }, userId), { status: 400 });
  }
  await assert.rejects(verify({ body: { token: code() } }), { status: 401 });
  assert.equal(calls.length, 0);
});

test('missing, invalid, and stale access tokens cannot reach the handler', async () => {
  assert.equal((await request({ token: code() }, null)).status, 401);
  assert.equal((await request({ token: code() }, 'invalid')).status, 401);
  assert.equal(calls.length, 0);
  user.authz_version = 2;
  assert.equal((await request({ token: code() })).status, 401);
  assert.equal(calls.length, 1);
});

test('decrypts setup ciphertext and rejects tampering, wrong owner, wrong key, and malformed envelopes', () => {
  const stored = user.totp_secret_encrypted;
  assert.equal(decryptTotpSecret(stored, userId), secret);
  assert.throws(() => decryptTotpSecret(stored, 'another-user'));
  const bytes = Buffer.from(stored.slice(3), 'base64');
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decryptTotpSecret(`v1.${bytes.toString('base64')}`, userId));
  for (const value of [null, 'plaintext', 'v2.abc', 'v1.abc', `${stored}!`]) {
    assert.throws(() => decryptTotpSecret(value, userId));
  }
  process.env.TWO_FACTOR_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  assert.throws(() => decryptTotpSecret(stored, userId));
});

test('decryption and database failures return generic errors without changing enrollment', async () => {
  delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
  const res = await request({ token: code() });
  assert.equal(res.status, 500);
  assert.deepEqual(await res.json(), { success: false, message: 'Unable to verify two-factor authentication' });
  assert.equal(user.is_2fa_enabled, false);
  dbError = new Error('sensitive internal detail');
  await assert.rejects(confirm(code()), { status: 500, message: 'Unable to verify two-factor authentication' });
});

test('a concurrent secret replacement is not enabled by an old code', async () => {
  const replacement = encryptTotpSecret('KRUGS4ZANFZSAYJA', userId);
  beforeUpdate = () => { user.totp_secret_encrypted = replacement; };
  await assert.rejects(confirm(code()), { status: 409 });
  assert.equal(user.is_2fa_enabled, false);
  assert.equal(user.totp_secret_encrypted, replacement);
});

test('only one simultaneous confirmation succeeds', async () => {
  const results = await Promise.allSettled([confirm(code()), confirm(code())]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected');
  assert.equal(rejected.reason.status, 409);
  assert.equal(user.is_2fa_enabled, true);
});

test('verification guesses are limited by authenticated account', async () => {
  for (let i = 0; i < 5; i++) {
    assert.equal((await request({ token: invalidCode() })).status, 401);
  }
  assert.equal((await request({ token: invalidCode() })).status, 429);
  assert.equal(user.is_2fa_enabled, false);
});
