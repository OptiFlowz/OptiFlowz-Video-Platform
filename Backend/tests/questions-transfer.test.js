import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { importMoodleXml, exportMoodleXml, MAX_XML_BYTES } from '../src/modules/quizzes-engine/questions/helpers/moodleXml.js';
const fixture = await readFile(new URL('./fixtures/moodle-questions.xml', import.meta.url), 'utf8');

test('Moodle XML maps categories, HTML/CDATA, Unicode, weights, correct choices and shared matching answers', () => {
  const { questions, warnings } = importMoodleXml(fixture);
  assert.deepEqual(questions.map(q => q.type), ['single_choice','multiple_choice','matching']);
  assert.deepEqual(questions.map(q => q.max_points),[2.75,4,3]);
  assert.equal(questions[0].content,'<p>Šta znači A & B?</p>');
  assert.equal(questions[0].categoryName,'Programiranje/Osnove');
  assert.equal(questions[2].categoryName,null);
  assert.deepEqual(questions[1].options.map(o => o.is_correct),[true,true,false]);
  assert.equal(questions[2].matching_items.length,3);
  assert.equal(questions[2].matching_options.length,3);
  assert.equal(questions[2].matching_items[0].correct_option_no,questions[2].matching_items[1].correct_option_no);
  assert.ok(warnings.some(w => w.code==='ANSWER_FEEDBACK_OMITTED'));
  assert.ok(warnings.some(w => w.code==='QUIZ_SCORING_APPLIES'));
});

test('all supported types survive export/import with answers, categories, points and explanation', () => {
  const before = importMoodleXml(fixture).questions;
  before[0].content += ' ]]> & < > "';
  const xml = exportMoodleXml(before.map((q,i) => ({...q,id:String(i),category:q.categoryName ? { name:q.categoryName } : null})));
  assert.match(xml,/encoding="UTF-8"/);
  const after = importMoodleXml(xml).questions;
  assert.deepEqual(after,before);
});

test('invalid, oversized, hostile XML and unsupported semantics are rejected before persistence', () => {
  for (const xml of [
    '<quiz><question></quiz>', '<other/>', '<quiz/>',
    '<!DOCTYPE quiz [<!ENTITY x SYSTEM "file:///etc/passwd">]><quiz>&x;</quiz>',
    '<quiz><question type="essay"/></quiz>',
    fixture.replace('fraction="50"','fraction="40"'),
    fixture.replace('<defaultgrade>2.75</defaultgrade>','<defaultgrade>0</defaultgrade>'),
    fixture.replace('Šta znači','@@PLUGINFILE@@/image.png'),
    fixture.replace('<single>true</single>','<file name="x">AAAA</file><single>true</single>'),
    fixture.replace('encoding="UTF-8"','encoding="ISO-8859-1"'),
    fixture.replace('<single>true</single>','<single>true</single><single>false</single>'),
  ]) assert.throws(() => importMoodleXml(xml),{status:422});
  assert.throws(() => importMoodleXml(' '.repeat(MAX_XML_BYTES)+'<quiz/>'),{status:413});
  assert.throws(() => importMoodleXml(''),{status:400});
});

test('truefalse and plain text are converted explicitly; invalid drafts cannot be exported', () => {
  const xml = '<quiz><question type="truefalse"><questiontext format="plain_text"><text>A &lt; B?</text></questiontext><answer fraction="100"><text>true</text></answer><answer fraction="0"><text>false</text></answer></question></quiz>';
  const parsed=importMoodleXml(xml);
  assert.equal(parsed.questions[0].type,'single_choice');
  assert.equal(parsed.questions[0].content,'A &lt; B?');
  assert.equal(parsed.questions[0].max_points,1);
  assert.throws(() => exportMoodleXml([{...parsed.questions[0],options:[]}]),{status:422});
});
