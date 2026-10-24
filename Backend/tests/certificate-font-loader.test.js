import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mock, test } from 'node:test';

let addresses = [{ address: '8.8.8.8', family: 4 }];
let dnsCalls = 0;
let requests = [];
let status = 200;
let contentType = 'font/woff2';
const font = Buffer.concat([Buffer.from('wOF2'), Buffer.alloc(44)]);
let payload = font;
mock.module('node:dns', { namedExports: { lookup(_hostname, options, callback) {
  assert.equal(options.all, true);
  dnsCalls++;
  queueMicrotask(() => callback(null, addresses));
} } });
mock.module('node:https', { namedExports: { request(url, options, callback) {
  requests.push({ url: url.href, options });
  const req = new EventEmitter();
  req.end = () => options.lookup(url.hostname, { all: true }, (error, result) => {
    if (error) { req.emit('error', error); return; }
    assert.deepEqual(result, addresses);
    const response = new PassThrough();
    response.statusCode = status;
    response.headers = { 'content-type': contentType };
    callback(response);
    if (!response.destroyed) response.end(payload);
  });
  return req;
} } });
const { isPublicFontAddress, fetchFontResource, createCertificateFontLoader } = await import('../src/modules/certificates/certificate-templates/services/certificateFontLoader.js');

test('font network access rejects private, loopback, reserved and mapped addresses', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.100.100.200',
    '0.0.0.0', '224.0.0.1', '192.0.2.1', '::1', '::ffff:127.0.0.1', 'fc00::1', 'fe80::1', '2002:7f00:1::', '2001:db8::1']) {
    assert.equal(isPublicFontAddress(address), false, address);
  }
  for (const address of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isPublicFontAddress(address), true, address);
  const before = requests.length;
  for (const url of ['http://example.com/font', 'file:///tmp/font', 'https://127.0.0.1/font', 'https://2130706433/font',
    'https://[::ffff:127.0.0.1]/font', 'https://localhost/font', 'https://example.com:8443/font', 'https://u:p@example.com/font']) {
    await assert.rejects(fetchFontResource(url), { status: 422 }, url);
  }
  assert.equal(requests.length, before);
  addresses = [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.1', family: 4 }];
  await assert.rejects(fetchFontResource('https://mixed.example.com/font'), { status: 422 });
  addresses = [{ address: '8.8.8.8', family: 4 }];
});

test('loader pins validated DNS, follows no redirects, forwards no credentials and bounds response bytes', async () => {
  dnsCalls = 0;
  requests = [];
  const bytes = await fetchFontResource('https://cdn.example.com/font.woff2');
  assert.deepEqual(bytes, font);
  assert.equal(dnsCalls, 1);
  assert.equal(requests[0].options.agent, false);
  assert.equal(requests[0].options.headers.authorization, undefined);
  assert.equal(requests[0].options.headers.cookie, undefined);
  assert.ok(requests[0].options.signal instanceof AbortSignal);
  status = 302;
  const count = requests.length;
  await assert.rejects(fetchFontResource('https://cdn.example.com/redirect'), { status: 422 });
  assert.equal(requests.length, count + 1);
  status = 200;
  await assert.rejects(fetchFontResource('https://cdn.example.com/big.woff2', { maxBytes: 8 }), { status: 422 });
});

test('browser requests can load only registered synthetic font URLs, with caching and signature validation', async () => {
  const loader = createCertificateFontLoader({ fontSources: ['https://cdn.example.com/font.woff2'] });
  let aborted = 0, fulfilled = 0;
  const route = (url, type) => ({
    request: () => ({ url: () => url, resourceType: () => type }),
    async abort() { aborted++; },
    async fulfill(response) { assert.deepEqual(response.body, font); assert.equal(response.contentType, 'font/woff2'); fulfilled++; },
  });
  const before = requests.length;
  await loader.route(route('https://cdn.example.com/font.woff2', 'font'));
  await loader.route(route('https://certificate-fonts.invalid/0', 'image'));
  await loader.route(route('https://certificate-fonts.invalid/100', 'font'));
  assert.equal(requests.length, before);
  await loader.route(route('https://certificate-fonts.invalid/0', 'font'));
  await loader.route(route('https://certificate-fonts.invalid/0', 'font'));
  assert.equal(requests.length, before + 1);
  assert.equal(aborted, 3);
  assert.equal(fulfilled, 2);
  assert.doesNotThrow(() => loader.check());
  payload = Buffer.from('<html>Not a font</html>');
  const invalid = createCertificateFontLoader({ fontSources: ['https://cdn.example.com/bad'] });
  await invalid.route(route('https://certificate-fonts.invalid/0', 'font'));
  assert.throws(() => invalid.check(), { status: 422 });
  payload = font;
});

test('Google stylesheets can supply only validated font-face rules and cannot import more stylesheets', async () => {
  contentType = 'text/css; charset=utf-8';
  const document = { fontStylesheets: ['https://fonts.googleapis.com/css2?family=Roboto'] };
  payload = Buffer.from("@font-face {font-family:Roboto;src:url('https://fonts.gstatic.com/font.woff2') format('woff2')}");
  const css = await createCertificateFontLoader(document).stylesheet();
  assert.match(css, /https:\/\/certificate-fonts.invalid\/0/);
  assert.doesNotMatch(css, /fonts.gstatic.com/);
  for (const invalid of ['body {color:red}', "@import 'https://fonts.googleapis.com/css2?family=Other';",
    '@font-face {font-family:X;src:url(file:///etc/passwd)}', '</style><script>alert(1)</script>']) {
    payload = Buffer.from(invalid);
    await assert.rejects(createCertificateFontLoader(document).stylesheet(), { status: 422 });
  }
  contentType = 'text/html';
  await assert.rejects(createCertificateFontLoader(document).stylesheet(), { status: 422 });
  contentType = 'font/woff2'; payload = font;
});
