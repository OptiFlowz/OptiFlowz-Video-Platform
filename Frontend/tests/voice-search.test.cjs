const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
const React = require('react');
const { act } = React;
const { createRoot } = require('react-dom/client');

const mod = { exports: {} };
const source = fs.readFileSync(path.join(__dirname, '../app/hooks/useVoiceSearch.ts'), 'utf8');
new Function('require', 'module', 'exports', ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText)(require, mod, mod.exports);
const { useVoiceSearch } = mod.exports;

test('voice search handles unavailable browsers, transcripts, permission failures and cleanup', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://app.example/' });
  const previous = new Map();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  window.isSecureContext = true;
  const root = createRoot(document.getElementById('root'));
  let mounted = true;
  t.after(async () => {
    if (mounted) await act(() => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  let voice;
  let transcript = 'existing search';
  function Harness({ locale }) { voice = useVoiceSearch(locale, text => { transcript = text; }); return null; }
  await act(() => root.render(React.createElement(Harness, { locale: 'en' })));
  await act(() => voice.toggle());
  assert.equal(voice.message, 'voiceSearchUnavailable');
  assert.equal(voice.active, false);

  const sessions = [];
  class Recognition {
    constructor() { sessions.push(this); }
    start() { this.onstart(); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
  }
  // Exercise the prefixed implementation too.
  window.webkitSpeechRecognition = Recognition;
  await act(() => voice.toggle());
  const first = sessions.at(-1);
  assert.equal(voice.active, true);
  assert.equal(voice.message, 'voiceSearchListening');
  assert.equal(first.interimResults, true);
  await act(() => first.onresult({ results: [[{ transcript: 'video' }]] }));
  assert.equal(transcript, 'video');
  await act(() => first.onresult({ results: [[{ transcript: 'video platform' }]] }));
  assert.equal(transcript, 'video platform');
  await act(() => voice.toggle());
  assert.equal(first.stopped, true);
  await act(() => first.onend());
  assert.equal(voice.active, false);
  assert.equal(voice.message, 'voiceSearchReady');

  await act(() => voice.toggle());
  const denied = sessions.at(-1);
  await act(() => denied.onerror({ error: 'not-allowed' }));
  assert.equal(voice.message, 'voiceSearchPermission');
  assert.equal(voice.active, false);
  assert.equal(denied.aborted, true);
  assert.equal(denied.onresult, null);
  assert.equal(transcript, 'video platform');

  await act(() => voice.toggle());
  const cancelled = sessions.at(-1);
  await act(() => voice.cancel());
  assert.equal(cancelled.aborted, true);
  assert.equal(cancelled.onresult, null);
  assert.equal(voice.message, '');

  await act(() => voice.toggle());
  const changedLanguage = sessions.at(-1);
  await act(() => root.render(React.createElement(Harness, { locale: 'sr' })));
  assert.equal(changedLanguage.aborted, true);
  await act(() => voice.toggle());
  const last = sessions.at(-1);
  assert.equal(last.lang, 'sr');
  await act(() => root.unmount());
  mounted = false;
  assert.equal(last.aborted, true);
  assert.equal(last.onresult, null);
});
