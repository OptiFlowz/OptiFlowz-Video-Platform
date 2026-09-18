import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import speakeasy from 'speakeasy';
import { encryptTotpSecret } from '../src/modules/auth/helpers/totpSecret.js';

const userId = '12345678-1234-4234-8234-123456789def';
const password = 'current-test-password';
const passwordHash = await bcrypt.hash(password, 4);
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
  assert.match(sql, /SET is_2fa_enabled = false, totp_secret_encrypted = NULL,/);
  assert.match(sql, /totp_last_used_step = -1/);
  assert.match(sql, /WHERE id = \$1 AND status = 'active'/);
  assert.match(sql, /password_hash IS NOT DISTINCT FROM \$2 AND authz_version = \$3/);
  assert.match(sql, /is_2fa_enabled = \$4/);
  assert.match(sql, /totp_secret_encrypted IS NOT DISTINCT FROM \$5/);
  assert.match(sql, /\$6::bigint IS NULL OR totp_last_used_step < \$6/);
  beforeUpdate?.();
  if (!user || params[0] !== userId || user.status !== 'active'
    || user.password_hash !== params[1] || user.authz_version !== params[2]
    || user.is_2fa_enabled !== params[3] || user.totp_secret_encrypted !== params[4]
    || (params[5] !== null && Number(user.totp_last_used_step) >= params[5])) {
    return { rows: [], rowCount: 0 };
  }
  user.is_2fa_enabled = false;
  user.totp_secret_encrypted = null;
  user.totp_last_used_step = -1;
  return { rows: [{ id: userId }], rowCount: 1 };
}

mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { query }, readPool: { query } },
});
const { twoFactorDisableInternal: disable } = await import('../src/modules/auth/handlers/twoFactorDisable.js');
const { default: authRoutes } = await import('../src/modules/auth/auth.routes.js');
const { twoFactorDisableLimiter } = await import('../src/modules/auth/auth.middleware.js');
let server, baseUrl, accessToken;

before(async () => {
  process.env.JWT_SECRET = 'two-factor-disable-test-secret';
  accessToken = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth/2fa/disable`;
});

beforeEach(() => {
  mock.method(Date, 'now', () => now);
  process.env.TWO_FACTOR_ENCRYPTION_KEY = key;
  user = {
    password_hash: passwordHash, status: 'active', authz_version: 1, is_2fa_enabled: true,
    totp_secret_encrypted: encryptTotpSecret(secret, userId), totp_last_used_step: String(step - 2),
  };
  calls = [];
  beforeUpdate = undefined;
  dbError = null;
  twoFactorDisableLimiter.resetKey(userId);
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
const remove = body => disable({ body }, userId);
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

test('authenticated password and unused code disable 2FA and clear secret and replay state', async () => {
  const res = await request({ password, token: code() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { success: true, message: '2FA disabled' });
  assert.equal(user.is_2fa_enabled, false);
  assert.equal(user.totp_secret_encrypted, null);
  assert.equal(user.totp_last_used_step, -1);
});

test('wrong password and missing, invalid, or out-of-window codes preserve active 2FA', async () => {
  const original = { ...user };
  for (const body of [
    { password: 'wrong', token: code() }, { password }, { password, token: invalidCode() },
    ...[-3, -2, 2, 3].map(code).filter(token => !validCodes().includes(token)).map(token => ({ password, token })),
  ]) {
    await assert.rejects(remove(body), { status: 401 });
  }
  assert.deepEqual(user, original);
  assert.ok(calls.every(call => /^\s*SELECT/.test(call.sql)));
});

test('a code consumed by enrollment or login cannot disable 2FA', async () => {
  user.totp_last_used_step = String(step);
  await assert.rejects(remove({ password, token: code() }), { status: 401 });
  assert.equal(user.is_2fa_enabled, true);
  assert.ok(calls.every(call => /^\s*SELECT/.test(call.sql)));
});

test('passwordless accounts cannot bypass password-based disabling', async () => {
  user.password_hash = null;
  const compare = mock.method(bcrypt, 'compare', () => { throw new Error('bcrypt must not receive null'); });
  const res = await request({ password, token: code() });
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { success: false, message: 'This account does not have a password' });
  assert.equal(compare.mock.callCount(), 0);
  assert.equal(user.is_2fa_enabled, true);
  assert.ok(user.totp_secret_encrypted);
  assert.ok(calls.every(call => /^\s*SELECT/.test(call.sql)));
});

test('password alone cancels unconfirmed setup and works again when already cleared', async () => {
  user.is_2fa_enabled = false;
  await assert.rejects(remove({ password: 'wrong' }), { status: 401 });
  assert.ok(user.totp_secret_encrypted);
  assert.deepEqual(await remove({ password }), { message: '2FA disabled' });
  assert.equal(user.totp_secret_encrypted, null);
  assert.equal(user.totp_last_used_step, -1);
  assert.deepEqual(await remove({ password }), { message: '2FA disabled' });
});

test('invalid request bodies and actor spoofing fail before database access', async () => {
  for (const body of [undefined, {}, { password: '' }, { password: 123 },
    { password: 'x'.repeat(1025) }, { password, token: 123456 },
    { password, token: '12345' }, { password, token: 'abcdef' },
    { password, token: code(), userId: 'other-user' }]) {
    await assert.rejects(remove(body), { status: 400 });
  }
  await assert.rejects(disable({ body: { password, token: code() } }), { status: 401 });
  assert.equal(calls.length, 0);
});

test('missing, invalid, and stale access tokens fail with success false', async () => {
  assert.equal((await request({ password, token: code() }, null)).status, 401);
  assert.equal((await request({ password, token: code() }, 'invalid')).status, 401);
  assert.equal(calls.length, 0);
  user.authz_version = 2;
  assert.equal((await request({ password, token: code() })).status, 401);
  assert.equal(calls.length, 1);
});

test('inactive and missing accounts cannot be changed', async () => {
  user.status = 'disabled';
  await assert.rejects(remove({ password, token: code() }), { status: 401 });
  user = null;
  await assert.rejects(remove({ password, token: code() }), { status: 401 });
});

test('concurrent changes to password, secret, authorization, or consumed code prevent disabling', async () => {
  const original = { ...user };
  for (const changes of [
    { password_hash: 'changed-password-hash' }, { authz_version: 2 },
    { totp_secret_encrypted: encryptTotpSecret(secret, userId) },
    { totp_last_used_step: String(step) }, { status: 'disabled' },
  ]) {
    user = { ...original };
    beforeUpdate = () => Object.assign(user, changes);
    await assert.rejects(remove({ password, token: code() }), { status: 409 });
    assert.equal(user.is_2fa_enabled, true);
    assert.ok(user.totp_secret_encrypted);
  }
});

test('cancelling pending setup cannot disable 2FA enabled during the request', async () => {
  user.is_2fa_enabled = false;
  beforeUpdate = () => { user.is_2fa_enabled = true; };
  await assert.rejects(remove({ password }), { status: 409 });
  assert.equal(user.is_2fa_enabled, true);
  assert.ok(user.totp_secret_encrypted);
});

test('only one simultaneous disable request succeeds', async () => {
  const results = await Promise.allSettled([
    remove({ password, token: code() }), remove({ password, token: code() }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.find(result => result.status === 'rejected').reason.status, 409);
  assert.equal(user.totp_secret_encrypted, null);
});

test('decryption and database errors return generic failures and preserve enabled state', async () => {
  delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
  const res = await request({ password, token: code() });
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { success: false, message: 'Unable to disable two-factor authentication' });
  assert.equal(user.is_2fa_enabled, true);
  assert.ok(user.totp_secret_encrypted);
  dbError = new Error('sensitive internal detail');
  await assert.rejects(remove({ password, token: code() }), {
    status: 500, message: 'Unable to disable two-factor authentication',
  });
});

test('disable attempts are limited by authenticated account', async () => {
  for (let i = 0; i < 5; i++) {
    assert.equal((await request({ password: 'wrong', token: code() })).status, 401);
  }
  assert.equal((await request({ password, token: code() })).status, 429);
  assert.equal(user.is_2fa_enabled, true);
});
