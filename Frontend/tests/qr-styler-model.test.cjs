const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('fs'), ts = require('typescript'), { JSDOM } = require('jsdom');
const dom = new JSDOM('');
const cache = {};
function load(name) {
  if (cache[name]) return cache[name];
  const file = `app/components/quizEngine/${name}`;
  const mod = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports','require','document',code)(mod.exports,name=>load(name.replace('./','')),dom.window.document);
  return cache[name]=mod.exports;
}
const { readQrSnippet, updateQrSnippet } = load('qrStylerModel.ts');
test('QR controls edit the source while preserving image layout and sync manual parameters', () => {
  const original = '<img class="custom-qr" width="120" style="float:right" src="{{certificate.qr_code_data_uri.color_003e8e.dots_rounded.ecc_Q}}" alt="Verify" />';
  const edited = updateQrSnippet(original,{color:null,gradient:'linear_003e8e_102443_45',corners:'extra-rounded'});
  const {image,parameters}=readQrSnippet(edited);
  assert.equal(parameters.ecc,'Q');
  assert.equal(parameters.gradient,'linear_003e8e_102443_45');
  assert.equal(parameters.color,undefined);
  assert.equal(image.getAttribute('class'),'custom-qr');
  assert.equal(image.getAttribute('width'),'120');
  assert.equal(image.getAttribute('style'),'float:right');
  assert.equal(image.getAttribute('alt'),'Verify');
  assert.equal(readQrSnippet(edited.replace('dots_rounded','dots_square')).parameters.dots,'square');
});
test('invalid QR contrast remains editable and malformed or active markup is rejected', () => {
  const badContrast='<img src="{{certificate.qr_code_data_uri.color_ffffff}}">';
  assert.equal(readQrSnippet(updateQrSnippet(badContrast,{color:'003e8e'})).parameters.color,'003e8e');
  for(const code of ['<script>alert(1)</script>','<img src="https://example.com">','<img src="{{certificate.qr_code_data_uri}}" onerror="bad()">','<img src="{{certificate.qr_code_data_uri}}"><p>extra</p>']) assert.throws(()=>readQrSnippet(code));
});
