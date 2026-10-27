const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(name, mocks) {
  const file = path.resolve(__dirname, '../app/components/accountPage', name);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', code)(name => {
    if (name in mocks) return mocks[name];
    if (name.endsWith('.css')) return { default: {} };
    return require(name);
  }, mod, mod.exports);
  return mod.exports;
}
const certificate = {
  id: 'a89f4dc1-384d-4ed0-8b1b-dfe16a0f2b79',
  certificate_number: 'CERT-2026-000001',
  issued_at: '2026-10-26T12:00:00Z', status: 'issued',
  quiz_title: 'Changed current title',
  data_snapshot: { quiz: { title: 'Original issued title' } },
};

test('public certificate detail is fetched without a token and missing IDs are not retried', async () => {
  let request;
  const { publicCertificateQuery } = load('accountQueries.ts', {
    '~/API': { fetchFn: async options => { request = options; return { certificate }; } },
    '../library/infiniteResults': {},
  });
  const query = publicCertificateQuery(certificate.id);
  const signal = new AbortController().signal;
  assert.equal(query.enabled, true);
  assert.deepEqual(await query.queryFn({ signal }), { certificate });
  assert.equal(request.route, `api/certificates/${certificate.id}`);
  assert.equal(request.options.headers, undefined);
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.signal, signal);
  assert.equal(request.handleUnauthorizedLocally, true);
  assert.equal(query.retry(0, { status: 404 }), false);
  assert.equal(query.retry(0, { status: 400 }), false);
  assert.equal(publicCertificateQuery(undefined).enabled, false);
});

test('verification page shows saved preview, current revoked status, public PDF and missing/error states', () => {
  let result = { data: { certificate }, isPending: false, isError: false };
  const Page = load('certificateVerification.tsx', {
    '@tanstack/react-query': { useQuery: () => result },
    'react-router': { useParams: () => ({ certificateId: certificate.id }) },
    '~/i18n': { useI18n: () => ({ t: key => key, locale: 'en' }) },
    '~/constants': { DownloadSVG: null, CheckSVG: null, CloseSVG: React.createElement('svg', { 'data-icon': 'close' }) },
    '~/API': { fetchApiResponse: async () => {} },
    '../loaders/pageLoader': { default: () => null, __esModule: true },
    '../analytics/PdfGenerationStatus': { PdfGenerationStatus: () => null },
    './certificatePdf': load('certificatePdf.ts', {}),
    '~/env': { env: { apiBaseUrl: 'https://api.example.test' } },
    './accountQueries': { publicCertificateQuery: () => ({}) },
    './issuedCertificatePreview': {
      IssuedPreview: ({ certificate }) => React.createElement('div', { 'data-preview': certificate.id }),
      issuedDate: value => value,
    },
  }).default;
  let html = renderToStaticMarkup(React.createElement(Page));
  assert.match(html, /Original issued title/);
  assert.doesNotMatch(html, /Changed current title/);
  assert.match(html, /certificateIssued/);
  assert.match(html, /<button[^>]*aria-busy="false"[^>]*>.*analyticsDownloadPdf/);
  assert.match(html, /data-preview=/);
  result = { data: { certificate: { ...certificate, status: 'revoked', revoked_at: '2026-10-27' } } };
  html = renderToStaticMarkup(React.createElement(Page));
  assert.match(html, /certificateRevoked/);
  assert.match(html, /data-icon="close"/);
  assert.doesNotMatch(html, /analyticsDownloadPdf|download=/);
  assert.match(html, /2026-10-27/);
  for (const status of [400, 404, 500]) {
    result = { isError: true, error: { status } };
    html = renderToStaticMarkup(React.createElement(Page));
    assert.match(html, status === 500 ? /searchLoadFailed/ : /errorNotFound/);
    assert.doesNotMatch(html, /data-preview=|\/pdf/);
  }
});

test('certificate card title is a full-card link to verification instead of a popup action', () => {
  const Cards = load('accountCertificates.tsx', {
    '@tanstack/react-query': {
      useInfiniteQuery: () => ({ data: { pages: [{ certificates: [certificate] }] } }),
      useQuery: () => ({ data: { certificate } }),
    },
    'react-router': { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
    '~/functions': { getToken: () => 'token' },
    '~/i18n': { useI18n: () => ({ t: key => key, locale: 'en' }) },
    './accountQueries': { accountCertificatesQuery: () => ({}), accountCertificateQuery: () => ({}) },
    './issuedCertificatePreview': { IssuedPreview: () => null, issuedDate: value => value },
    '../library/infiniteScroll': { default: () => null, __esModule: true },
    '../library/infiniteResults': { uniqueResults: items => items },
  }).default;
  const html = renderToStaticMarkup(React.createElement(Cards));
  assert.ok(html.includes(`href="/certificates/verify/${certificate.id}"`));
  assert.doesNotMatch(html, /<button|dialog/);
  const css = fs.readFileSync(path.resolve(__dirname, '../app/components/accountPage/accountCertificates.module.css'), 'utf8');
  assert.match(css, /\.title::after\s*\{[^}]*inset:\s*0/);
});

test('PDF filenames preserve the issued title and number and remove unsafe filename characters', () => {
  const { certificatePdfFilename } = load('certificatePdf.ts', {});
  assert.equal(certificatePdfFilename('Test quiz', certificate.certificate_number), 'Test quiz - CERT-2026-000001.pdf');
  assert.equal(certificatePdfFilename('Čestitamo / Surgery: "Basics"?', 'CERT-2026-000001'), 'Čestitamo Surgery Basics - CERT-2026-000001.pdf');
  assert.equal(certificatePdfFilename('...', ''), 'Certificate.pdf');
  assert.equal(certificatePdfFilename('CON', ''), '_CON.pdf');
  assert.ok(certificatePdfFilename('x'.repeat(400), certificate.certificate_number).length < 180);
});

for (const mode of ['client', 'server-fallback']) test(`${mode} PDF download preserves its filename, retry link and navigation cleanup`, async () => {
  const { JSDOM } = await import('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' });
  const previous = { window: global.window, document: global.document, act: global.IS_REACT_ACT_ENVIRONMENT, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  const revoked = [];
  const downloads = [];
  let storedFile;
  URL.createObjectURL = file => { storedFile = file; return 'blob:certificate'; };
  URL.revokeObjectURL = url => revoked.push(url);
  window.open = () => { throw new Error('Must not open an about:blank tab'); };
  window.HTMLAnchorElement.prototype.click = function () { downloads.push([this.href, this.download]); };
  let request;
  let finish;
  let requests = 0;
  let localRequests = 0;
  let localSignal;
  let fail = true;
  let id = certificate.id;
  let status = 'issued';
  const Page = load('certificateVerification.tsx', {
    '@tanstack/react-query': { useQuery: () => ({ data: { certificate: { ...certificate, id, status } } }) },
    'react-router': { useParams: () => ({ certificateId: id }) },
    '~/i18n': { useI18n: () => ({ t: key => key, locale: 'en' }) },
    '~/constants': { DownloadSVG: null, CheckSVG: null, CloseSVG: React.createElement('svg', { 'data-icon': 'close' }) },
    '~/env': { env: { apiBaseUrl: 'https://api.example.test' } },
    '~/API': { fetchApiResponse: async (...args) => {
      requests++;
      request = args;
      if (fail) return { ok: false };
      return { ok: true, blob: () => new Promise(resolve => { finish = () => resolve(new Blob(['%PDF-test'])); }) };
    } },
    './generateCertificatePdf': { generateCertificatePdf: async (saved, signal) => {
      localRequests++;
      localSignal = signal;
      assert.equal(saved.data_snapshot.quiz.title, 'Original issued title');
      if (fail || mode === 'server-fallback') throw new Error('Client capture unavailable');
      return new Promise(resolve => { finish = () => resolve(new Blob(['%PDF-client-test'])); });
    } },
    './accountQueries': { publicCertificateQuery: () => ({}) },
    './issuedCertificatePreview': { IssuedPreview: () => null, issuedDate: value => value },
    './certificatePdf': load('certificatePdf.ts', {}),
    '../analytics/PdfGenerationStatus': { PdfGenerationStatus: ({ labels }) => React.createElement('div', { role: 'status', 'data-generating': true }, labels.generating) },
  }).default;
  try {
    await React.act(async () => root.render(React.createElement(Page)));
    await React.act(async () => document.querySelector('button').click());
    assert.match(document.querySelector('[role="alert"]').textContent, /editorGenerateFailed/);
    assert.equal(document.querySelector('button').disabled, false, 'network failure allows a retry');
    fail = false;
    await React.act(async () => {
      const button = document.querySelector('button');
      button.click();
      button.click();
    });
    assert.equal(localRequests, 2, 'the two rapid retry clicks generate only one PDF');
    assert.equal(requests, mode === 'client' ? 1 : 2, 'successful client rendering never calls the PDF endpoint');
    assert.ok(document.querySelector('[data-generating]'), 'loader renders in the active document');
    assert.ok(document.querySelector('main').hasAttribute('inert'));
    assert.equal(request[0], `https://api.example.test/api/certificates/${certificate.id}/pdf`);
    assert.equal(request[1].method, 'GET');
    assert.equal(request[1].headers, undefined);
    assert.equal(request[2], true);
    await React.act(async () => finish());
    const filename = 'Original issued title - CERT-2026-000001.pdf';
    assert.equal(storedFile.name, filename);
    assert.equal(storedFile.type, 'application/pdf');
    assert.deepEqual(downloads, [['blob:certificate', filename]]);
    const link = document.querySelector('a[download]');
    assert.equal(link.download, filename);
    assert.equal(link.href, 'blob:certificate');
    assert.equal(document.querySelector('[data-generating]'), null);
    assert.equal(document.querySelector('main').hasAttribute('inert'), false);
    assert.deepEqual(revoked, [], 'download remains usable even after the async click');
    link.click();
    assert.equal(downloads.length, 2);
    assert.equal(localRequests, 2, 'manual retry reuses the generated PDF');
    status = 'revoked';
    await React.act(async () => root.render(React.createElement(Page)));
    assert.equal(document.querySelector('a[download], button'), null, 'revocation removes a prepared download');
    assert.deepEqual(revoked, ['blob:certificate']);
    status = 'issued';
    id = 'another-certificate';
    await React.act(async () => root.render(React.createElement(Page)));
    assert.deepEqual(revoked, ['blob:certificate']);
    assert.equal(document.querySelector('a[download]'), null);
    await React.act(async () => document.querySelector('button').click());
    const signal = mode === 'client' ? localSignal : request[1].signal;
    status = 'revoked';
    await React.act(async () => root.render(React.createElement(Page)));
    assert.equal(signal.aborted, true, 'revoking the certificate aborts generation');
    assert.equal(document.querySelector('a[download], button'), null);
    await React.act(async () => root.unmount());
    await React.act(async () => finish());
    assert.equal(downloads.length, 2, 'a late response cannot download the previous certificate');
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
    global.window = previous.window;
    global.document = previous.document;
    global.IS_REACT_ACT_ENVIRONMENT = previous.act;
    URL.createObjectURL = previous.create;
    URL.revokeObjectURL = previous.revoke;
  }
});


test('local PDF renderer rejects revoked certificates before creating a capture document', async () => {
  const { generateCertificatePdf } = load('generateCertificatePdf.ts', {
    '../quizEngine/certificatePreview': {}, './issuedCertificateDocument': {},
  });
  await assert.rejects(generateCertificatePdf({ ...certificate, status: 'revoked' }, new AbortController().signal), /Revoked certificates/);
});

test('shared certificate preview blurs revoked documents and presents a localized overlay', () => {
  const Preview = load('issuedCertificatePreview.tsx', {
    '@tanstack/react-query': { useQuery: () => ({ data: '<p>Issued snapshot</p>' }) },
    '~/i18n': { useI18n: () => ({ t: key => key }) },
    '~/constants': { CloseSVG: React.createElement('svg', { 'data-icon': 'close' }) },
    './issuedCertificateDocument': {},
    '../quizEngine/certificatePreview': { certificatePaper: () => ({ width: 1056, height: 816 }) },
    './accountCertificates.module.css': { __esModule: true, default: { previewContent: 'previewContent', blurredPreview: 'blurredPreview', revokedOverlay: 'revokedOverlay' } },
  }).IssuedPreview;
  const revoked = renderToStaticMarkup(React.createElement(Preview, { certificate: { ...certificate, status: 'revoked' } }));
  assert.match(revoked, /blurredPreview/);
  assert.match(revoked, /aria-hidden="true" inert=""/);
  assert.match(revoked, /revokedOverlay/);
  assert.match(revoked, /certificateRevoked/);
  assert.match(revoked, /data-icon="close"/);
  const issued = renderToStaticMarkup(React.createElement(Preview, { certificate }));
  assert.doesNotMatch(issued, /blurredPreview|revokedOverlay|certificateRevoked/);
});
