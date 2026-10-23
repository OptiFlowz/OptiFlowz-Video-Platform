const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { QueryClient, QueryClientProvider, useQueryClient } = require('@tanstack/react-query');
const messages = require('../app/locales/en.json');

test('certificate library orders defaults, protects system designs, edits private fields and previews saved PDFs', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/quizzes' });
  const names = ['window', 'document', 'HTMLElement', 'ResizeObserver', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, ResizeObserver: class { observe() {} disconnect() {} }, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = React, { createRoot } = require('react-dom/client');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const requests = [], dirty = [], confirmations = [], cache = new Map();
  let rows = [
    { id: 'private', name: 'A private design', is_system: false, is_default: false, user_id: 'me' },
    { id: 'modern', name: 'Modern', is_system: true, is_default: false, user_id: null },
    { id: 'classic', name: 'Classic', is_system: true, is_default: true, user_id: null },
    { id: 'minimal', name: 'Minimal', is_system: true, is_default: false, user_id: null },
  ].map(row => ({ ...row, description: null, html_template: '<div>{{user.full_name}}</div>', css_template: '.certificate { display: grid; }', page_format: 'Letter', orientation: 'landscape' })), reject = false, allow = true;
  let rejectPdf = false, pdfCount = 0;
  const revoked = [], originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = () => `blob:pdf-${++pdfCount}`; URL.revokeObjectURL = value => revoked.push(value);
  t.after(() => { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; });
  const styles = new Proxy({}, { get: (_, key) => String(key) });
  const tick = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));
  const mocks = {
    '../cssColorEditor/CssColorEditor': { __esModule: true, default: ({ label, value, onChange, disabled }) => React.createElement('textarea', { 'aria-label': label, value, disabled, onChange: event => onChange(event.target.value) }) },
    '~/i18n': { useI18n: () => ({ t: (key, values = {}) => String(messages[key] ?? key).replace(/\{\{param\.(\w+)\}\}/g, (_, name) => values[name] ?? '') }) },
    '~/functions': { getToken: () => 'token' }, '~/env': { env: { apiBaseUrl: 'https://test.local' } }, 'react-router': { useNavigate: () => () => {} }, '~/constants': { AddSVG: '+' },
    '~/API': { fetchApiResponse: async (url, options) => {
      requests.push({ url, ...options });
      assert.equal(options.method, 'POST'); assert.equal(options.body, undefined); assert.equal(options.headers.Authorization, 'Bearer token');
      return { ok: !rejectPdf, status: rejectPdf ? 503 : 200, headers: new Headers({ 'Content-Type': 'application/pdf' }), json: async () => ({ message: 'Renderer busy' }), blob: async () => new Blob(['%PDF-test'], { type: 'application/pdf' }) };
    }, fetchFn: async ({ route, options }) => {
      requests.push({ route, ...options });
      assert.equal(options.headers.Authorization, 'Bearer token');
      assert.ok(route.startsWith('api/certificates/certificate-templates'));
      if (options.method === 'GET' && route.includes('?')) {
        const query = new URL(route, 'https://test.local').searchParams;
        const filtered = Number(query.get('page')) === 1 ? rows.slice(0, 2) : rows.slice(2);
        return { templates: filtered, pagination: { page: Number(query.get('page')), limit: Number(query.get('limit')), total: filtered.length, totalPages: 2, hasNextPage: Number(query.get('page')) === 1 } };
      }
      const id = route.split('/').at(-1);
      if (options.method === 'GET') return { template: rows.find(row => row.id === id) };
      if (reject) throw new Error('HTML template contains disallowed content');
      if (options.method === 'DELETE') { rows = rows.filter(row => row.id !== id); return { success: true, deleted: true }; }
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['name', 'description', 'html_template', 'css_template', 'page_format', 'orientation'].sort());
      if (options.method === 'POST') rows.push({ ...body, id: `template${rows.length}`, is_system: false, is_default: false, user_id: 'me', created_at: '2026-10-22', updated_at: '2026-10-22' });
      else rows = rows.map(row => row.id === id ? { ...row, ...body } : row);
      return { template: options.method === 'POST' ? rows.at(-1) : rows.find(row => row.id === id), success: true };
    } },
    './api': { engineKey: ['quiz-engine'], request: async (route, method, body) => { requests.push({ route, method, body }); return {}; } },
    '~/components/library/pagination': { __esModule: true, default: ({ onPageChange, onLimitChange }) => React.createElement('div', null, React.createElement('button', { onClick: () => onPageChange(2) }, 'Page two'), React.createElement('button', { onClick: () => onLimitChange(10) }, 'Ten rows')) },
    '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async options => { confirmations.push(options); return allow; }, dialogProps: {} }) },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: () => null },
    './EditorPopup': { __esModule: true, default: ({ open, title, children, onClose, onAfterClose }) => { React.useEffect(() => { if (!open) onAfterClose?.(); }, [open]); return open ? React.createElement('div', { role: 'dialog' }, title, React.createElement('button', { onClick: onClose }, 'Close popup'), children) : null; }, EditorActions: ({ children }) => React.createElement('div', null, children) },
    './shared': {
      styles, Field: ({ label, children }) => React.createElement('label', null, label, children),
      Select: ({ label, value, values, onChange }) => React.createElement('select', { 'aria-label': label, value, onChange: e => onChange(e.target.value) }, values.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label))),
      Notice: ({ error }) => error ? React.createElement('p', { role: 'alert' }, error) : null,
      LoadState: ({ query }) => query.isError ? React.createElement('p', { role: 'alert' }, query.error.message) : null,
      useAction: () => { const client = useQueryClient(); const [busy, setBusy] = React.useState(false), [error, setError] = React.useState(''); return { busy, error, run: async work => { setBusy(true); setError(''); try { await work(); } catch (error) { setError(error.message); } finally { await client.invalidateQueries({ queryKey: ['quiz-engine'] }); setBusy(false); } } }; },
    },
  };
  function load(file) {
    file = path.resolve(file); if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => name in mocks ? mocks[name] : name.startsWith('.') ? load(path.join(path.dirname(file), name)) : require(name), mod, mod.exports); return mod.exports;
  }
  const preview = load('app/components/quizEngine/certificatePreview.ts');
  assert.deepEqual(preview.certificatePaper({ page_format: 'Letter', orientation: 'landscape' }), { width: 1056, height: 816 });
  const portrait = preview.certificatePaper({ page_format: 'A4', orientation: 'portrait' });
  assert.ok(portrait.height > portrait.width);
  const safeDocument = preview.certificateHtmlDocument({ ...rows[0], html_template: '<meta http-equiv="refresh" content="0;url=https://example.com"><script>bad()</script><iframe src="https://example.com"></iframe><a href="javascript:bad()" onclick="bad()">{{user.full_name}}</a>', css_template: '</style><script>bad()</script>' });
  assert.ok(!safeDocument.includes('<script>') && !safeDocument.includes('<iframe') && !safeDocument.includes('http-equiv="refresh"') && !safeDocument.includes('onclick='));
  assert.ok(safeDocument.includes('John Anderson') && safeDocument.includes("default-src 'none'"));
  const View = load('app/components/quizEngine/CertificateTemplates.tsx').default;
  let edit, saved;
  const onDirty = value => dirty.push(value), onBusy = () => {};
  const render = async (id = null) => { await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(View, { id, onDirty, onBusy, onEdit: value => { edit = value; }, onSaved: value => { saved = value; } })))); await tick(); };
  const click = async text => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(button, text); assert.equal(button.disabled, false, text); await act(async () => button.click()); await tick(); };
  const fill = async (label, value) => { const input = document.querySelector(`[aria-label="${label}"]`); assert.ok(input, label); await act(async () => { Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); }); };
  const submit = async () => { await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); await tick(); };
  await render();
  assert.deepEqual([...document.querySelectorAll('.certificateCard h2')].map(node => node.textContent), ['Classic', 'Minimal', 'Modern', 'A private design']);
  assert.ok(requests.some(request => request.route?.includes('page=2')), 'system templates from later pages are first globally');
  const thumbnails = [...document.querySelectorAll('.certificateThumbnail iframe')];
  assert.equal(thumbnails.length, 4, 'each card shows its HTML design');
  for (const frame of thumbnails) {
    assert.equal(frame.getAttribute('sandbox'), '');
    assert.equal(frame.tabIndex, -1);
    assert.equal(frame.getAttribute('loading'), 'lazy');
    assert.match(frame.srcdoc, /John Anderson/);
  }
  assert.equal(pdfCount, 0, 'card thumbnails do not request PDF rendering');
  await click('Edit');
  assert.equal(edit, 'classic', 'card action opens its template');

  await fill('Search templates', 'Modern');
  assert.equal(document.querySelectorAll('.certificateCard').length, 1);
  await fill('Search templates', '');
  await render('classic');
  assert.ok(document.querySelector('fieldset').disabled, 'system fields cannot be edited');
  assert.ok(![...document.querySelectorAll('button')].some(button => button.textContent === 'Delete'));
  assert.equal(pdfCount, 0, 'opening a template defaults to HTML without a PDF request');
  assert.match(document.querySelector('iframe').srcdoc, /John Anderson/);
  assert.equal(document.querySelector('iframe').getAttribute('sandbox'), '');
  await click('PDF Preview');
  assert.match(document.querySelector('iframe[title="PDF Preview"]').src, /^blob:pdf-/);
  await click('Create copy');
  assert.equal(rows.at(-1).is_system, false);
  assert.equal(saved, rows.at(-1).id);
  assert.ok(!requests.some(request => request.method === 'PATCH' && request.route?.endsWith('/classic')));

  await render('private');
  assert.ok(!document.querySelector('fieldset').disabled);
  await click('PDF Preview');
  const html = '  <div>{{user.full_name}}</div>\n', css = '.certificate { padding: 12px; }\n';
  await fill('HTML template', html); await fill('CSS styles', css);
  const countBeforeSave = pdfCount;
  reject = true; await submit();
  assert.match(document.querySelector('[role=alert]').textContent, /disallowed content/);
  assert.equal(document.querySelector('[aria-label="HTML template"]').value, html);
  assert.equal(pdfCount, countBeforeSave, 'invalid changes do not render');
  reject = false; await submit();
  assert.equal(rows.find(row => row.id === 'private').html_template, html);
  assert.equal(rows.find(row => row.id === 'private').css_template, css);
  assert.equal(pdfCount, countBeforeSave + 1, 'successful save refreshes the stored PDF');
  assert.ok(revoked.length > 0, 'old preview object URLs are released');
  await fill('HTML template', '<img src="https://example.com/image" onerror="alert(1)">');
  assert.equal(document.querySelector('img'), null, 'source is never injected into the page');
  assert.ok(!document.querySelector('iframe[title="HTML Preview"]').srcdoc.includes('onerror='));
  assert.ok(!document.querySelector('iframe[title="HTML Preview"]').srcdoc.includes('https://example.com/image'));
  const rendersBeforeSwitch = pdfCount;
  await click('HTML Preview'); await click('PDF Preview');
  assert.equal(pdfCount, rendersBeforeSwitch, 'switching tabs reuses the generated PDF');

  await render('minimal');
  rejectPdf = true;
  await render('modern');
  await click('PDF Preview');
  assert.match(document.querySelector('[role=alert]').textContent, /Renderer busy/);
  rejectPdf = false; await click('Retry');
  assert.ok(document.querySelector('iframe'));

  await render('new');
  assert.ok(document.querySelector('iframe[title="HTML Preview"]'), 'new drafts have immediate HTML previews');
  assert.equal(document.querySelector('iframe[title="PDF Preview"]'), null);
  await fill('Template name', 'New certificate'); await fill('HTML template', '<div>{{quiz.title}}</div>');
  await submit(); assert.equal(rows.at(-1).name, 'New certificate');

  await render('private');
  allow = false; await click('Delete'); assert.ok(rows.find(row => row.id === 'private'));
  allow = true; await click('Delete'); assert.ok(!rows.find(row => row.id === 'private'));
  assert.equal(saved, '');

  const QuizView = load('app/components/quizEngine/QuizCertificate.tsx').default;
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(QuizView, { quiz: { id: 'quiz1', has_certificate: false }, editable: true, onDirty }))));
  await act(async () => document.querySelector('input[type=checkbox]').click()); await click('Save changes');
  assert.deepEqual(requests.find(request => request.route === '/quiz1'), { route: '/quiz1', method: 'PATCH', body: { has_certificate: true } });
});
