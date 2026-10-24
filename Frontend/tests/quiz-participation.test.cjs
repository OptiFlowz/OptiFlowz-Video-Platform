const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');
const { QueryClient, QueryClientProvider, useQuery } = require('@tanstack/react-query');
const en = require('../app/locales/en.json');
const translate = (key, params = {}) => String(en[key] ?? key).replace(/\{\{param\.(\w+)\}\}/g, (_, name) => params[name] ?? '');
const tick = () => act(() => new Promise(resolve => setTimeout(resolve, 20)));
const base = { max_points: 1, answer: null, checked_at: null, feedback: {}, can_edit: true, options: [], matching_options: [], matching_items: [] };
const fixtures = () => [
  { ...base, question_no: 1, question_id: 'q1', type: 'single_choice', content: 'One answer', options: [{ option_no: 4, content: 'First', position: 2 }, { option_no: 7, content: 'Second', position: 1 }] },
  { ...base, question_no: 2, question_id: 'q2', type: 'multiple_choice', content: 'Multiple answers', options: [{ option_no: 2, content: 'Alpha', position: 1 }, { option_no: 5, content: 'Beta', position: 2 }] },
  { ...base, question_no: 3, question_id: 'q3', type: 'matching', content: 'Match answers', matching_items: [{ item_no: 8, content: 'Left', position: 1 }, { item_no: 3, content: 'Other left', position: 2 }], matching_options: [{ option_no: 6, content: 'Right', position: 1 }] },
];
async function mount(t, { resume = false, eligible = true, expired = false, hidden = false, saved = false, history = [], read = true, requirements = [], visibility = 'after_check', passed = false, correct = true, allowChanges = false, explanation = '', expiresAt = null, review = false, reviewRows, reviewError = false, directResult, perPage, quizPerPage = 1, beforeWrite, confirmResult } = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/quiz/quiz-1', pretendToBeVisual: true });
  const names = ['window', 'document', 'navigator', 'HTMLElement', 'IS_REACT_ACT_ENVIRONMENT', 'IntersectionObserver'];
  const prior = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const name of names) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value: name === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[name] });
  const observers = new Set();
  globalThis.IntersectionObserver = class { constructor(callback) { this.callback = callback; } observe() { observers.add(this); } disconnect() { observers.delete(this); } };
  const confirmations = [];
  const requests = [], cache = new Map(), styles = new Proxy({}, { get: (_, key) => key });
  let rows = reviewRows ?? fixtures(), started = resume, submitted = false, rejectSave = false, rejectSubmit = false, rejectHistory = false, rejectSaveAt = null;
  if (saved) rows[0] = { ...rows[0], answer: { option_no: 7 }, checked_at: 'now', can_edit: false };
  let navigate;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const fetchFn = async ({ route, options }) => {
    requests.push({ route, method: options.method, body: options.body && JSON.parse(options.body) });
    if (route === 'api/quizzes/quiz-1') return { quiz: { title: 'Knowledge quiz', questions_per_page: quizPerPage, question_count: 3, time_limit_seconds: 900, passing_score_percentage: 50, certificate_template_id: 'classic' } };
    if (route.endsWith('/eligibility')) return { can_start: !started && eligible, can_resume: started && !submitted, active_attempt_id: started && !submitted ? 'a1' : null, attempts_remaining: resume ? 0 : 1, reason: eligible ? null : 'requirements_not_met' };
    if (route.endsWith('/progress')) return { requirements_met: eligible, requirements };
    if (route.endsWith('/attempts') && options.method === 'POST') { started = true; return { id: 'a1', settings: { correctness_visibility: visibility, allow_attempt_review: review, questions_per_page: perPage } }; }
    if (route.includes('/attempts?')) {
      const params = new URL(route, 'http://localhost').searchParams, page = Number(params.get('page')), limit = Number(params.get('limit'));
      if (page > 1 && rejectHistory) throw new Error('History unavailable');
      const available = resume && !history.length ? [{ id: 'a1', status: 'in_progress', started_at: '2026-10-21', attempt_no: 1, settings: { correctness_visibility: visibility, allow_attempt_review: review, questions_per_page: perPage } }] : history;
      return { attempts: available.slice((page - 1) * limit, page * limit), pagination: { page, limit, total: available.length, totalPages: Math.ceil(available.length / limit) } };
    }
    if (route === 'api/quiz-attempts/a1/questions') {
      if (reviewError) throw new Error('Review unavailable');
      const completed = directResult ?? history.find(a => a.id === 'a1' && ['submitted', 'timed_out'].includes(a.status));
      return { attempt_id: 'a1', status: submitted ? 'submitted' : completed?.status ?? 'in_progress',
        settings: { correctness_visibility: visibility, allow_attempt_review: review, questions_per_page: perPage },
        ...(completed ? { result: completed } : {}),
        expires_at: expired ? '2000-01-01T00:00:00Z' : expiresAt, is_expired: expired, questions: structuredClone(rows) };
    }
    if (route.startsWith('api/quiz-attempts/a1/answers/')) {
      const no = Number(route.split('/')[4]);
      if (options.method === 'PUT') {
        if (beforeWrite) await beforeWrite(no, JSON.parse(options.body).answer);
        if (rejectSave || no === rejectSaveAt) throw new Error('Network unavailable');
        const answer = JSON.parse(options.body).answer;
        rows = rows.map(q => q.question_no !== no || JSON.stringify(q.answer) === JSON.stringify(answer) ? q : { ...q, answer, checked_at: null, can_edit: true, feedback: {} });
      } else {
        assert.equal(options.method, 'POST'); assert.ok(route.endsWith('/check'));
        assert.equal(options.body, undefined, 'check must use the persisted answer');
        rows = rows.map(q => q.question_no === no ? { ...q, checked_at: 'now', can_edit: allowChanges, feedback: hidden ? {} : { is_correct: typeof correct === 'function' ? correct(q.answer) : correct, awarded_points: correct ? 1 : 0, explanation } } : q);
      }
      return structuredClone(rows.find(q => q.question_no === no));
    }
    if (route.endsWith('/submit')) {
      if (rejectSubmit) throw new Error('Minimum answered percentage not met');
      submitted = true; return { settings: { correctness_visibility: visibility, allow_attempt_review: review, questions_per_page: perPage }, id: 'a1', status: 'submitted', score_percentage: hidden ? null : 0, earned_points: hidden ? null : 0, max_points: 3, passed: hidden ? null : passed };
    }
    throw new Error('Unexpected request ' + route);
  };
  const mocks = {
    './i18n': {}, './auth/session': {}, '~/API': { fetchFn }, '~/functions': { getToken: () => 'token' }, '~/i18n': { useI18n: () => ({ t: translate, locale: 'en' }) },
    '~/constants': { PlaySVG: '▶', CheckSVG: '✓', CloseSVG: '×', QuizSVG: 'Q' },
    '~/components/library/pagination': { default: () => null },
    '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async options => { confirmations.push(options); return confirmResult ? confirmResult.promise : true; }, dialogProps: { onNo: () => confirmResult?.resolve(false) } }) },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: () => null },
    'react-router': {
      useParams: () => ({ quizId: 'quiz-1' }), useNavigate: () => navigate,
      useSearchParams: () => [new URLSearchParams(window.location.search)], Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children),
    },
    './shared': {
      styles, useAccess: () => ({ user: { id: 'me' }, can: () => true, read }),
      useDetail: (route, enabled = true) => useQuery({ enabled, queryKey: [route], queryFn: () => fetchFn({ route: `api/quizzes${route}`, options: { method: 'GET' } }) }),
      LoadState: ({ query }) => query.error ? React.createElement('p', { role: 'alert' }, query.error.message) : null,
      Select: ({ label, value, values, onChange, disabled }) => React.createElement('select', { 'aria-label': label, value, disabled, onChange: e => onChange(e.target.value) }, values.map(v => React.createElement('option', { key: v.value, value: v.value }, v.label))),
    },
  };
  function load(file) {
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => mocks[name] ? { __esModule: true, ...mocks[name] } : name.endsWith('.css') ? { __esModule: true, default: styles } : name.startsWith('~/') ? load(path.resolve('app', name.slice(2))) : name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : require(name), mod, mod.exports);
    return mod.exports;
  }
  mocks['~/functions'].formatDescription = load(path.resolve('app/functions.tsx')).formatDescription;
  const View = load(path.resolve('app/components/quizEngine/QuizOverview.tsx')).default;
  function App() {
    const [, render] = React.useState(0);
    navigate = to => { window.history.pushState({}, '', to); render(x => x + 1); };
    return React.createElement(View);
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [name, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  await act(async () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(App))));
  await tick();
  const button = text => [...document.querySelectorAll('button')].find(b => b.textContent.replace('▶', '').trim() === text);
  const click = async text => { const b = button(text); assert.ok(b, text); assert.equal(b.disabled, false, text); await act(async () => b.click()); await tick(); };
  const choose = async text => { const label = [...document.querySelectorAll('label')].find(l => l.textContent === text); assert.ok(label, text); await act(async () => label.querySelector('input').click()); };
  return { serverRows: () => structuredClone(rows), clearCache: () => client.removeQueries({ queryKey: ['quiz-engine'] }), confirmations, requests, click, choose, button, rejectSaveAt: value => rejectSaveAt = value, rejectHistory: value => rejectHistory = value, scroll: async () => { await tick(); await act(async () => { for (const observer of [...observers]) observer.callback([{ isIntersecting: true }]); }); await tick(); }, navigate: async to => { await act(async () => navigate(to)); await tick(); }, rejectSave: value => rejectSave = value, rejectSubmit: value => rejectSubmit = value };
}

test('new engine starts, saves all three answer formats, retains locks and submits a zero score', async t => {
  const ui = await mount(t);
  await ui.click('Start quiz');
  assert.equal(window.location.search, '?attempt=a1');
  await ui.choose('Second'); await ui.click('Check answer');
  assert.equal(document.querySelector('input:checked').disabled, true);
  await ui.click('Next Question');
  await ui.choose('Alpha'); await ui.choose('Beta'); await ui.click('Check answer'); await ui.click('Next Question');
  for (const select of document.querySelectorAll('select')) await act(async () => { select.value = '6'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await ui.click('Check answer'); await ui.click('Finish attempt');
  assert.equal(ui.confirmations.at(-1).intent, 'primary', 'finishing is not destructive');
  assert.equal(document.querySelector('.attemptResult').dataset.outcome, 'failed');
  assert.deepEqual([...new Map(ui.requests.filter(r => r.method === 'PUT').map(r => [r.route, r])).values()].map(r => [r.route, r.body]), [
    ['api/quiz-attempts/a1/answers/1', { answer: { option_no: 7 } }],
    ['api/quiz-attempts/a1/answers/2', { answer: { option_nos: [2, 5] } }],
    ['api/quiz-attempts/a1/answers/3', { answer: { pairs: [{ item_no: 3, option_no: 6 }, { item_no: 8, option_no: 6 }] } }],
  ]);
  assert.equal(document.querySelector('.attemptScore').textContent, '0%');
  await ui.click('Back to attempts');
  assert.equal(window.location.search, '');
});

test('resumes at the limit without creating an attempt and restores saved checked answers', async t => {
  const ui = await mount(t, { resume: true, saved: true });
  await ui.click('Continue quiz');
  assert.ok(!ui.requests.some(r => r.method === 'POST'));
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'Second');
  assert.equal(document.querySelector('input:checked').disabled, true);
});

test('unmet requirements prevent starting', async t => {
  const ui = await mount(t, { eligible: false });
  assert.equal(ui.button('Start quiz').disabled, true);
  assert.match(document.body.textContent, /Complete the required videos/);
});

test('failed answer saves preserve the selection and prevent navigation until retry succeeds', async t => {
  const ui = await mount(t);
  await ui.click('Start quiz'); ui.rejectSave(true); await ui.choose('First');
  await ui.click('Check answer');
  assert.match(document.body.textContent, /Answers could not be saved/);
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'First');
  assert.match(document.body.textContent, /One answer/);
  ui.rejectSave(false); await ui.click('Check answer'); await ui.click('Next Question');
  assert.match(document.body.textContent, /Multiple answers/);
});

test('expired attempts are read-only and cannot save or submit', async t => {
  const ui = await mount(t, { resume: true, expired: true });
  await ui.click('Continue quiz');
  assert.equal(document.querySelector('input').disabled, true);
  assert.equal(ui.button('Check answer'), undefined);
  await ui.click('Next Question'); await ui.click('Next Question');
  assert.equal(ui.button('Finish attempt').disabled, true);
});

test('submission errors keep the attempt open; hidden correctness and final scores remain hidden', async t => {
  const ui = await mount(t, { hidden: true });
  await ui.click('Start quiz'); await ui.choose('First'); await ui.click('Check answer');
  assert.ok(!document.querySelector('.attemptFeedback .success'));
  await ui.click('Next Question'); await ui.choose('Alpha'); await ui.click('Check answer'); await ui.click('Next Question');
  for (const select of document.querySelectorAll('select')) await act(async () => { select.value = '6'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await ui.click('Check answer');
  ui.rejectSubmit(true); await ui.click('Finish attempt');
  assert.match(document.body.textContent, /Minimum answered percentage not met/);
  ui.rejectSubmit(false); await ui.click('Finish attempt');
  assert.match(document.body.textContent, /Quiz complete/);
  assert.equal(document.querySelector('.attemptScore'), null);
  assert.ok(!document.body.textContent.includes('Not passed'));
});

test('quiz table opens the participant route with Play before Edit and respects participation permission', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/quizzes' });
  const prior = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  const root = createRoot(document.getElementById('root')), navigations = [], styles = new Proxy({}, { get: (_, key) => key });
  let participate = true;
  const row = { id: 'quiz-1', title: 'Demo quiz', status: 'published', user_id: 'me', question_count: 3 };
  const empty = () => null;
  const mocks = {
    '~/i18n': { useI18n: () => ({ t: translate, locale: 'en' }) }, '~/functions': { getToken: () => 'token' },
    '~/constants': { PlaySVG: 'play', EditSVG: 'edit', QuizSVG: 'quiz' },
    'react-router': { useSearchParams: () => [new URLSearchParams()], useNavigate: () => to => navigations.push(to) },
    '@tanstack/react-query': { useQuery: ({ queryKey }) => ({ data: queryKey.includes('resource-filter') ? [row] : { items: [row], pagination: { total: 1, totalPages: 1 } }, isSuccess: true }) },
    './shared': {
      styles, Select: empty, Notice: empty, LoadState: empty,
      useAction: () => ({ busy: false }), useAll: () => ({ data: [] }),
      useAccess: () => ({ user: { id: 'me' }, create: true, read: true, can: permission => permission === 'quizzes.participate' ? participate : true, canAny: () => true, canOwn: () => true }),
    },
    '~/components/myVideosPage/sidebar/sidebar': { default: empty }, '~/components/library/pagination': { default: empty },
    '~/components/library/ProfileTabs': { default: ({ children }) => children }, '~/components/library/librarySortButton': { default: () => null },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: empty }, '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async () => true, dialogProps: {} }) },
    './CertificateTemplates': { default: empty }, './QuestionTransfer': { default: empty }, './QuestionEditor': { default: empty }, './CategoryEditor': { default: empty }, './QuizEditor': { default: empty }, './QuizStatus': { default: empty },
    './EditorPopup': { default: empty, EditorBusyContext: React.createContext(null), EditorBusyStatusContext: React.createContext(false) },
    './api': { engineKey: ['quiz-engine'] },
  };
  const cache = new Map();
  function load(file) {
    if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} }; cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => mocks[name] ? { __esModule: true, ...mocks[name] } : name.endsWith('.css') ? {} : name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : require(name), mod, mod.exports);
    return mod.exports;
  }
  t.after(async () => { await act(async () => root.unmount()); dom.window.close(); for (const [name, descriptor] of prior) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; } });
  const View = load(path.resolve('app/components/quizEngine/QuizzesPage.tsx')).default;
  await act(async () => root.render(React.createElement(View)));
  const actions = [...document.querySelector('.managementRowActions').querySelectorAll('button')];
  assert.equal(actions[0].textContent, 'play'); assert.equal(actions[1].textContent, 'edit');
  await act(async () => actions[0].click());
  assert.deepEqual(navigations, ['/quiz/quiz-1']);
  participate = false;
  await act(async () => root.render(React.createElement(View)));
  assert.equal(document.querySelector('.managementRowActions button').textContent, 'edit');
});

const historyFixtures = count => Array.from({ length: count }, (_, i) => ({
  id: `history-${i}`, attempt_no: count - i, status: 'submitted', started_at: '2026-10-01T12:00:00Z', finished_at: '2026-10-01T12:05:00Z',
  earned_points: i === 0 ? null : i % 2, max_points: 1, score_percentage: i === 0 ? null : (i % 2) * 100, passed: i === 0 ? null : !!(i % 2),
}));

test('landing restores quiz details and loads attempts on scroll without replacing earlier rows', async t => {
  const ui = await mount(t, { history: historyFixtures(18) });
  assert.equal(document.querySelector('h1').textContent, 'Knowledge quiz');
  assert.match(document.querySelector('.videoQuizFacts').textContent, /15 minutes/);
  assert.match(document.querySelector('.videoQuizFacts').textContent, /50%/);
  assert.equal(document.querySelectorAll('.videoQuizAttemptCard').length, 8);
  assert.ok(!document.querySelector('.videoQuizAttemptCard').querySelector('.failed'));
  const first = document.querySelector('.videoQuizAttemptCard');
  await ui.scroll();
  assert.equal(document.querySelectorAll('.videoQuizAttemptCard').length, 16);
  assert.equal(document.querySelector('.videoQuizAttemptCard'), first);
  await ui.scroll();
  assert.equal(document.querySelectorAll('.videoQuizAttemptCard').length, 18);
  await ui.scroll();
  assert.equal(ui.requests.filter(r => r.route.includes('/attempts?')).length, 3);
  assert.ok(!document.body.textContent.includes('Rows per page'));
});

test('infinite history keeps loaded attempts after an error and retries the same next page', async t => {
  const ui = await mount(t, { history: historyFixtures(10) });
  ui.rejectHistory(true); await ui.scroll();
  assert.equal(document.querySelectorAll('.videoQuizAttemptCard').length, 8);
  assert.ok(document.querySelector('[role="alert"]'));
  ui.rejectHistory(false); await ui.click(translate('usersRetry'));
  assert.equal(document.querySelectorAll('.videoQuizAttemptCard').length, 10);
  assert.deepEqual(ui.requests.filter(r => r.route.includes('/attempts?')).map(r => new URL(r.route, 'http://localhost').searchParams.get('page')), ['1', '2', '2']);
});

test('participant-only accounts do not request authoring metadata', async t => {
  const ui = await mount(t, { read: false });
  assert.ok(!ui.requests.some(r => r.route === 'api/quizzes/quiz-1'));
  assert.equal(ui.button('Start quiz').disabled, false);
  assert.match(document.querySelector('.videoQuizFacts').textContent, /—/);
});


test('watch requirements show localized time units and percentages with quiz metadata from the API envelope', async t => {
  await mount(t, { eligible: false, requirements: [
    { video_id: 'video-time', min_watch_percentage: null, total_watch_seconds: 0, required_watch_seconds: 30, completion_percentage: 0, is_met: false, video_card: { title: 'Timed video', thumbnail_url: '/thumbnail.png' } },
    { video_id: 'video-percent', min_watch_percentage: 50, watched_percentage: 10, completion_percentage: 20, is_met: false, video_card: { title: 'Percentage video' } },
  ] });
  assert.equal(document.querySelector('h1').textContent, 'Knowledge quiz');
  assert.match(document.body.textContent, /0 seconds watched of 30 seconds required/);
  assert.match(document.body.textContent, /10% watched of 50% required/);
  assert.ok(!document.body.textContent.includes('undefined'));
  assert.equal(document.querySelectorAll('.overviewRequirement').length, 2);
  assert.equal(document.querySelector('.videoQuizAttemptList'), null);
});

for (const visibility of ['after_finish', 'never']) test(`no Check answer for ${visibility}, navigation still saves`, async t => {
  const ui = await mount(t, { visibility, resume: true });
  await ui.click('Continue quiz');
  assert.equal(ui.button('Check answer'), undefined);
  await ui.choose('First'); await ui.click('Next Question');
  assert.equal(ui.requests.filter(r => r.method === 'PUT').length, 1);
  assert.match(document.body.textContent, /Multiple answers/);
});
test('passing result gets its own celebratory presentation', async t => {
  const ui = await mount(t, { passed: true, visibility: 'after_finish' });
  await ui.click('Start quiz'); await ui.click('Next Question'); await ui.click('Next Question'); await ui.click('Finish attempt');
  assert.equal(document.querySelector('.attemptResult').dataset.outcome, 'passed');
  assert.equal(document.querySelectorAll('.resultSpark').length, 8);
});

test('question navigation saves before jumping, retains drafts on failure and marks saved questions without revealing correctness', async t => {
  const ui = await mount(t, { visibility: 'after_finish' });
  await ui.click('Start quiz');
  const nav = () => document.querySelector('nav[aria-label="Questions"]');
  const buttons = () => [...nav().querySelectorAll('button')];
  const jump = async index => { await act(async () => buttons()[index].click()); await tick(); };
  assert.equal(buttons().length, 3);
  assert.equal(buttons()[0].getAttribute('aria-current'), 'step');
  ui.rejectSave(true); await ui.choose('First'); await jump(2);
  assert.equal(buttons()[0].getAttribute('aria-current'), 'step');
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'First');
  assert.match(document.body.textContent, /Answers could not be saved/);
  ui.rejectSave(false); await jump(2);
  assert.equal(buttons()[2].getAttribute('aria-current'), 'step');
  assert.equal(buttons()[0].dataset.answered, 'true');
  assert.equal(buttons()[0].dataset.state, 'answered');
  assert.match(buttons()[0].getAttribute('aria-label'), /Answered/);
  assert.equal(ui.button('Check answer'), undefined);
  const selects = document.querySelectorAll('select');
  await act(async () => { selects[0].value = '6'; selects[0].dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.equal(buttons()[1].disabled, false, 'partial matching answers are saved without locking navigation');
  await act(async () => { selects[1].value = '6'; selects[1].dispatchEvent(new window.Event('change', { bubbles: true })); });
  await jump(0);
  assert.equal(buttons()[0].getAttribute('aria-current'), 'step');
  assert.equal(buttons()[2].dataset.answered, 'true');
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'First');
});

for (const { correct, hidden, state } of [
  { correct: true, hidden: false, state: 'correct' },
  { correct: false, hidden: false, state: 'incorrect' },
  { correct: true, hidden: true, state: 'answered' },
]) test(`question navigation reflects ${state} only when checking exposes correctness`, async t => {
  const ui = await mount(t, { correct, hidden });
  await ui.click('Start quiz');
  const tile = () => document.querySelector('nav[aria-label="Questions"] button');
  assert.equal(tile().dataset.state, 'unanswered');
  await ui.choose('First'); await ui.click('Check answer');
  assert.equal(tile().dataset.state, state);
  assert.equal(tile().textContent.trim(), '1', 'state uses a solid tile without a checkmark');
  assert.match(tile().getAttribute('aria-label'), new RegExp(translate(state === 'correct' ? 'quizCorrect' : state === 'incorrect' ? 'quizIncorrect' : 'quizAnsweredLabel')));
});

 test('header Back to quiz saves answers before leaving without a discard confirmation', async t => {
  const ui = await mount(t);
  await ui.click('Start quiz');
  const back = ui.button('Back to quiz');
  assert.ok(back.closest('.videoQuizHeaderRow'));
  assert.equal(document.querySelector('.attemptStep').contains(back), false);
  await ui.choose('First');
  await ui.click('Back to quiz');
  assert.equal(ui.confirmations.length, 0);
  assert.deepEqual(ui.serverRows()[0].answer, { option_no: 4 });
  assert.equal(ui.serverRows()[0].checked_at, null);
  assert.equal(window.location.search, '');
});

for (const visibility of ['after_finish', 'never']) test(`${visibility} hides points and save feedback throughout the attempt`, async t => {
  const ui = await mount(t, { visibility });
  await ui.click('Start quiz');
  assert.ok(!document.querySelector('.attemptQuestion').textContent.includes('Points:'));
  await ui.choose('First'); await ui.click('Next Question'); await ui.click('Previous Question');
  assert.equal(document.querySelector('.attemptFeedback'), null, 'hidden feedback must not create a spacer or reveal awarded points');
  assert.ok(!document.body.textContent.includes(translate('qeSaved')));
});
test('checking shows points and correctness without a Changes saved message', async t => {
  const ui = await mount(t);
  await ui.click('Start quiz');
  assert.match(document.querySelector('.attemptQuestion').textContent, /Points: 1/);
  await ui.choose('First'); await ui.click('Check answer');
  assert.match(document.querySelector('.attemptFeedback').textContent, /Correct/);
  assert.match(document.querySelector('.attemptFeedback').textContent, /1\/1 points/);
  assert.ok(!document.body.textContent.includes(translate('qeSaved')));
});
test('saving with no disclosed feedback adds no feedback block', async t => {
  const ui = await mount(t, { hidden: true });
  await ui.click('Start quiz'); await ui.choose('First'); await ui.click('Check answer');
  assert.equal(document.querySelector('.attemptFeedback'), null);
});
test('in-progress history counts down, clamps at zero and handles unlimited attempts', async t => {
  const originalNow = Date.now;
  let now = originalNow();
  Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const attempt = { status: 'in_progress', started_at: '2026-10-21', earned_points: null, score_percentage: null };
  await mount(t, { history: [
    { ...attempt, id: 'timed', attempt_no: 3, expires_at: new Date(now + 65000).toISOString() },
    { ...attempt, id: 'expired', attempt_no: 2, expires_at: new Date(now - 1000).toISOString() },
    { ...attempt, id: 'unlimited', attempt_no: 1, expires_at: null },
  ] });
  const rows = () => [...document.querySelectorAll('.videoQuizAttemptScore > strong')];
  assert.equal(rows()[0].textContent, 'Time left: 1:05');
  assert.equal(rows()[1].textContent, 'Time left: 0:00');
  assert.equal(rows()[2].textContent, 'No time limit');
  const statuses = () => [...document.querySelectorAll('.videoQuizAttemptStatus')].map(node => node.textContent);
  assert.deepEqual(statuses(), ['In progress', 'Timed out', 'In progress']);
  now += 2000;
  await act(() => new Promise(resolve => setTimeout(resolve, 1050)));
  assert.equal(rows()[0].textContent, 'Time left: 1:03');
  now += 63000;
  await act(() => new Promise(resolve => setTimeout(resolve, 1050)));
  assert.equal(rows()[0].textContent, 'Time left: 0:00');
  assert.deepEqual(statuses(), ['Timed out', 'Timed out', 'In progress']);
});
test('active attempt timer highlights only the time value', async t => {
  const ui = await mount(t, { expiresAt: new Date(Date.now() + 65000).toISOString() });
  await ui.click('Start quiz');
  const timer = document.querySelector('[role="timer"]');
  assert.match(timer.textContent, /Time left: 1:0[45]/);
  assert.match(timer.querySelector('.attemptTimeValue').textContent, /^1:0[45]$/);
});

const reviewedAttempt = (allowed = true, status = 'submitted') => ({
  id: 'a1', attempt_no: 1, status, started_at: '2026-10-21', finished_at: '2026-10-21',
  score_percentage: 50, earned_points: 1.5, max_points: 3, passed: true,
  settings: { allow_attempt_review: allowed, correctness_visibility: 'after_finish' },
});
const reviewFixtures = () => fixtures().map((q, i) => ({ ...q, can_edit: true, checked_at: 'now',
  answer: i === 0 ? { option_no: 7 } : i === 1 ? { option_nos: [2] } : { pairs: [{ item_no: 8, option_no: 6 }, { item_no: 3, option_no: 6 }] },
  feedback: { is_correct: i !== 1, awarded_points: i === 1 ? 0.5 : 1, explanation: 'Saved explanation',
    ...(i === 2 ? { correct_answers: { matching_items: [{ item_no: 8, correct_option_no: 6 }] } } : { correct_answers: { options: [{ option_no: i === 0 ? 7 : 5, is_correct: true }] } }) },
}));

test('allowed review shows all saved question types, grades and feedback without editing or submitting', async t => {
  const ui = await mount(t, { review: true, visibility: 'after_finish', history: [reviewedAttempt()], reviewRows: reviewFixtures() });
  await ui.click('View');
  assert.equal(document.querySelector('.attemptScore').textContent, '50%');
  assert.match(document.body.textContent, /Review Attempt/);
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'Second');
  assert.ok([...document.querySelectorAll('.attemptOptions input')].every(input => input.disabled));
  assert.match(document.querySelector('.attemptFeedback').textContent, /1\/1 points/);
  assert.match(document.querySelector('.attemptFeedback').textContent, /Saved explanation/);
  assert.equal(ui.button('Check answer'), undefined);
  assert.equal(document.querySelector('[role="timer"]'), null);
  assert.deepEqual([...document.querySelectorAll('.attemptQuestionGrid button')].map(b => b.dataset.state), ['correct', 'incorrect', 'correct']);
  await ui.click('Next Question');
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'Alpha');
  assert.match(document.querySelector('.attemptFeedback').textContent, /0.5\/1 points/);
  await ui.click('Next Question');
  assert.ok([...document.querySelectorAll('select')].every(s => s.disabled && s.value === '6'));
  assert.match(document.querySelector('.attemptFeedback').textContent, /Left → Right/);
  assert.equal(ui.button('Finish attempt'), undefined);
  assert.ok(ui.requests.every(r => r.method === 'GET'));
});

test('disabled review keeps the summary and does not request question snapshots', async t => {
  const ui = await mount(t, { history: [reviewedAttempt(false)] });
  await ui.click('View');
  assert.equal(document.querySelector('.attemptScore').textContent, '50%');
  assert.equal(document.querySelector('.attemptQuestion'), null);
  assert.ok(!ui.requests.some(r => r.route.endsWith('/questions')));
});

test('allowed review respects withheld correctness, solutions, explanations and final score', async t => {
  const attempt = { ...reviewedAttempt(), score_percentage: null, earned_points: null, passed: null };
  const rows = reviewFixtures().map(q => ({ ...q, feedback: {} }));
  const ui = await mount(t, { review: true, visibility: 'never', history: [attempt], reviewRows: rows });
  await ui.click('View');
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'Second');
  assert.equal(document.querySelector('.attemptScore'), null);
  assert.equal(document.querySelector('.attemptFeedback'), null);
  assert.deepEqual([...document.querySelectorAll('.attemptQuestionGrid button')].map(b => b.dataset.state), ['answered', 'answered', 'answered']);
});

test('submitting loads finished feedback afresh and starts review at the first question', async t => {
  const ui = await mount(t, { review: true, visibility: 'after_finish' });
  await ui.click('Start quiz'); await ui.choose('Second'); await ui.click('Next Question');
  await ui.click('Next Question'); await ui.click('Finish attempt');
  assert.ok(document.querySelector('.attemptReview'));
  assert.match(document.querySelector('.attemptQuestion').textContent, /One answer/);
  const submission = ui.requests.findIndex(r => r.route.endsWith('/submit'));
  assert.ok(ui.requests.slice(submission + 1).some(r => r.route.endsWith('/questions')));
  assert.equal(ui.button('Finish attempt'), undefined);
});

test('timed-out attempts can be reviewed and snapshot errors preserve the result without stale questions', async t => {
  const ui = await mount(t, { review: true, history: [reviewedAttempt(true, 'timed_out')], reviewError: true });
  await ui.click('View');
  assert.equal(document.querySelector('.attemptScore').textContent, '50%');
  assert.match(document.querySelector('[role="alert"]').textContent, /Review unavailable/);
  assert.equal(document.querySelector('.attemptQuestion'), null);
});

test('a direct link to an older attempt uses its snapshot settings and result even outside loaded history', async t => {
  const ui = await mount(t, { review: true, visibility: 'after_finish', directResult: reviewedAttempt(), reviewRows: reviewFixtures() });
  await ui.navigate('/quiz/quiz-1?attempt=a1');
  assert.equal(document.querySelector('.attemptScore').textContent, '50%');
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'Second');
  assert.equal(document.querySelector('input:checked').disabled, true);
  assert.equal(ui.button('Check answer'), undefined);
  await ui.click('Next Question'); await ui.click('Next Question');
  assert.equal(ui.button('Finish attempt'), undefined);
  assert.ok(ui.requests.every(r => r.method === 'GET'));
});

for (const allowChanges of [false, true]) test(`Check answer replaces Next and handles incorrect answers with changes ${allowChanges}`, async t => {
  const ui = await mount(t, { allowChanges, correct: answer => answer.option_no === 7 });
  await ui.click('Start quiz');
  assert.equal(ui.button('Next Question'), undefined);
  assert.equal(ui.button('Check answer').disabled, true);
  assert.equal(document.querySelector('.attemptActions').lastElementChild.textContent, 'Check answer');
  await ui.choose('First'); await ui.click('Check answer');
  if (allowChanges) {
    assert.equal(ui.button('Next Question'), undefined);
    assert.equal(ui.button('Check answer').disabled, true);
    await ui.choose('Second');
    assert.equal(document.querySelector('.attemptFeedback'), null, 'old feedback disappears when the answer changes');
    await ui.click('Check answer');
  }
  assert.equal(ui.button('Check answer'), undefined);
  await ui.click('Next Question');
  assert.match(document.body.textContent, /Multiple answers/);
});

test('explanations reuse safe formatting inside a dedicated box', async t => {
  const ui = await mount(t, { explanation: '**Why** this works. [Video chapter](https://example.com/video?time=283)\n<script>alert(1)</script>' });
  await ui.click('Start quiz'); await ui.choose('First'); await ui.click('Check answer');
  const box = document.querySelector('.attemptExplanation');
  assert.equal(box.querySelector('strong').textContent, 'Why');
  assert.equal(box.querySelector('a').href, 'https://example.com/video?time=283');
  assert.equal(box.querySelector('a').textContent, 'Video chapter');
  assert.equal(box.querySelector('script'), null);
  assert.ok(box.textContent.includes('<script>alert(1)</script>'));
});

const pageTitles = () => [...document.querySelectorAll('.attemptQuestion > h2')].map(node => node.textContent);
const answerRequests = ui => ui.requests.filter(request => request.method === 'PUT');

test('multiple questions form one page; all dirty answers save before page navigation and the last page can finish', async t => {
  const ui = await mount(t, { perPage: 2, visibility: 'after_finish' });
  await ui.click('Start quiz');
  assert.deepEqual(pageTitles(), ['One answer', 'Multiple answers']);
  assert.equal(document.querySelectorAll('.attemptNavigation').length, 1);
  assert.equal(document.querySelectorAll('.attemptActions').length, 1);
  await ui.choose('Second'); await ui.choose('Alpha'); await ui.choose('Beta');
  await ui.click('Next page');
  assert.deepEqual([...new Map(answerRequests(ui).map(r => [r.route, r])).values()].map(request => [request.route.split('/').at(-1), request.body.answer]), [['1', { option_no: 7 }], ['2', { option_nos: [2, 5] }]]);
  assert.deepEqual(pageTitles(), ['Match answers']);
  await act(async () => { for (const select of document.querySelectorAll('select')) { select.value = '6'; select.dispatchEvent(new window.Event('change', { bubbles: true })); } });
  await ui.click('Previous page');
  assert.deepEqual(answerRequests(ui).at(-1).body.answer, { pairs: [{ item_no: 3, option_no: 6 }, { item_no: 8, option_no: 6 }] });
  assert.equal(document.querySelectorAll('.attemptOptions input:checked').length, 3);
  await ui.click('Next page'); await ui.click('Finish attempt');
  assert.ok(ui.requests.some(request => request.route.endsWith('/submit')));
});

test('page saves stop at a failure, retain remaining drafts and retry without resaving acknowledged answers', async t => {
  const ui = await mount(t, { perPage: 2, visibility: 'after_finish' });
  await ui.click('Start quiz'); await ui.choose('First'); ui.rejectSaveAt(2); await ui.choose('Alpha');
  await ui.click('Next page');
  assert.deepEqual(pageTitles(), ['One answer', 'Multiple answers']);
  assert.match(document.querySelector('[role="alert"]').textContent, /Answers could not be saved/);
  assert.equal(document.querySelectorAll('.attemptOptions input:checked').length, 2);
  ui.rejectSaveAt(null); await ui.click('Next page');
  assert.deepEqual(answerRequests(ui).map(request => request.route.split('/').at(-1)), ['1', '2', '2', '2']);
  assert.deepEqual(pageTitles(), ['Match answers']);
});

test('each question checks independently; another draft survives a check, and incorrect editable answers must be retried before Next page', async t => {
  const ui = await mount(t, { perPage: 2, allowChanges: true, correct: answer => answer.option_no === 7 || !!answer.option_nos });
  await ui.click('Start quiz'); await ui.choose('First'); await ui.choose('Alpha');
  assert.equal(ui.button('Next page').disabled, true);
  await ui.click('Check answer');
  assert.match(document.querySelector('.attemptFeedback').textContent, /Incorrect/);
  assert.equal(document.querySelectorAll('.attemptOptions input:checked').length, 2, 'checking question 1 retains question 2 draft');
  await ui.choose('Second'); await ui.click('Check answer');
  assert.equal(ui.button('Next page').disabled, true);
  await ui.click('Check answer');
  assert.equal(ui.button('Check answer'), undefined);
  await ui.click('Next page');
  assert.deepEqual(pageTitles(), ['Match answers']);
});

test('question navigation focuses within a page while selections autosave and supports partial answers', async t => {
  const ui = await mount(t, { perPage: 2, visibility: 'after_finish' });
  await ui.click('Start quiz'); await ui.choose('First');
  const tiles = () => document.querySelectorAll('.attemptQuestionGrid button');
  await act(async () => tiles()[1].click());
  assert.equal(answerRequests(ui).length, 1);
  assert.equal(document.activeElement.querySelector('h2').textContent, 'Multiple answers');
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'First');
  await ui.choose('Alpha'); await act(async () => tiles()[2].click()); await tick();
  assert.deepEqual(pageTitles(), ['Match answers']);
  assert.equal(answerRequests(ui).length, 2);
  await act(async () => { const select = document.querySelector('select'); select.value = '6'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  assert.equal(ui.button('Previous page').disabled, false);
  assert.equal(tiles()[0].disabled, false);
  await ui.click('Previous page');
  await ui.click('Next page');
  assert.equal(document.querySelector('select').value, '6', 'partial matching choice survives navigation');
});

test('page size uses the attempt snapshot, defaults to one on older attempts and supports sizes above question count', async t => {
  const ui = await mount(t, { quizPerPage: 25, visibility: 'after_finish' });
  await ui.click('Start quiz');
  assert.deepEqual(pageTitles(), ['One answer']);
  await ui.click('Next Question');
  assert.deepEqual(pageTitles(), ['Multiple answers']);
});

test('oversized page settings render all questions once and submit all changed answers', async t => {
  const ui = await mount(t, { perPage: 2147483647, visibility: 'after_finish' });
  await ui.click('Start quiz');
  assert.deepEqual(pageTitles(), ['One answer', 'Multiple answers', 'Match answers']);
  assert.equal(ui.button('Next page'), undefined);
  await ui.choose('First'); await ui.choose('Alpha');
  await ui.click('Finish attempt');
  const writes = ui.requests.filter(request => ['PUT', 'POST'].includes(request.method)).slice(1);
  assert.deepEqual(writes.map(request => request.route.split('/').at(-1)), ['1', '2', 'submit']);
});

test('review uses multiple stacked questions without enabling inputs or writes', async t => {
  const ui = await mount(t, { perPage: 2, quizPerPage: 1, review: true, visibility: 'after_finish', history: [reviewedAttempt()], reviewRows: reviewFixtures() });
  await ui.click('View');
  assert.deepEqual(pageTitles(), ['One answer', 'Multiple answers']);
  assert.equal(document.querySelectorAll('.attemptFeedback').length, 2);
  assert.ok([...document.querySelectorAll('.attemptOptions input')].every(input => input.disabled));
  await ui.click('Next page');
  assert.deepEqual(pageTitles(), ['Match answers']);
  assert.equal(ui.button('Finish attempt'), undefined);
  assert.ok(ui.requests.every(request => request.method === 'GET'));
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

test('autosaves without checking and restores unchecked answers from the backend after re-entering', async t => {
  const ui = await mount(t);
  await ui.click('Start quiz'); await ui.choose('Second'); await tick();
  assert.deepEqual(ui.serverRows()[0].answer, { option_no: 7 });
  assert.equal(ui.serverRows()[0].checked_at, null);
  assert.equal(document.querySelector('input:checked').disabled, false);
  assert.match(document.body.textContent, /1\/3 answered/);
  assert.match(document.body.textContent, /Answers saved/);
  assert.equal(ui.requests.filter(r => r.route.endsWith('/check')).length, 0);
  await ui.click('Back to quiz'); ui.clearCache(); await tick(); await ui.click('Continue quiz');
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'Second');
  assert.equal(document.querySelector('input:checked').disabled, false);
  assert.equal(document.querySelector('.attemptFeedback'), null);
  assert.equal(ui.button('Check answer').disabled, false);
});

test('clearing a checkbox and partial matching selections persists across a fresh load', async t => {
  const ui = await mount(t, { visibility: 'after_finish', perPage: 3 });
  await ui.click('Start quiz'); await ui.choose('Alpha'); await ui.choose('Alpha');
  await act(async () => { const select = document.querySelector('select'); select.value = '6'; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await tick();
  assert.deepEqual(ui.serverRows()[1].answer, { option_nos: [] });
  assert.deepEqual(ui.serverRows()[2].answer, { pairs: [{ item_no: 8, option_no: 6 }] });
  await ui.click('Back to quiz'); ui.clearCache(); await tick(); await ui.click('Continue quiz');
  assert.equal(document.querySelectorAll('input:checked').length, 0);
  assert.deepEqual([...document.querySelectorAll('select')].map(s => s.value), ['6', '']);
  assert.match(document.body.textContent, /0\/3 answered/);
  await act(async () => { const select = document.querySelector('select'); select.value = ''; select.dispatchEvent(new window.Event('change', { bubbles: true })); });
  await tick(); assert.deepEqual(ui.serverRows()[2].answer, { pairs: [] });
});

test('a failed autosave blocks exit and submission and can be retried without losing the selection', async t => {
  const ui = await mount(t, { visibility: 'never', perPage: 3 });
  await ui.click('Start quiz'); ui.rejectSave(true); await ui.choose('First'); await tick();
  assert.match(document.body.textContent, /Answers could not be saved/);
  const unload = new window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
  assert.equal(unload.defaultPrevented, true);
  await ui.click('Back to quiz'); assert.equal(window.location.search, '?attempt=a1');
  await ui.click('Finish attempt'); assert.equal(ui.requests.some(r => r.route.endsWith('/submit')), false);
  ui.rejectSave(false); await ui.click('Retry saving');
  assert.deepEqual(ui.serverRows()[0].answer, { option_no: 4 });
  const savedUnload = new window.Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedUnload);
  assert.equal(savedUnload.defaultPrevented, false);
  await ui.click('Back to quiz'); assert.equal(window.location.search, '');
});

for (const action of ['check', 'submit']) test(`${action} waits for the newest selection while an older save is still in flight`, async t => {
  const first = deferred(), latest = deferred(); let calls = 0;
  const ui = await mount(t, { visibility: action === 'check' ? 'after_check' : 'never', perPage: 3,
    beforeWrite: async () => { calls++; await (calls === 1 ? first.promise : latest.promise); } });
  await ui.click('Start quiz'); await ui.choose('First'); await ui.choose('Second');
  assert.equal(calls, 1, 'writes do not overlap');
  await ui.click(action === 'check' ? 'Check answer' : 'Finish attempt');
  assert.equal(ui.requests.some(r => r.route.endsWith('/' + action)), false);
  await act(async () => first.resolve()); await tick();
  assert.equal(calls, 2);
  assert.equal(document.querySelector('input:checked').parentElement.textContent, 'Second', 'old response never replaces the latest local selection');
  assert.equal(ui.requests.some(r => r.route.endsWith('/' + action)), false);
  await act(async () => latest.resolve()); await tick();
  assert.deepEqual(ui.serverRows()[0].answer, { option_no: 7 });
  assert.ok(ui.requests.some(r => r.route.endsWith('/' + action)));
  assert.deepEqual(answerRequests(ui).map(r => r.body), [{ answer: { option_no: 4 } }, { answer: { option_no: 7 } }]);
  if (action === 'check') assert.equal(ui.serverRows()[0].checked_at, 'now');
});

test('the open quiz automatically submits once before expiry without confirmation or requiring checks', async t => {
  const deadline = Date.now() + 1500;
  const ui = await mount(t, { expiresAt: new Date(deadline).toISOString() });
  await ui.click('Start quiz'); await ui.choose('Second');
  await act(() => new Promise(resolve => setTimeout(resolve, 550))); await tick();
  assert.equal(ui.requests.filter(r => r.route.endsWith('/submit')).length, 1);
  assert.equal(ui.requests.filter(r => r.route.endsWith('/check')).length, 0);
  assert.equal(ui.confirmations.length, 0);
  assert.deepEqual(ui.serverRows()[0].answer, { option_no: 7 });
  assert.ok(document.querySelector('.attemptResult'));
  await act(() => new Promise(resolve => setTimeout(resolve, 1050)));
  assert.equal(ui.requests.filter(r => r.route.endsWith('/submit')).length, 1);
});

test('automatic submission flushes the pending save before sending submit', async t => {
  const pending = deferred();
  const deadline = Date.now() + 1800;
  const ui = await mount(t, { expiresAt: new Date(deadline).toISOString(), beforeWrite: () => pending.promise });
  await ui.click('Start quiz'); await ui.choose('First');
  await act(() => new Promise(resolve => setTimeout(resolve, 850)));
  assert.equal(ui.requests.some(r => r.route.endsWith('/submit')), false);
  assert.equal(document.querySelector('input').disabled, true);
  await act(async () => pending.resolve()); await tick();
  assert.ok(Date.now() < deadline);
  assert.deepEqual(ui.serverRows()[0].answer, { option_no: 4 });
  assert.equal(ui.requests.filter(r => r.route.endsWith('/submit')).length, 1);
  assert.equal(ui.confirmations.length, 0);
});

test('automatic submission never reports success when saving fails or backend rejects submission', async t => {
  const ui = await mount(t, { expiresAt: new Date(Date.now() + 1500).toISOString() });
  await ui.click('Start quiz'); ui.rejectSubmit(true); await ui.choose('First');
  await act(() => new Promise(resolve => setTimeout(resolve, 550))); await tick();
  assert.equal(ui.requests.filter(r => r.route.endsWith('/submit')).length, 1);
  assert.equal(document.querySelector('.attemptResult'), null);
  assert.match(document.body.textContent, /Minimum answered percentage not met/);
  assert.deepEqual(ui.serverRows()[0].answer, { option_no: 4 });
});

test('failed final autosave prevents automatic submission', async t => {
  const ui = await mount(t, { expiresAt: new Date(Date.now() + 1500).toISOString() });
  await ui.click('Start quiz'); ui.rejectSave(true); await ui.choose('First');
  await act(() => new Promise(resolve => setTimeout(resolve, 550))); await tick();
  assert.equal(ui.requests.some(r => r.route.endsWith('/submit')), false);
  assert.equal(document.querySelector('.attemptResult'), null);
  assert.match(document.body.textContent, /Answers could not be saved/);
});


test('deadline submission supersedes a pending manual confirmation without duplicate submits', async t => {
  const confirmation = deferred();
  const ui = await mount(t, { expiresAt: new Date(Date.now() + 1500).toISOString(), perPage: 3, visibility: 'never', confirmResult: confirmation });
  await ui.click('Start quiz'); await ui.choose('First'); await ui.click('Finish attempt');
  assert.equal(ui.confirmations.length, 1);
  assert.equal(ui.requests.some(r => r.route.endsWith('/submit')), false);
  await act(() => new Promise(resolve => setTimeout(resolve, 550))); await tick();
  assert.equal(ui.requests.filter(r => r.route.endsWith('/submit')).length, 1);
  assert.ok(document.querySelector('.attemptResult'));
});
