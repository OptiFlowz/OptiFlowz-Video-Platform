import assert from 'node:assert/strict';
import { createDecipheriv, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { after, before, beforeEach, mock, test } from 'node:test';
import bcrypt from 'bcrypt';
import express from 'express';
import jwt from 'jsonwebtoken';
import { encryptTotpSecret } from '../src/modules/auth/helpers/totpSecret.js';

const userId = '12345678-1234-4234-8234-123456789def';
const password = 'current-test-password';
const passwordHash = await bcrypt.hash(password, 4);
const key = randomBytes(32);
const previousKey = process.env.TWO_FACTOR_ENCRYPTION_KEY;
const previousJwtSecret = process.env.JWT_SECRET;
let user, calls, conflict, dbError;

async function query(sql, params) {
  calls.push({ sql, params });
  if (dbError) throw dbError;
  if (/^\s*SELECT/.test(sql)) {
    return { rows: user ? [{ ...user, id: userId }] : [], rowCount: user ? 1 : 0 };
  }
  assert.match(sql, /UPDATE public.users/);
  assert.match(sql, /is_2fa_enabled = false AND status = 'active'/);
  assert.match(sql, /password_hash IS NOT DISTINCT FROM \$3 AND authz_version = \$4/);
  assert.match(sql, /totp_secret_encrypted IS NOT DISTINCT FROM \$5/);
  assert.match(sql, /totp_last_used_step = -1/);
  assert.deepEqual(params.slice(2), [user.password_hash, user.authz_version, user.totp_secret_encrypted, null]);
  if (conflict) return { rows: [], rowCount: 0 };
  user.totp_secret_encrypted = params[1];
  return { rows: [{ id: userId }], rowCount: 1 };
}

mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { query }, readPool: { query } },
});

const { twoFactorSetupInternal: setup } = await import('../src/modules/auth/handlers/twoFactorSetup.js');
const { default: authRoutes } = await import('../src/modules/auth/auth.routes.js');
const { twoFactorSetupLimiter } = await import('../src/modules/auth/auth.middleware.js');
let server, baseUrl, token;

before(async () => {
  process.env.JWT_SECRET = 'two-factor-setup-test-secret';
  token = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/auth/2fa/setup`;
});

beforeEach(() => {
  process.env.TWO_FACTOR_ENCRYPTION_KEY = key.toString('base64');
  user = {
    email: 'member@example.com', password_hash: passwordHash, status: 'active',
    authz_version: 1, is_2fa_enabled: false, totp_secret_encrypted: null,
  };
  calls = [];
  conflict = false;
  dbError = null;
  twoFactorSetupLimiter.resetKey(userId);
});

after(async () => {
  await new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve()));
  for (const [name, value] of [
    ['TWO_FACTOR_ENCRYPTION_KEY', previousKey], ['JWT_SECRET', previousJwtSecret],
  ]) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function decrypt(stored, owner = userId) {
  assert.ok(stored.startsWith('v1.'));
  const payload = Buffer.from(stored.slice(3), 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(`totp:${owner}`));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
}

async function request(body, bearer = token) {
  const response = await fetch(baseUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
    body: JSON.stringify(body),
  });
  assert.equal((await response.clone().json()).success, response.ok);
  return response;
}

test('setup stores recoverable ciphertext and returns a PNG QR and manual key without enabling 2FA', async () => {
  const res = await request({ password });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const result = await res.json();
  assert.match(result.qr, /^data:image\/png;base64,/);
  const png = Buffer.from(result.qr.split(',')[1], 'base64');
  assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(result.manual.codeName, 'OptiFlowz:member@example.com');
  assert.match(result.manual.yourKey, /^[A-Z2-7]+=*$/);
  assert.equal(decrypt(user.totp_secret_encrypted), result.manual.yourKey);
  assert.notEqual(user.totp_secret_encrypted, result.manual.yourKey);
  assert.equal(user.is_2fa_enabled, false);
  assert.deepEqual(Object.keys(result).sort(), ['manual', 'qr', 'success']);
});

test('encryption uses unique IVs and rejects tampering or another account', () => {
  const first = encryptTotpSecret('test-secret', userId);
  const second = encryptTotpSecret('test-secret', userId);
  assert.notEqual(first, second);
  assert.equal(decrypt(first), 'test-secret');
  assert.throws(() => decrypt(first, 'another-user'));
  const bytes = Buffer.from(first.slice(3), 'base64');
  bytes[bytes.length - 1] ^= 1;
  assert.throws(() => decrypt(`v1.${bytes.toString('base64')}`));
});

test('missing and invalid bearer tokens cannot reach setup', async () => {
  assert.equal((await request({ password }, null)).status, 401);
  assert.equal((await request({ password }, 'invalid')).status, 401);
  assert.equal(calls.length, 0);
});

test('invalid bodies and actor spoofing are rejected before querying the database', async () => {
  for (const body of [undefined, {}, { password: '' }, { password: 123 },
    { password: 'a'.repeat(1025) }, { password, userId: 'other-user' }]) {
    await assert.rejects(setup({ body }, userId), { status: 400 });
  }
  await assert.rejects(setup({ body: { password } }), { status: 401 });
  assert.equal(calls.length, 0);
});

test('wrong password, inactive or missing user, and enabled 2FA never update the secret', async () => {
  await assert.rejects(setup({ body: { password: 'wrong' } }, userId), { status: 401 });
  user.is_2fa_enabled = true;
  await assert.rejects(setup({ body: { password } }, userId), { status: 409 });
  user.status = 'disabled';
  await assert.rejects(setup({ body: { password } }, userId), { status: 401 });
  user = null;
  await assert.rejects(setup({ body: { password } }, userId), { status: 401 });
  assert.ok(calls.every(call => /^\s*SELECT/.test(call.sql)));
});

test('missing or malformed encryption keys fail before storing any secret', async () => {
  for (const value of ['', 'invalid', randomBytes(16).toString('base64'), `${key.toString('base64')}!`]) {
    process.env.TWO_FACTOR_ENCRYPTION_KEY = value;
    await assert.rejects(setup({ body: { password } }, userId), { status: 500 });
  }
  assert.equal(user.totp_secret_encrypted, null);
  assert.ok(calls.every(call => /^\s*SELECT/.test(call.sql)));
});

test('passwordless accounts receive a clear setup error without calling bcrypt or changing the secret', async () => {
  user.password_hash = null;
  const compare = mock.method(bcrypt, 'compare', () => { throw new Error('bcrypt must not receive null'); });
  try {
    const res = await request({ password });
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { success: false, message: 'This account does not have a password' });
    assert.equal(compare.mock.callCount(), 0);
    assert.equal(user.totp_secret_encrypted, null);
    assert.ok(calls.every(call => /^\s*SELECT/.test(call.sql)));
  } finally {
    compare.mock.restore();
  }
});

test('a repeated setup replaces an unconfirmed secret', async () => {
  const first = await setup({ body: { password } }, userId);
  const second = await setup({ body: { password } }, userId);
  assert.notEqual(first.manual.yourKey, second.manual.yourKey);
  assert.equal(decrypt(user.totp_secret_encrypted), second.manual.yourKey);
});

test('a concurrent account/setup change returns a conflict instead of a setup response', async () => {
  conflict = true;
  await assert.rejects(setup({ body: { password } }, userId), { status: 409 });
  assert.equal(user.totp_secret_encrypted, null);
});

test('unexpected errors are returned without internal details', async () => {
  delete process.env.TWO_FACTOR_ENCRYPTION_KEY;
  const res = await request({ password });
  assert.equal(res.status, 500);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await res.json(), { success: false, message: 'Unable to set up two-factor authentication' });
  dbError = new Error('sensitive database detail');
  await assert.rejects(setup({ body: { password } }, userId), {
    status: 500, message: 'Unable to set up two-factor authentication',
  });
});

test('setup password attempts are limited by authenticated account', async () => {
  for (let i = 0; i < 5; i++) {
    assert.equal((await request({ password: 'wrong' })).status, 401);
  }
  assert.equal((await request({ password: 'wrong' })).status, 429);
  assert.equal(user.totp_secret_encrypted, null);
});
