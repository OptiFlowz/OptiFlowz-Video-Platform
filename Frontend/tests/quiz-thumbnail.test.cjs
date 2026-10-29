const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');
const { act } = React;
const messages = require('../app/locales/en.json');
const styles = new Proxy({}, {get:(_,key)=>key});
function load(file, mocks) {
  if (!path.extname(file)) file += fs.existsSync(file+'.ts') ? '.ts' : '.tsx';
  const mod={exports:{}};
  const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  new Function('require','module','exports',code)(name=>name in mocks?{__esModule:true,...mocks[name]}:name.endsWith('.css')?{__esModule:true,default:styles}:name.startsWith('~/components/confirmPopup/')?load(path.resolve('app',name.slice(2)),mocks):name.startsWith('.')?load(path.resolve(path.dirname(file),name),mocks):require(name),mod,mod.exports);
  return mod.exports;
}
test('thumbnail endpoint sends multipart file or empty removal body and validates type and size',async()=>{
  const calls=[];
  const api=load(path.resolve('app/components/quizEngine/quizThumbnailApi.ts'),{'~/functions':{getToken:()=> 'token'},'~/API':{fetchFn:async value=>{calls.push(value);return {quiz:{id:'q',thumbnail_url:null}}}}});
  const file=new File(['png'], 'cover.png',{type:'image/png'});
  assert.equal(api.validQuizThumbnail(file),true);
  assert.equal(api.validQuizThumbnail({type:'image/webp',size:5*1024*1024}),true);
  assert.equal(api.validQuizThumbnail({type:'image/png',size:5*1024*1024+1}),false);
  assert.equal(api.validQuizThumbnail({type:'image/svg+xml',size:40}),false);
  assert.equal(api.validQuizThumbnail({type:'image/jpeg',size:0}),false);
  await api.uploadQuizThumbnail('q',file);await api.uploadQuizThumbnail('q',null);
  assert.equal(calls[0].route,'api/quizzes/q/thumbnail');
  assert.equal(calls[0].options.headers.Authorization,'Bearer token');
  assert.equal(calls[0].options.headers['Content-Type'],undefined);
  assert.equal(calls[0].options.body.get('file').name,'cover.png');
  assert.equal(calls[1].options.body.has('file'),false);
  assert.ok(calls.every(c=>c.options.method==='POST'));
});
test('thumbnail editor uploads, preserves old image after errors, removes and disables unauthorized/new uploads',async t=>{
  const dom=new JSDOM('<div id="root"></div>',{pretendToBeVisual:true});
  const prev=new Map(['window','document','requestAnimationFrame','cancelAnimationFrame','IS_REACT_ACT_ENVIRONMENT'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));
  Object.assign(globalThis,{window:dom.window,document:dom.window.document,requestAnimationFrame:dom.window.requestAnimationFrame.bind(dom.window),cancelAnimationFrame:dom.window.cancelAnimationFrame.bind(dom.window),IS_REACT_ACT_ENVIRONMENT:true});
  const root=require('react-dom/client').createRoot(document.getElementById('root'));
  t.after(async()=>{await act(async()=>root.unmount());dom.window.close();for(const[k,v]of prev)v?Object.defineProperty(globalThis,k,v):delete globalThis[k]});
  const requests=[];let fail=false;
  const mocks={
    '~/i18n':{useI18n:()=>({t:key=>messages[key]||key})},'~/constants':{QuizSVG:'quiz',UploadSVG:'upload',DeleteSVG:'delete'},
    '~/components/shared/thumbnailDropZone':{ThumbnailDropZone:({children})=>React.createElement('div',null,children)},
    '~/functions':{getToken:()=> 'token'},'~/API':{fetchFn:async({options})=>{requests.push(options);if(fail)throw Error('Upload failed');return {quiz:{id:'q',thumbnail_url:options.body.has('file')?'new.png':null}}}},
    './shared':{styles,FieldHelp:({help})=>React.createElement('span',{'data-help':help}),Notice:({error})=>error?React.createElement('p',{role:'alert'},error):null,useAction:()=>{const[error,setError]=React.useState('');const[busy,setBusy]=React.useState(false);return{error,setError,busy,run:async fn=>{setBusy(true);setError('');try{await fn()}catch(e){setError(e.message)}finally{setBusy(false)}}}}},
  };
  const Editor=load(path.resolve('app/components/quizEngine/QuizThumbnailEditor.tsx'),mocks).default;
  let quiz={id:'q',thumbnail_url:'old.png'},editable=true;
  const render=()=>root.render(React.createElement(Editor,{quiz,editable,disabled:false}));
  const select=async file=>{const input=document.querySelector('input');Object.defineProperty(input,'files',{configurable:true,value:[file]});await act(async()=>input.dispatchEvent(new window.Event('change',{bubbles:true})))};
  await act(async()=>render());
  fail=true;await select(new File(['data'],'file.png',{type:'image/png'}));
  assert.equal(document.querySelector('img').getAttribute('src'),'old.png');
  assert.match(document.querySelector('[role=alert]').textContent,/Upload failed/);
  fail=false;await select(new File(['data'],'file.png',{type:'image/png'}));
  assert.equal(document.querySelector('img').getAttribute('src'),'new.png');
  const count=requests.length;await select(new File(['bad'],'file.svg',{type:'image/svg+xml'}));assert.equal(requests.length,count);
  const remove=async()=>act(async()=>document.querySelector('button[aria-label="Remove Thumbnail"]').click());
  const respond=async label=>{
    await act(async()=>[...document.querySelectorAll('[role=dialog] button')].find(b=>b.textContent===label).click());
    await act(async()=>{const event=new window.Event('transitionend',{bubbles:true});Object.defineProperty(event,'propertyName',{value:'opacity'});document.querySelector('.popupMotionPanel').dispatchEvent(event)});
  };
  await remove();
  assert.ok(document.querySelector('[role=dialog]'));
  assert.equal(requests.length,count,'opening confirmation must not delete');
  await respond('Cancel');
  assert.equal(requests.length,count,'cancelling must not delete');
  assert.equal(document.querySelector('img').getAttribute('src'),'new.png');
  await remove();await respond('Delete');
  assert.equal(requests.length,count+1,'only confirmation sends removal');
  assert.equal(document.querySelector('img'),null);
  assert.equal(requests.at(-1).body.has('file'),false);
  editable=false;await act(async()=>render());assert.ok(document.querySelector('input').disabled);
  quiz=undefined;editable=true;await act(async()=>render());assert.ok(document.querySelector('input').disabled);assert.match(document.querySelector('[data-help]').dataset.help,/Save the quiz first/);
});
test('broken thumbnail falls back to quiz icon and a replacement URL loads normally',async t=>{
 const dom=new JSDOM('<div id="root"></div>');const prev=new Map(['window','document','IS_REACT_ACT_ENVIRONMENT'].map(k=>[k,Object.getOwnPropertyDescriptor(globalThis,k)]));Object.assign(globalThis,{window:dom.window,document:dom.window.document,IS_REACT_ACT_ENVIRONMENT:true});
 const root=require('react-dom/client').createRoot(document.getElementById('root'));t.after(async()=>{await act(async()=>root.unmount());dom.window.close();for(const[k,v]of prev)v?Object.defineProperty(globalThis,k,v):delete globalThis[k]});
 const Thumbnail=load(path.resolve('app/components/quizEngine/QuizThumbnail.tsx'),{'~/constants':{QuizSVG:'quiz'}}).default;
 await act(async()=>root.render(React.createElement(Thumbnail,{src:'bad.png'})));await act(async()=>document.querySelector('img').dispatchEvent(new window.Event('error')));assert.equal(document.querySelector('img'),null);assert.match(document.body.textContent,/quiz/);
 await act(async()=>root.render(React.createElement(Thumbnail,{src:'good.png'})));assert.equal(document.querySelector('img').getAttribute('src'),'good.png');
});
