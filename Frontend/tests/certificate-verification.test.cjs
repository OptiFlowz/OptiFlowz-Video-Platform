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
    '~/constants': { DownloadSVG: null, CheckSVG: null },
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
  assert.ok(html.includes(`https://api.example.test/api/certificates/${certificate.id}/pdf`));
  assert.match(html, /data-preview=/);
  result = { data: { certificate: { ...certificate, status: 'revoked', revoked_at: '2026-10-27' } } };
  html = renderToStaticMarkup(React.createElement(Page));
  assert.match(html, /certificateRevoked/);
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
