import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let options;
let contextOptions;
let pdfOptions;
let kills = 0;
let launches = 0;
let mode = 'success';
let requestRoute;
let websocketRoute;
let resolveLaunch;
let launchStarted;
const server = { wsEndpoint: () => 'ws://127.0.0.1/test', async kill() { kills++; } };
mock.module('playwright', { namedExports: { chromium: {
  async launchServer(value) {
    options = value; launches++;
    launchStarted?.();
    if (mode === 'late-launch') return new Promise(resolve => { resolveLaunch = () => resolve(server); });
    if (mode === 'launch-error') throw new Error('Launch failed');
    return server;
  },
  async connect() {
    return { async newContext(value) {
      contextOptions = value;
      return {
        async route(pattern, handler) { assert.equal(pattern, '**/*'); requestRoute = handler; },
        async routeWebSocket(pattern, handler) { assert.equal(pattern, '**/*'); websocketRoute = handler; },
        setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
        async newPage() { return {
          async emulateMedia() {}, async setContent() { if (mode === 'content-error') throw new Error('Content failed'); },
          async pdf(value) {
            pdfOptions = value;
            if (mode === 'hang') return new Promise(() => {});
            if (mode === 'oversize') return Buffer.alloc(6 * 1024 * 1024);
            return Buffer.from('%PDF-test');
          },
        }; },
      };
    } };
  },
} } });
const { renderCertificatePdf: render, PDF_LIMITS } = await import('../src/modules/certificates/certificate-templates/services/renderCertificatePdf.js');
const document = { html: '<p>Test</p>', format: 'Letter', landscape: false };

test('renderer uses isolated sandboxed browsers, no inherited secrets, disabled JS, blocked network and fixed PDF options', async () => {
  const previous = process.env.CERTIFICATE_TEST_SECRET;
  process.env.CERTIFICATE_TEST_SECRET = 'do-not-inherit';
  try {
    assert.equal((await render(document)).toString(), '%PDF-test');
    assert.equal(options.chromiumSandbox, true);
    assert.equal(options.host, '127.0.0.1');
    assert.equal(options.env.CERTIFICATE_TEST_SECRET, undefined);
    assert.equal(options.env.DATABASE_URL, undefined);
    assert.equal(options.args.includes('--no-sandbox'), false);
    assert.equal(contextOptions.javaScriptEnabled, false);
    assert.equal(contextOptions.serviceWorkers, 'block');
    assert.equal(contextOptions.offline, true);
    assert.equal(contextOptions.acceptDownloads, false);
    let aborted = false, socketClosed = false;
    await requestRoute({ async abort(reason) { aborted = reason === 'blockedbyclient'; } });
    await websocketRoute({ close() { socketClosed = true; } });
    assert.equal(aborted, true);
    assert.equal(socketClosed, true);
    assert.deepEqual(pdfOptions, { format: 'Letter', landscape: false, printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: false, pageRanges: '1', timeout: PDF_LIMITS.timeoutMs });
    assert.equal(kills, 1);
    await render(document);
    assert.equal(launches, 2);
    assert.equal(kills, 2);
  } finally {
    if (previous === undefined) delete process.env.CERTIFICATE_TEST_SECRET; else process.env.CERTIFICATE_TEST_SECRET = previous;
  }
});

test('renderer bounds input/output and releases capacity after errors', async () => {
  const before = launches;
  await assert.rejects(render({ ...document, html: 'x'.repeat(PDF_LIMITS.maxDocumentBytes + 1) }), { status: 422 });
  assert.equal(launches, before);
  mode = 'oversize';
  await assert.rejects(render(document), { status: 422 });
  mode = 'content-error';
  const beforeKill = kills;
  await assert.rejects(render(document), /Content failed/);
  assert.equal(kills, beforeKill + 1);
  mode = 'launch-error';
  await assert.rejects(render(document), /Launch failed/);
  mode = 'success';
  assert.equal((await render(document)).toString(), '%PDF-test');
});

test('renderer kills a hung PDF at the total deadline and rejects excess concurrent work', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  mode = 'hang';
  const pending = render(document);
  const rejected = assert.rejects(pending, { status: 504 });
  await assert.rejects(render(document), { status: 503 });
  const before = kills;
  t.mock.timers.tick(PDF_LIMITS.timeoutMs);
  await rejected;
  assert.equal(kills, before + 1);
  mode = 'success';
  await render(document);
});

test('client cancellation kills Chromium, including a launch completing after abort', async () => {
  const controller = new AbortController();
  controller.abort();
  const before = launches;
  await assert.rejects(render(document, { signal: controller.signal }), { status: 499 });
  assert.equal(launches, before);
  mode = 'late-launch';
  const next = new AbortController();
  const started = new Promise(resolve => { launchStarted = resolve; });
  const pending = render(document, { signal: next.signal });
  const rejected = assert.rejects(pending, { status: 499 });
  await started;
  next.abort();
  await assert.rejects(render(document), { status: 503 });
  const beforeKill = kills;
  resolveLaunch();
  await rejected;
  assert.equal(kills, beforeKill + 1);
  launchStarted = undefined;
  mode = 'success';
  await render(document);
});
