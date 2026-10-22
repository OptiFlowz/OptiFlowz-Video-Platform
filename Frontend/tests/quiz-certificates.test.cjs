const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { QueryClient, QueryClientProvider, useQueryClient } = require('@tanstack/react-query');
const messages = require('../app/locales/en.json');

test('certificate tab uses supported CRUD, preserves source, handles validation, cancellation and scoped quiz settings', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/quizzes' });
  const names = ['window', 'document', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const { act } = React, { createRoot } = require('react-dom/client');
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [name, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const requests = [], dirty = [], confirmations = [], cache = new Map();
  let rows = [], reject = false, allow = true;
  const styles = new Proxy({}, { get: (_, key) => String(key) });
  const tick = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));
  const mocks = {
    '~/i18n': { useI18n: () => ({ t: (key, values = {}) => String(messages[key] ?? key).replace(/\{\{param\.(\w+)\}\}/g, (_, name) => values[name] ?? '') }) },
    '~/functions': { getToken: () => 'token' }, '~/constants': { AddSVG: '+' },
    '~/API': { fetchFn: async ({ route, options }) => {
      requests.push({ route, ...options });
      assert.equal(options.headers.Authorization, 'Bearer token');
      assert.ok(route.startsWith('api/certificates/certificate-templates'));
      if (options.method === 'GET' && route.includes('?')) {
        const query = new URL(route, 'https://test.local').searchParams;
        const filtered = rows.filter(row => row.name.includes(query.get('name') || ''));
        return { templates: filtered, pagination: { page: Number(query.get('page')), limit: Number(query.get('limit')), total: filtered.length, totalPages: filtered.length ? 1 : 0 } };
      }
      const id = route.split('/').at(-1);
      if (options.method === 'GET') return { template: rows.find(row => row.id === id) };
      if (reject) throw new Error('HTML template contains disallowed content');
      if (options.method === 'DELETE') { rows = rows.filter(row => row.id !== id); return { success: true, deleted: true }; }
      const body = JSON.parse(options.body);
      assert.deepEqual(Object.keys(body).sort(), ['name', 'description', 'html_template', 'css_template', 'page_format', 'orientation'].sort());
      if (options.method === 'POST') rows.push({ ...body, id: 'template1', user_id: 'me', created_at: '2026-10-22', updated_at: '2026-10-22' });
      else rows = rows.map(row => row.id === id ? { ...row, ...body } : row);
      return { template: rows.at(-1), success: true };
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
  const View = load('app/components/quizEngine/QuizCertificate.tsx').default;
  const props = { quiz: { id: 'quiz1', has_certificate: false }, editable: true, onDirty: value => dirty.push(value) };
  const render = async (editable = true) => { await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(View, { ...props, editable })))); await tick(); };
  const click = async text => { const button = [...document.querySelectorAll('button')].find(b => b.textContent === text); assert.ok(button, text); assert.equal(button.disabled, false, text); await act(async () => button.click()); await tick(); };
  const fill = async (label, value) => { const input = document.querySelector(`[aria-label="${label}"]`); assert.ok(input, label); await act(async () => { Object.getOwnPropertyDescriptor(input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new window.Event('input', { bubbles: true })); }); };
  const submit = async () => { await act(async () => document.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))); await tick(); };
  await render();
  assert.match(document.body.textContent, /No certificate templates yet/);
  assert.match(document.body.textContent, /not available yet/);
  await act(async () => document.querySelector('input[type=checkbox]').click()); await click('Save changes');
  assert.deepEqual(requests.find(r => r.route === '/quiz1'), { route: '/quiz1', method: 'PATCH', body: { has_certificate: true } });
  await click('+Create template');
  const html = '  <section><h1>{{recipient_name}}</h1></section>\n', css = '.certificate { display: grid; }\n';
  await fill('Template name', ' Certificate '); await fill('HTML template', html); await fill('CSS styles', css);
  reject = true; await submit();
  assert.match(document.querySelector('[role=alert]').textContent, /disallowed content/);
  assert.equal(document.querySelector('[aria-label="HTML template"]').value, html);
  assert.ok(document.querySelector('[role=dialog]'));
  reject = false; await submit();
  assert.equal(document.querySelector('[role=dialog]'), null);
  assert.equal(rows[0].name, 'Certificate'); assert.equal(rows[0].html_template, html); assert.equal(rows[0].css_template, css);
  assert.equal(rows[0].page_format, 'A4'); assert.equal(rows[0].orientation, 'landscape');
  await click('Edit');
  assert.ok(requests.some(r => r.method === 'GET' && r.route.endsWith('/template1')));
  await fill('HTML template', '<img src="https://example.com/image" onerror="alert(1)">');
  assert.equal(document.querySelector('img'), null, 'template content is edited as text, never executed');
  allow = false; await click('Close popup'); assert.ok(document.querySelector('[role=dialog]'));
  allow = true; await click('Close popup'); assert.equal(document.querySelector('[role=dialog]'), null);
  await click('Edit'); await fill('Template name', 'Updated'); await fill('CSS styles', ''); await submit();
  assert.equal(rows[0].name, 'Updated'); assert.equal(rows[0].css_template, '');
  assert.ok(requests.some(r => r.method === 'PATCH' && r.route.endsWith('/template1')));
  await fill('Search templates', 'other'); await tick(); assert.ok(!document.querySelector('article'));
  assert.ok(requests.some(r => r.route.includes('name=other')));
  await fill('Search templates', ''); await tick(); await click('Ten rows');
  assert.ok(requests.some(r => r.route.includes('limit=10')));
  allow = false; await click('Delete'); assert.equal(rows.length, 1);
  allow = true; await click('Delete'); assert.equal(rows.length, 0);
  assert.ok(confirmations.some(c => c.message?.includes('Updated')));
  await render(false); assert.equal(document.querySelector('input[type=checkbox]').disabled, true);
});
