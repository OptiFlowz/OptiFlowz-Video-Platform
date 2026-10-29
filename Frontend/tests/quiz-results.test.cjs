const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { QueryClient, QueryClientProvider, useQuery } = require('@tanstack/react-query');
const { act } = React;
const messages = require('../app/locales/en.json');
const translate = (key, params = {}) => String(messages[key] ?? key).replace(/\{\{param\.(\w+)\}\}/g, (_, name) => params[name] ?? '');

function loadModule(file, mocks, cache = new Map()) {
  if (!path.extname(file)) file += fs.existsSync(file + '.ts') ? '.ts' : '.tsx';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', code)(name => name in mocks ? { __esModule: true, ...mocks[name] } : name.endsWith('.css') ? { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) } : name.startsWith('.') ? loadModule(path.resolve(path.dirname(file), name), mocks, cache) : require(name), mod, mod.exports);
  return mod.exports;
}

test('result permissions refer to the quiz owner, and ordinary quiz read does not grant results access', () => {
  const { canReadQuizResults } = loadModule(path.resolve('app/components/quizEngine/quizResultsModel.ts'), {});
  const access = keys => ({ canOwn: (own, any, owner) => keys.includes(any) || owner === 'me' && keys.includes(own) });
  assert.equal(canReadQuizResults(access(['quizzes.read_any']), 'me'), false);
  assert.equal(canReadQuizResults(access(['quizzes.attempts.read_own']), 'me'), true);
  assert.equal(canReadQuizResults(access(['quizzes.attempts.read_own']), 'other'), false);
  assert.equal(canReadQuizResults(access(['quizzes.attempts.read_any']), 'other'), true);
});

test('participant popup links to a read-only quiz page with snapshots, identity and server filters', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/' });
  const previous = new Map(['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.scrollTo = () => {};
  const root = require('react-dom/client').createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  t.after(async () => { await act(async () => root.unmount()); client.clear(); dom.window.close(); for (const [key, value] of previous) { if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key]; } });
  let allowed = true, failList = false, reviewPage = false, deleteAllowed = false, confirmed = false, resets = 0, resetFailure = false;
  const requests = [];
  const attempt = { id: 'a1', attempt_no: 1, status: 'submitted', started_at: '2026-10-29T10:00:00Z', finished_at: '2026-10-29T10:10:00Z', earned_points: 0, max_points: 2, score_percentage: 0, passed: false };
  const question = (no, type, answer) => ({ question_no: no, question_id: null, max_points: 1, awarded_points: no === 1 ? 0 : null, is_correct: no === 1 ? false : null, checked_at: no === 1 ? '2026-10-29' : null, answer,
    question_snapshot: { type, content: `Original question ${no}`, explanation: 'Saved explanation', options: [{ option_no: 1, content: 'Right answer', is_correct: true }, { option_no: 2, content: 'Wrong answer', is_correct: false }], matching_items: [{ item_no: 1, content: 'Term', correct_option_no: 1 }], matching_options: [{ option_no: 1, content: 'Definition' }] } });
  const mocks = {
    'react-router': { useParams: () => ({ quizId: 'quiz', attemptId: 'a1' }), useSearchParams: () => [new URLSearchParams('scope=all')], useNavigate: () => () => {},
      Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to, onClick: event => { event.preventDefault(); reviewPage = to.startsWith('/quiz/'); render(); } }, children) },
    '~/components/confirmPopup/useConfirm': { useConfirm: () => ({ confirm: async () => confirmed, dialogProps: {} }) },
    '~/components/confirmPopup/confirmDialog': { ConfirmDialog: () => null },
    './quizResultsApi': { resetQuizAttempts: async (quizId, progress) => { assert.equal(quizId, 'quiz'); resets++; progress(1, 2); if (resetFailure) throw Error('Reset failed'); } },
    '~/i18n': { useI18n: () => ({ t: translate, locale: 'en' }) }, '~/functions': { getToken: () => 'token', formatDescription: value => value },
    '~/constants': { AnalyticsSVG: 'chart', CheckSVG: 'check', CloseSVG: 'cross', IconChevron: () => 'arrow', UserSVG: 'user' },
    '~/API': { fetchFn: async ({ route, options }) => {
      requests.push({ route, options }); assert.equal(options.method, 'GET');
      const url = new URL(route, 'https://test.local/');
      if (url.pathname.endsWith('/by-user')) {
        if (failList) throw new Error('Results unavailable');
        const params = url.searchParams, page = Number(params.get('page'));
        if (params.has('user_id')) return { users: [{ user: { id: params.get('user_id'), full_name: 'Participant', image_url: null }, attempts: [{ ...attempt, passed: true }, attempt] }], pagination: { page: 1, limit: 1, total: 1, totalPages: 1 } };
        return { users: params.get('status') === 'cancelled' ? [] : [{ user: { id: `u${page}`, full_name: `Participant ${page}`, image_url: null }, attempts: [attempt, { ...attempt, id: 'a2', attempt_no: 2, status: 'in_progress', finished_at: null, earned_points: null, passed: null, score_percentage: null }] }], pagination: { page, limit: 20, total: params.get('status') === 'cancelled' ? 0 : 21, totalPages: params.get('status') === 'cancelled' ? 0 : 2 } };
      }
      if (url.pathname === '/api/quizzes/quiz') return { quiz: { id: 'quiz', title: 'Quiz title', user_id: 'me' } };
      assert.equal(url.pathname, '/api/quizzes/quiz/results/a1');
      return { attempt: { ...attempt, user: { id: 'u1', full_name: 'Participant 1', image_url: null }, settings: { allow_attempt_review: false, show_final_score: false, questions_per_page: 4 }, questions: [question(1, 'single_choice', { option_no: 2 }), question(2, 'multiple_choice', { option_nos: [1, 2] }), question(3, 'matching', { pairs: [{ item_no: 1, option_no: 1 }] }), question(4, 'single_choice', null)] } };
    } },
    '~/components/library/pagination': { default: props => React.createElement('div', { 'data-pagination': props.label, 'data-total': props.total }, React.createElement('button', { onClick: () => props.onPageChange(2) }, 'Next users')) },
    './EditorPopup': { default: ({ open, heading, children, onClose }) => open ? React.createElement('div', { role: 'dialog' }, heading, children, React.createElement('button', { onClick: onClose }, 'Close review')) : null },
  };
  const api = loadModule(path.resolve('app/components/quizEngine/api.ts'), mocks);
  mocks['./shared'] = {
    styles: new Proxy({}, { get: (_, key) => key }), useAccess: () => ({ user: { id: 'me' }, read: true, canAny: () => allowed, canOwn: own => own.includes('delete') ? deleteAllowed : allowed }),
    Notice: ({error}) => error ? React.createElement('p',{role:'alert'},error) : null,
    useAction: () => { const [busy,setBusy]=React.useState(false),[error,setError]=React.useState(''); return {busy,error,run:async work=>{setBusy(true);setError('');try{await work()}catch(e){setError(e.message)}finally{await client.invalidateQueries({queryKey:['quiz-engine']});setBusy(false)}}}; },
    useDetail: (route, enabled = true) => useQuery({ enabled, queryKey: ['quiz-engine', route], queryFn: ({ signal }) => api.request(route, 'GET', undefined, signal) }),
    LoadState: ({ query }) => query.isError ? React.createElement('div', { role: 'alert' }, query.error.message, React.createElement('button', { onClick: query.refetch }, 'Retry')) : null,
    Select: ({ label, value, values, onChange, disabled }) => React.createElement('select', { 'aria-label': label, value, disabled, onChange: event => onChange(event.target.value) }, values.map(option => React.createElement('option', { key: option.value, value: option.value }, option.label))),
  };
  const View = loadModule(path.resolve('app/components/quizEngine/QuizResults.tsx'), mocks).default;
  const ReviewPage = loadModule(path.resolve('app/components/quizEngine/QuizAttemptReviewPage.tsx'), mocks).default;
  const render = () => root.render(React.createElement(QueryClientProvider, { client }, React.createElement(reviewPage ? ReviewPage : View, { quiz: { id: 'quiz', user_id: 'me' } })));
  const tick = () => act(() => new Promise(resolve => setTimeout(resolve, 30)));
  const click = async el => { assert.ok(el); await act(async () => el.click()); await tick(); };
  const select = async (label, value) => { await act(async () => { const el = document.querySelector(`select[aria-label="${label}"]`); el.value = value; el.dispatchEvent(new window.Event('change', { bubbles: true })); }); await tick(); };
  await act(async () => render()); await tick();
  assert.equal(document.querySelector('[data-pagination="Participants"]').dataset.total, '21');
  assert.equal(document.querySelectorAll('button.participant').length, 1);
  assert.equal(document.querySelectorAll('article.attempt').length, 0, 'attempts are absent from the page');
  assert.equal(document.querySelector('[role=dialog]'), null);
  assert.equal(requests.length, 1, 'no question snapshots fetched for a collapsed participant');
  assert.equal(document.querySelector('button.participant .avatar').dataset.outcome, 'failed');
  assert.match(document.querySelector('button.participant').textContent, /Not passed/);
  await click(document.querySelector('button.participant'));
  assert.equal(document.querySelectorAll('[role=dialog]').length, 1);
  assert.equal(document.querySelectorAll('[role=dialog] article.attempt').length, 2);
  assert.match(document.querySelector('[role=dialog] .profileHeader').textContent, /Participant 1/);
  assert.ok(document.querySelector('[role=dialog] .profileHeader .avatar'));
  assert.match(document.querySelector('.attempt').textContent, /0%/);
  assert.match(document.querySelectorAll('.attempt')[1].textContent, /In progress/);
  assert.doesNotMatch(document.querySelectorAll('.attempt')[1].textContent, /Not passed|0%/);
  assert.equal(document.querySelector('.attempt a').getAttribute('href'), '/quiz/quiz/results/a1?scope=all');
  await click(document.querySelector('.attempt a'));
  assert.equal(document.querySelector('[role=dialog]'), null, 'review opens on a full page');
  assert.match(document.querySelector('main').textContent, /Participant 1/);
  assert.equal(document.querySelector('.reviewSummary .avatar').dataset.outcome, 'failed', 'header describes the selected attempt, not a prior pass');
  assert.match(document.querySelector('main').textContent, /Original question 1/);
  assert.match(document.querySelector('main').textContent, /Not checked/);
  assert.match(document.querySelector('main').textContent, /haven.t answered this question yet/);
  assert.match(document.querySelector('main').textContent, /Definition/);
  const inputs = [...document.querySelectorAll('main input')];
  assert.ok(inputs.every(input => input.disabled));
  assert.equal(inputs.filter(input => input.checked).length, 3);
  assert.ok([...document.querySelectorAll('main select')].every(input => input.disabled));
  assert.match(document.querySelector('main').textContent, /Correct answer: Right answer/);
  assert.equal(document.querySelectorAll('.attemptQuestionGrid button').length, 4);
  assert.equal(requests.some(({route})=>route.includes('quiz-attempts') || route.includes('/eligibility')), false);
  await click(document.querySelector('a[href^="/quizzes?"]'));
  await click(document.querySelector('button.participant'));
  assert.equal(document.querySelectorAll('[role=dialog] article.attempt').length, 2);
  await click([...document.querySelectorAll('button')].find(el => el.textContent === 'Close review'));
  assert.equal(document.querySelectorAll('article.attempt').length, 0);
  await click(document.querySelector('[data-pagination="Participants"] button'));
  assert.match(document.querySelector('button.participant').textContent, /Participant 2/);
  await select('Status', 'cancelled');
  assert.equal(document.querySelectorAll('button.participant').length, 0);
  assert.match(document.querySelector('.partEmpty').textContent, /No Results Found/);
  assert.equal(document.querySelector('[data-pagination=Participants]'), null);
  assert.match(requests.at(-1).route, /page=1/);
  await select('Results', 'false');
  assert.match(requests.at(-1).route, /passed=false/);
  await select('Sort by', 'score_percentage');
  assert.match(requests.at(-1).route, /sortBy=score_percentage/);
  failList = true;
  await select('Status', 'submitted');
  assert.match(document.querySelector('[role="alert"]').textContent, /Results unavailable/);
  failList = false;
  await click([...document.querySelectorAll('button')].find(el => el.textContent === 'Retry'));
  assert.ok(document.querySelector('button.participant'));
  await tick();
  assert.equal(document.querySelector('button.participant .avatar').dataset.outcome, 'passed', 'failed-attempt filter must not hide an earlier pass');
  const resetButton=()=>[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Delete all attempts'));
  assert.equal(resetButton(),undefined,'read permission alone cannot reset');
  deleteAllowed=true;await act(async()=>render());
  await click(resetButton());assert.equal(resets,0,'cancel leaves attempts unchanged');
  confirmed=true;resetFailure=true;await click(resetButton());assert.equal(resets,1);
  assert.match(document.querySelector('[role=alert]').textContent,/Reset failed/);
  assert.match(document.querySelector('[role=status]').textContent,/Deleted 1 of 2/);
  assert.ok(document.querySelector('button.participant'),'partial failure retains retryable results');
  resetFailure=false;await click(resetButton());assert.equal(resets,2);
  assert.equal(document.querySelector('select[aria-label="Status"]').value,'');
  assert.equal(document.querySelector('select[aria-label="Results"]').value,'');
  assert.equal(document.querySelector('[role=status]'),null);
  allowed = false; await act(async () => render());
  assert.equal(document.querySelector('section'), null);
  assert.ok(requests.every(({ options }) => options.method === 'GET'));
});

 test('participant outcome preserves a pass across retries and keeps ungraded attempts neutral', () => {
  const { participantOutcome } = loadModule(path.resolve('app/components/quizEngine/quizResultsModel.ts'), {});
  assert.equal(participantOutcome([{passed:false}, {passed:true}, {passed:null}]), true);
  assert.equal(participantOutcome([{passed:null}, {passed:false}]), false);
  assert.equal(participantOutcome([{passed:null}]), null);
  assert.equal(participantOutcome([]), null);
});

 test('reset collects every page before deletion, ignores UI filters and stops on failure',async()=>{
  const calls=[],progress=[];let fail=false;
  const api=loadModule(path.resolve('app/components/quizEngine/quizResultsApi.ts'),{
    '~/functions':{getToken:()=> 'token'},
    '~/API':{fetchFn:async({route,options})=>{
      calls.push({route,method:options.method});
      if(options.method==='GET') { const url=new URL(route,'https://test.local');assert.equal(url.pathname,'/api/quizzes/q/results');assert.equal(url.searchParams.has('status'),false);assert.equal(url.searchParams.has('passed'),false);return {attempts:[{id:url.searchParams.get('page')==='1'?'a1':'a2'}],pagination:{hasNextPage:url.searchParams.get('page')==='1'}}; }
      if(fail && route.endsWith('/a2'))throw Error('Conflict');
      return {deleted:true};
    }},
  });
  await api.resetQuizAttempts('q',(done,total)=>progress.push([done,total]));
  assert.deepEqual(calls.map(c=>c.method),['GET','GET','DELETE','DELETE']);
  assert.deepEqual(calls.slice(2).map(c=>c.route),['api/quizzes/q/attempts/a1','api/quizzes/q/attempts/a2']);
  assert.deepEqual(progress,[[0,2],[1,2],[2,2]]);
  fail=true;progress.length=0;
  await assert.rejects(()=>api.resetQuizAttempts('q',(done,total)=>progress.push([done,total])),/Conflict/);
  assert.deepEqual(progress,[[0,2],[1,2]]);
 });
