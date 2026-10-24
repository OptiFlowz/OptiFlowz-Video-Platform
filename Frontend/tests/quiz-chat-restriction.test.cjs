const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

const source = fs.readFileSync(require.resolve('../app/hooks/useQuizChatRestriction.ts'), 'utf8');
const mod = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(require, mod, mod.exports);
const { isQuizChatBlocked, useQuizChatRestriction } = mod.exports;

test('chat is blocked on participant quiz routes and remains available on admin routes', () => {
  for (const path of ['/quiz', '/quiz/course', '/quiz/course/question/2', '/quiz/course/']) {
    assert.equal(isQuizChatBlocked(path), true, path);
  }
  for (const path of ['/', '/video/123', '/account', '/quizzes', '/quizzes/templates', '/quiz-help', '/quizzes-archive']) {
    assert.equal(isQuizChatBlocked(path), false, path);
  }
});

test('quiz navigation closes existing chat, blocks late widgets and restores chat after exit', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://test.local/' });
  const keys = ['window', 'document', 'Element', 'HTMLElement', 'MutationObserver', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const key of keys) globalThis[key] = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key];
  const { createRoot } = require('react-dom/client');
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    await React.act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  function Page({ path }) {
    const blocked = useQuizChatRestriction(path);
    return React.createElement('p', null, blocked ? 'Quiz' : 'Video');
  }
  const navigate = path => React.act(async () => root.render(React.createElement(Page, { path })));
  let sent = 0;
  function widget() {
    const chat = document.createElement('div');
    chat.id = 'optiflowz-chat';
    chat.innerHTML = '<button id="optiflowz-chat-open">Open chat</button><div class="optiflowz-chat-wrapper"><button id="send">Send</button><textarea></textarea></div>';
    chat.inert = false;
    const open = chat.querySelector('button');
    const send = chat.querySelector('#send');
    open.addEventListener('click', () => chat.classList.toggle('chat-open'));
    send.addEventListener('click', () => sent++);
    chat.querySelector('textarea').addEventListener('keydown', () => sent++);
    document.body.append(chat);
    return { chat, open, send };
  }
  await navigate('/video/123');
  let current = widget();
  current.open.click();
  assert.ok(current.chat.classList.contains('chat-open'));
  current.chat.querySelector('textarea').focus();
  await navigate('/quiz/course');
  assert.ok(document.body.classList.contains('quiz-chat-blocked'));
  assert.equal(current.chat.classList.contains('chat-open'), false);
  assert.equal(current.chat.inert, true);
  assert.notEqual(document.activeElement, current.chat.querySelector('textarea'));
  current.open.click();
  current.send.click();
  current.chat.querySelector('textarea').dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(current.chat.classList.contains('chat-open'), false);
  assert.equal(sent, 0);

  await navigate('/quiz/course/question/1');
  current.chat.remove();
  await React.act(async () => { current = widget(); current.chat.classList.add('chat-open'); });
  assert.equal(current.chat.inert, true);
  assert.equal(current.chat.classList.contains('chat-open'), false);
  current.send.click();
  assert.equal(sent, 0);

  await navigate('/quizzes');
  assert.equal(document.body.classList.contains('quiz-chat-blocked'), false);
  assert.equal(current.chat.inert, false);
  current.open.click();
  current.send.click();
  assert.ok(current.chat.classList.contains('chat-open'));
  assert.equal(sent, 1);

  // Direct quiz entry without a widget; a pending script may still finish later.
  current.chat.remove();
  await navigate('/quiz/course');
  await React.act(async () => { current = widget(); });
  assert.equal(current.chat.inert, true);
  current.open.click();
  assert.equal(current.chat.classList.contains('chat-open'), false);
});
