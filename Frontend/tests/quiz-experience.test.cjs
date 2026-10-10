const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
const project = path.resolve(__dirname, '..');
const messages = require('../app/locales/en.json');
const translate = (key, params = {}) => String(messages[key] ?? key).replace(/\{\{param\.(\w+)\}\}/g, (_, name) => params[name] ?? '');
const tick = () => act(() => new Promise(resolve => setTimeout(resolve, 30)));
const attempt = (number, extra = {}) => ({ id: `attempt-${number}`, attempt_number: number, status: 'submitted', passed: true, score_points: '1.00', max_points: '1.00', score_percentage: '100.00', started_at: '2026-10-01T10:00:00Z', submitted_at: '2026-10-01T10:10:00Z', expires_at: null, answer_review_mode: 'at_end', ...extra });
const questions = [
  { question_id: 'q1', attempt_question_id: 'aq1', attempt_position: 1, question_text: 'Single answer question', question_type: 'single_choice', options: [{ id: 'one', option_text: 'First answer' }, { id: 'two', option_text: 'Second answer' }] },
  { question_id: 'q2', attempt_question_id: 'aq2', attempt_position: 2, question_text: 'Multiple answer question', question_type: 'multiple_choice', options: [{ id: 'three', option_text: 'Third answer' }, { id: 'four', option_text: 'Fourth answer' }] },
  { question_id: 'q3', attempt_question_id: 'aq3', attempt_position: 3, question_text: 'Matching question', question_type: 'matching', left_items: [{ id: 'left', left_text: 'Left concept', position: 1 }], right_items: [{ id: 'right', right_text: 'Right concept', position: 1 }] },
];

async function mount(t, { attempts = [], maxAttempts = 0, eligible = true } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/quiz/quiz-1', pretendToBeVisual: true });
  const descriptors = new Map();
  for (const name of ['window', 'document', 'navigator', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'IntersectionObserver']) {
    descriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: dom.window[name] });
  }
  const observers = new Set();
  globalThis.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  };
  const intersect = async () => {
    await act(async () => { for (const observer of [...observers]) observer.callback([{ isIntersecting: true }]); });
    await tick();
  };
  window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const requests = [];
  const active = attempts.find(a => a.status === 'in_progress') ?? attempt(1, { status: 'in_progress', passed: null });
  let submitted = false;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const mocks = {
    '~/i18n': { useI18n: () => ({ t: translate, locale: 'en' }) },
    '~/authorization/authorization': { useAuthorization: () => ({ can: () => true }) },
    '~/authorization/permissions': { P: { quizzesCertificates: 'certificate' } },
    '~/functions': { getToken: () => '', formatDescription: text => text, appendFromQuizParam: text => text, QUIZ_RETURN_PATH_STORAGE_KEY: 'quiz-return' },
    '~/components/shared/videoMedia': { getVideoThumbnail: () => '' },
    '~/components/customSelect/customSelect': { default: ({ options, value, onChange, disabled, ariaLabel }) => React.createElement('select', { value, disabled, 'aria-label': ariaLabel, onChange: e => onChange(e.target.value) }, options.map(o => React.createElement('option', { key: o.value, value: o.value }, o.label))) },
    'react-router': { useLocation: () => ({ pathname: '/quiz/quiz-1', search: '' }), useNavigate: () => () => {}, useParams: () => ({ quizId: 'quiz-1' }), Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children) },
    '~/API': { fetchFn: async ({ route, options }) => {
      requests.push({ route, ...options });
      if (route.endsWith('/details')) return { quiz: { id: 'quiz-1', title: 'Surgical knowledge', description: '', has_certificate: false, question_count: 3, time_limit_seconds: 0, max_attempts: maxAttempts, passing_score_percentage: '50.00' } };
      if (route.endsWith('/attempts')) return { attempts };
      if (route.endsWith('/requirements')) return { success: true, hasMetRequirements: eligible };
      if (route.endsWith('/requirements/videos')) return { requirements: [] };
      if (route.endsWith('/attempt/start')) return { success: true, attempt: active };
      if (route.endsWith('/questions')) return { attempt: submitted ? { ...active, status: 'submitted', score_points: 0, max_points: 3, score_percentage: 0, passed: false } : attempts.find(a => route.includes(a.id)) ?? active, questions };
      if (route.endsWith('/answer')) return { success: true, saved: true };
      if (route.endsWith('/submit')) { submitted = true; return { success: true, attempt: { ...active, status: 'submitted', score_percentage: 0, passed: false } }; }
      throw new Error(`Unexpected request: ${route}`);
    } },
  };
  const cache = new Map();
  function load(file) {
    if (!path.extname(file)) file += fs.existsSync(`${file}.ts`) ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (mocks[name]) return { __esModule: true, ...mocks[name] };
      if (name.endsWith('.css')) return {};
      if (name.startsWith('~/')) return load(path.join(project, 'app', name.slice(2)));
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    }, mod, mod.exports);
    return mod.exports;
  }
  const View = load(path.join(project, 'app/components/playPage/playerCollection/videoQuizPage.tsx')).default;
  const container = document.getElementById('root');
  const root = createRoot(container);
  t.after(async () => {
    await act(async () => root.unmount()); queryClient.clear(); dom.window.close();
    for (const [name, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    delete globalThis.IS_REACT_ACT_ENVIRONMENT;
  });
  await act(async () => root.render(React.createElement(QueryClientProvider, { client: queryClient }, React.createElement(View))));
  await tick(); await tick();
  const click = async (text) => {
    const button = [...container.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || b.textContent.trim()) === text);
    assert.ok(button, `Button exists: ${text}`); assert.equal(button.disabled, false);
    await act(async () => button.click()); await tick();
  };
  return { container, click, requests, intersect, observers };
}

test('attempt history appends on scroll without duplicates and keeps ungraded attempts distinct', async t => {
  const attempts = Array.from({ length: 13 }, (_, i) => attempt(i + 1));
  attempts[12] = attempt(13, { passed: null, score_points: null, max_points: null });
  const { container, click, intersect, observers } = await mount(t, { attempts });
  const titles = () => [...container.querySelectorAll('.videoQuizAttemptText strong')].map(el => el.textContent);
  assert.deepEqual(titles(), ['Attempt 13', 'Attempt 12', 'Attempt 11', 'Attempt 10', 'Attempt 9']);
  assert.equal(container.querySelector('.videoQuizAttemptStatus').textContent, 'Not checked');
  await intersect();
  assert.deepEqual(titles(), Array.from({ length: 10 }, (_, i) => `Attempt ${13 - i}`));
  // The shared control also retains a keyboard-accessible fallback.
  await click(translate('more'));
  assert.deepEqual(titles(), Array.from({ length: 13 }, (_, i) => `Attempt ${13 - i}`));
  assert.equal(observers.size, 0);
  assert.ok(!container.querySelector('.pagination'));
});

test('an existing attempt can resume at the attempt limit without starting a new attempt', async t => {
  const { container, click, requests } = await mount(t, { attempts: [attempt(1, { status: 'in_progress', passed: null })], maxAttempts: 1 });
  await click('Continue quiz');
  assert.match(container.textContent, /Single answer question/);
  assert.ok(!requests.some(r => r.route.endsWith('/attempt/start')));
});

test('single, multiple and matching answers retain API payloads and a zero result remains visible', async t => {
  const { container, click, requests } = await mount(t);
  await click('Start quiz');
  await click('AFirst answer');
  assert.equal(container.querySelector('.videoQuizOption').getAttribute('aria-pressed'), 'true');
  await click('Next Question');
  await click('AThird answer'); await click('BFourth answer');
  await click('Next Question');
  const select = container.querySelector('.videoQuizSelect select');
  await act(async () => { select.value = 'right'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await click('Review Attempt');
  const saves = requests.filter(r => r.method === 'PUT').map(r => JSON.parse(r.body));
  assert.deepEqual(saves, [{ answer: { option_ids: ['one'] } }, { answer: { option_ids: ['three', 'four'] } }, { answer: { pairs: [{ left_pair_id: 'left', right_pair_id: 'right' }] } }]);
  await click('Finish attempt');
  assert.equal(container.querySelector('.videoQuizResultScore strong').textContent, '0%');
  assert.ok(![...container.querySelectorAll('a')].some(a => a.textContent === 'View certificate'));
});

test('unmet watch requirements keep starting a new quiz disabled', async t => {
  const { container } = await mount(t, { eligible: false });
  const start = [...container.querySelectorAll('button')].find(b => b.textContent.trim() === 'Start quiz');
  assert.equal(start.disabled, true);
  assert.match(container.textContent, /Complete the required videos before starting/);
});
