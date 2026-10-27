import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mock, test } from 'node:test';
import rateLimit from 'express-rate-limit';
import { resetLimiter, resetRequestLimiter, resetVerifyLimiter } from '../src/modules/auth/auth.middleware.js';

// Exercise the real app middleware order without loading databases or external APIs.
mock.module(new URL('../src/routes/index.js', import.meta.url).href, {
  namedExports: { registerRoutes(app) {
    const identity = (req, res) => res.json({ ip: req.ip, ips: req.ips, secure: req.secure });
    app.get('/ip', identity);
    app.get('/limited', rateLimit({ windowMs: 60_000, limit: 1 }), identity);
    app.post('/reset', resetLimiter, identity);
    app.post('/reset-request', resetRequestLimiter, identity);
    app.post('/reset-verify', resetVerifyLimiter, identity);
  } },
});
const { createApp } = await import('../src/app.js');
// Let Node emit module-mocking warnings before capturing application errors.
await new Promise(resolve => setImmediate(resolve));

async function start(t, onFly = true) {
  const previous = process.env.FLY_APP_NAME;
  let app;
  try {
    if (onFly) process.env.FLY_APP_NAME = 'proxy-test';
    else delete process.env.FLY_APP_NAME;
    app = createApp();
  } finally {
    if (previous === undefined) delete process.env.FLY_APP_NAME;
    else process.env.FLY_APP_NAME = previous;
  }
  const errors = t.mock.method(console, 'error', () => {});
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    assert.deepEqual(errors.mock.calls.map(call => call.arguments), [], 'no rate-limit validation errors');
  });
  return (path, headers = {}, body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

test('Fly client IP wins over spoofed XFF and the app public IP; HTTPS is preserved', async t => {
  const request = await start(t);
  const response = await request('/ip', {
    'fly-client-ip': '198.51.100.10',
    'x-forwarded-for': '203.0.113.99, 198.51.100.10, 192.0.2.1',
    'x-forwarded-proto': 'https',
  });
  assert.deepEqual(await response.json(), { ip: '198.51.100.10', ips: ['198.51.100.10'], secure: true });
});

test('changing spoofed XFF cannot bypass the default limiter; clients have separate quotas', async t => {
  const request = await start(t);
  const headers = { 'fly-client-ip': '198.51.100.10', 'x-forwarded-for': '203.0.113.1' };
  assert.equal((await request('/limited', headers)).status, 200);
  assert.equal((await request('/limited', { ...headers, 'x-forwarded-for': '203.0.113.2' })).status, 429);
  assert.equal((await request('/limited', { ...headers, 'fly-client-ip': '198.51.100.11' })).status, 200);
});

test('missing Fly header uses the socket and does not trust XFF', async t => {
  const request = await start(t);
  const response = await request('/ip', { 'x-forwarded-for': '203.0.113.1' });
  assert.equal((await response.json()).ip, '127.0.0.1');
  assert.equal((await request('/limited', { 'x-forwarded-for': '203.0.113.1' })).status, 200);
  assert.equal((await request('/limited', { 'x-forwarded-for': '203.0.113.2' })).status, 429);
});

test('invalid or multiple Fly client addresses cannot become rate-limit keys', async t => {
  const request = await start(t);
  for (const value of ['invalid', '', '198.51.100.1:1234', '198.51.100.1, 198.51.100.2']) {
    assert.equal((await request('/limited', { 'fly-client-ip': value })).status, 400);
  }
});

test('outside Fly, client-supplied proxy headers do not change IP or protocol', async t => {
  const request = await start(t, false);
  const response = await request('/ip', {
    'fly-client-ip': '198.51.100.10', 'x-forwarded-for': '203.0.113.1', 'x-forwarded-proto': 'https',
  });
  assert.deepEqual(await response.json(), { ip: '127.0.0.1', ips: [], secure: false });
});

test('default limiter groups IPv6 clients by subnet', async t => {
  const request = await start(t);
  assert.equal((await request('/limited', { 'fly-client-ip': '2001:db8:1234:5600::1' })).status, 200);
  assert.equal((await request('/limited', { 'fly-client-ip': '2001:db8:1234:56ff::2' })).status, 429);
  assert.equal((await request('/limited', { 'fly-client-ip': '2001:db8:1234:5700::1' })).status, 200);
});

for (const path of ['/reset', '/reset-request', '/reset-verify']) {
  test(`${path} limits repeated requests, separates IPs and groups IPv6 subnets`, async t => {
    const request = await start(t);
    const body = { email: 'proxy-test@example.com', token: 'TOKEN' };
    const send = (ip, spoof = '203.0.113.1') => request(path, {
      'fly-client-ip': ip, 'x-forwarded-for': spoof,
    }, body);
    assert.equal((await send('198.51.100.20')).status, 200);
    assert.equal((await send('198.51.100.20', '203.0.113.2')).status, 429);
    assert.equal((await send('198.51.100.21')).status, 200);
    assert.equal((await send('2001:db8:abcd:1200::1')).status, 200);
    assert.equal((await send('2001:db8:abcd:12ff::2')).status, 429);
    assert.equal((await send('2001:db8:abcd:1300::1')).status, 200);
  });
}
