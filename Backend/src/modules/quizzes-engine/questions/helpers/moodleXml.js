import { SaxesParser } from 'saxes';
import { HttpError } from '../../../../common/httpError.js';
import { validateQuestionForActivation } from './questions.validation.js';

export const MAX_XML_BYTES = 5 * 1024 * 1024;
export const MAX_QUESTIONS = 1000;
const fail = message => { throw new HttpError(422, { message }); };
const children = (node, name) => node.children.filter(child => child.name === name);
function child(node, name) {
  const found = children(node, name);
  if (found.length > 1) fail(`Duplicate Moodle element: ${name}`);
  return found[0];
}
const value = (node, name, fallback = '') => child(node, name)?.text.trim() ?? fallback;
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
const xmlText = value => `<text>${escape(value ?? '')}</text>`;
const field = (name, value) => `<${name} format="html">${xmlText(value)}</${name}>`;

function parseTree(xml) {
  if (typeof xml !== 'string' || !xml.trim()) throw new HttpError(400, { message: 'Provide a UTF-8 Moodle XML file' });
  if (Buffer.byteLength(xml) > MAX_XML_BYTES) throw new HttpError(413, { message: 'XML file exceeds 5 MiB' });
  const parser = new SaxesParser();
  const stack = [];
  let root, nodes = 0;
  parser.on('doctype', () => fail('DOCTYPE and custom entities are not supported'));
  parser.on('xmldecl', declaration => {
    if (declaration.encoding && !/^utf-?8$/i.test(declaration.encoding)) fail('The XML file must use UTF-8');
  });
  parser.on('opentag', tag => {
    if (++nodes > 100000 || stack.length >= 32) fail('XML structure exceeds supported limits');
    const node = { name: tag.name, attributes: tag.attributes, text: '', children: [] };
    if (stack.length) stack.at(-1).children.push(node); else root = node;
    stack.push(node);
  });
  const text = value => { if (stack.length) stack.at(-1).text += value; };
  parser.on('text', text);
  parser.on('cdata', text);
  parser.on('closetag', () => stack.pop());
  try { parser.write(xml).close(); }
  catch (error) { if (error instanceof HttpError) throw error; fail('Malformed Moodle XML'); }
  if (root?.name !== 'quiz' || root.text.trim() || root.children.some(node => node.name !== 'question')) fail('Expected a Moodle <quiz> containing <question> elements');
  return root;
}

function textValue(node) {
  if (!node) return '';
  const text = child(node, 'text');
  if (text?.children.length) fail('HTML inside <text> must be escaped or enclosed in CDATA');
  return text?.text.trim() ?? '';
}
function formatted(node) {
  const text = textValue(node);
  const format = node?.attributes.format ?? 'html';
  if (format === 'html') return text;
  if (format === 'plain_text') return escape(text).replaceAll('\n', '<br>');
  if (!text) return '';
  fail(`Unsupported text format: ${format}. Export using HTML or plain_text.`);
}
function inspect(node) {
  if (['file', 'image', 'image_base64'].includes(node.name) || node.text.includes('@@PLUGINFILE@@')) fail('Embedded Moodle files are not supported; use publicly accessible URLs');
  for (const nested of node.children) inspect(nested);
}
function validatePortable(question) {
  const fields = Object.fromEntries(['type', 'content', 'explanation', 'max_points', 'options', 'matching_options', 'matching_items'].map(key => [key, question[key]]));
  try { return validateQuestionForActivation(fields); }
  catch { fail('Question content, answers or points are invalid or incomplete'); }
}

export function importMoodleXml(xml) {
  const root = parseTree(xml), questions = [], warnings = [];
  let categoryName = null;
  for (const node of root.children) {
    inspect(node);
    if (node.attributes.type === 'category') {
      let path = textValue(child(node, 'category')).replace(/^\$[^$]+\$\//, '');
      if (path === 'top') path = ''; else path = path.replace(/^top\//, '');
      if (path.length > 255) fail('Category path exceeds 255 characters');
      categoryName = path.trim() || null;
      continue;
    }
    const index = questions.length + 1;
    if (index > MAX_QUESTIONS) fail('Import at most 1000 questions at once');
    try {
      const type = node.attributes.type;
      if (!['multichoice', 'matching', 'match', 'truefalse'].includes(type)) fail(`Unsupported Moodle question type: ${type}`);
      const question = { content: formatted(child(node, 'questiontext')), explanation: formatted(child(node, 'generalfeedback')) || null,
        max_points: Number(value(node, 'defaultgrade', '1')), options: [], matching_options: [], matching_items: [] };
      if (['matching', 'match'].includes(type)) {
        question.type = 'matching';
        const byText = new Map();
        for (const sub of children(node, 'subquestion')) {
          const answer = textValue(child(sub, 'answer'));
          if (!answer) fail('Matching answers must not be empty');
          if (!byText.has(answer)) {
            const option_no = byText.size + 1;
            byText.set(answer, option_no);
            question.matching_options.push({ option_no, content: answer, position: option_no });
          }
          const content = formatted(sub);
          if (content) {
            const item_no = question.matching_items.length + 1;
            question.matching_items.push({ item_no, content, correct_option_no: byText.get(answer), position: item_no });
          }
        }
      } else {
        const single = type === 'truefalse' ? 'true' : value(node, 'single', 'true');
        if (!['true', 'false', '1', '0'].includes(single)) fail('Invalid multichoice single flag');
        question.type = ['true', '1'].includes(single) ? 'single_choice' : 'multiple_choice';
        const fractions = [];
        for (const [i, answer] of children(node, 'answer').entries()) {
          const raw = answer.attributes.fraction;
          const fraction = raw === undefined || raw.trim() === '' ? NaN : Number(raw);
          if (!Number.isFinite(fraction) || fraction < -100 || fraction > 100) fail('Invalid answer fraction');
          fractions.push(fraction);
          question.options.push({ option_no: i + 1, content: formatted(answer), is_correct: fraction > 0, position: i + 1 });
          if (textValue(child(answer, 'feedback'))) warnings.push({ question: index, code: 'ANSWER_FEEDBACK_OMITTED', message: 'Per-answer feedback is not stored; general feedback is preserved.' });
        }
        const correct = fractions.filter(f => f > 0);
        if (question.type === 'single_choice' && (correct.length !== 1 || correct[0] !== 100)) fail('Single-choice questions require exactly one 100% answer');
        if (question.type === 'multiple_choice') {
          if (!correct.length || correct.some(f => Math.abs(f - 100 / correct.length) > 0.0001)) fail('Unequal positive answer weights are not supported');
          warnings.push({ question: index, code: 'QUIZ_SCORING_APPLIES', message: 'Correct options are preserved; partial-credit weights and penalties are governed by the quiz scoring_mode.' });
        }
        if (type === 'truefalse') warnings.push({ question: index, code: 'TRUEFALSE_AS_SINGLE_CHOICE', message: 'True/false is imported as a single-choice question.' });
      }
      if (node.children.some(n => ['hint', 'tags', 'correctfeedback', 'incorrectfeedback', 'partiallycorrectfeedback'].includes(n.name) && (n.children.length || n.text.trim()))) {
        warnings.push({ question: index, code: 'MOODLE_METADATA_OMITTED', message: 'Hints, tags and combined feedback are not stored.' });
      }
      questions.push({ ...validatePortable(question), categoryName });
    } catch (error) {
      if (error instanceof HttpError) fail(`Question ${index} (${textValue(child(node, 'name')) || 'unnamed'}): ${error.message}`);
      throw error;
    }
  }
  if (!questions.length) fail('The file contains no supported questions');
  return { questions, warnings };
}

export function exportMoodleXml(questions) {
  if (questions.length > MAX_QUESTIONS) fail('Export at most 1000 questions; narrow the filters');
  const parts = ['<?xml version="1.0" encoding="UTF-8"?>', '<quiz>'];
  let previous;
  for (const stored of questions) {
    let q;
    try { q = validatePortable(stored); } catch (error) { fail(`Question ${stored.id}: ${error.message}`); }
    const category = stored.category?.name ?? '';
    if (category !== previous) {
      parts.push(`<question type="category"><category>${xmlText('$course$/top' + (category ? '/' + category : ''))}</category></question>`);
      previous = category;
    }
    parts.push(`<question type="${q.type === 'matching' ? 'matching' : 'multichoice'}">`,
      `<name>${xmlText('Question ' + stored.id)}</name>`, field('questiontext', q.content), field('generalfeedback', q.explanation),
      `<defaultgrade>${q.max_points}</defaultgrade><penalty>0</penalty><hidden>0</hidden><shuffleanswers>0</shuffleanswers>`);
    if (q.type === 'matching') {
      const options = new Map(q.matching_options.map(o => [o.option_no, o]));
      if (new Set(q.matching_options.map(o => o.content)).size !== options.size) fail(`Question ${stored.id}: Moodle matching options must have distinct text`);
      const used = new Set(q.matching_items.map(i => i.correct_option_no));
      const pairs = q.matching_items.map(i => [i.content, options.get(i.correct_option_no).content]);
      for (const option of q.matching_options) if (!used.has(option.option_no)) pairs.push(['', option.content]);
      if (q.matching_items.length < 2 || pairs.length < 3) fail(`Question ${stored.id}: Moodle matching requires at least two items and three subquestions including distractors`);
      for (const [prompt, answer] of pairs) parts.push(`<subquestion format="html">${xmlText(prompt)}<answer>${xmlText(answer)}</answer></subquestion>`);
    } else {
      const single = q.type === 'single_choice', correct = q.options.filter(o => o.is_correct).length, wrong = q.options.length - correct;
      if (q.options.length < 2) fail(`Question ${stored.id}: Moodle requires at least two answer options`);
      parts.push(`<single>${single}</single><answernumbering>abc</answernumbering>`);
      for (const option of q.options) {
        const fraction = option.is_correct ? 100 / correct : single ? 0 : -100 / wrong;
        parts.push(`<answer fraction="${Number(fraction.toFixed(7))}" format="html">${xmlText(option.content)}<feedback format="html"><text></text></feedback></answer>`);
      }
    }
    parts.push('</question>');
  }
  parts.push('</quiz>');
  const xml = parts.join('\n');
  if (Buffer.byteLength(xml) > MAX_XML_BYTES) throw new HttpError(413, { message: 'Export exceeds 5 MiB; narrow the filters' });
  parseTree(xml); // Reject invalid XML characters stored in question text.
  return xml;
}
