import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  createQuestionSchema, updateQuestionSchema, listQuestionsSchema,
  mergeQuestionUpdates, validateQuestionForActivation,
} from '../src/modules/quizzes/questions/helpers/questions.validation.js';

const option = { option_no: 7, content: 'Answer', is_correct: true, position: 1 };
const choice = { type: 'single_choice', content: 'Question', options: [option] };
const matching = {
  type: 'matching', content: 'Match the language',
  matching_options: [{ option_no: 10, content: 'Language', position: 1 }],
  matching_items: [
    { item_no: 3, content: 'Python', correct_option_no: 10, position: 1 },
    { item_no: 8, content: 'JavaScript', correct_option_no: 10, position: 1 },
  ],
};

test('drafts may be incomplete and matching options can answer multiple items', () => {
  for (const type of ['single_choice', 'multiple_choice', 'matching']) {
    assert.ok(createQuestionSchema.safeParse({ type, content: '' }).success);
  }
  assert.ok(createQuestionSchema.safeParse({ ...choice, options: [] }).success);
  assert.ok(createQuestionSchema.safeParse({ ...choice, options: [option, { ...option, option_no: 9 }] }).success);
  assert.ok(createQuestionSchema.safeParse(matching).success);
  assert.equal(createQuestionSchema.parse({ ...choice, content: ' Question ', options: [{ ...option, is_correct: undefined }] }).options[0].is_correct, false);
});

test('invalid types, cross-type children, duplicates, references and numeric values are rejected', () => {
  const invalid = [
    null, {}, { ...choice, type: 'unknown' }, { ...choice, content: null },
    { ...choice, user_id: 'spoofed' }, { ...choice, id: 'spoofed' },
    { ...choice, matching_options: matching.matching_options },
    { ...matching, options: [option] },
    { ...choice, options: [option, option] },
    { ...matching, matching_options: [...matching.matching_options, ...matching.matching_options] },
    { ...matching, matching_items: [matching.matching_items[0], matching.matching_items[0]] },
    { ...matching, matching_options: [] },
    { ...matching, matching_items: [{ ...matching.matching_items[0], correct_option_no: 1 }] },
  ];
  for (const value of [0, -1, 32768, 1.5, '1', Infinity]) {
    invalid.push({ ...choice, options: [{ ...option, option_no: value }] });
    invalid.push({ ...matching, matching_options: [{ ...matching.matching_options[0], option_no: value }] });
    invalid.push({ ...matching, matching_items: [{ ...matching.matching_items[0], item_no: value }] });
    invalid.push({ ...matching, matching_items: [{ ...matching.matching_items[0], correct_option_no: value }] });
  }
  for (const value of [0, -1, 2147483648, 1.5, '1', Infinity]) {
    invalid.push({ ...choice, options: [{ ...option, position: value }] });
    invalid.push({ ...matching, matching_options: [{ ...matching.matching_options[0], position: value }] });
    invalid.push({ ...matching, matching_items: [{ ...matching.matching_items[0], position: value }] });
  }
  for (const input of invalid) assert.equal(createQuestionSchema.safeParse(input).success, false, JSON.stringify(input));
});

test('PATCH preserves omitted children and validates references against the merged question', () => {
  const existing = createQuestionSchema.parse(matching);
  const edited = mergeQuestionUpdates(existing, { content: 'Updated', explanation: null });
  assert.deepEqual(edited.matching_options, existing.matching_options);
  assert.deepEqual(edited.matching_items, existing.matching_items);
  assert.throws(() => mergeQuestionUpdates(existing, { matching_options: [] }), { status: 400 });
  assert.deepEqual(mergeQuestionUpdates(existing, { type: 'single_choice' }).options, []);
  assert.deepEqual(mergeQuestionUpdates(existing, { type: 'single_choice' }).matching_items, []);
  for (const input of [{}, { user_id: 'spoof' }, { options: [option, option] }, { content: null }]) {
    assert.equal(updateQuestionSchema.safeParse(input).success, false);
  }
});

test('group_ids is optional, validated, normalized and treated as a membership set', () => {
  const groupId = '12345678-abcd-4234-8234-123456789abc';
  assert.equal('group_ids' in createQuestionSchema.parse(choice), false);
  assert.deepEqual(createQuestionSchema.parse({ ...choice, group_ids: [groupId, groupId.toUpperCase()] }).group_ids, [groupId]);
  assert.deepEqual(updateQuestionSchema.parse({ group_ids: [] }), { group_ids: [] });
  const existing = createQuestionSchema.parse({ ...choice, group_ids: [groupId] });
  assert.equal('group_ids' in mergeQuestionUpdates(existing, { content: 'Updated' }), false);
  assert.equal('group_ids' in mergeQuestionUpdates(existing, { type: 'matching' }), false);
  assert.deepEqual(mergeQuestionUpdates(existing, { group_ids: [] }).group_ids, []);
  for (const group_ids of [null, groupId, ['invalid'], [1], [groupId, null]]) {
    assert.equal(createQuestionSchema.safeParse({ ...choice, group_ids }).success, false);
    assert.equal(updateQuestionSchema.safeParse({ group_ids }).success, false);
  }
});

test('activation rules are separate from saving drafts', () => {
  assert.equal(validateQuestionForActivation(choice).type, 'single_choice');
  assert.equal(validateQuestionForActivation({ ...choice, type: 'multiple_choice', options: [option, { ...option, option_no: 8 }] }).type, 'multiple_choice');
  assert.equal(validateQuestionForActivation(matching).matching_items.length, 2);
  for (const input of [
    { ...choice, content: '' }, { ...choice, options: [] },
    { ...choice, options: [option, { ...option, option_no: 8 }] },
    { ...choice, type: 'multiple_choice', options: [{ ...option, is_correct: false }] },
    { ...choice, options: [{ ...option, content: '' }] },
    { type: 'matching', content: 'Question' },
  ]) assert.throws(() => validateQuestionForActivation(input), { status: 400 });
});

test('listing uses bounded pagination and permits only known filters', () => {
  assert.deepEqual(listQuestionsSchema.parse({}), { sortBy: 'created_at', sortOrder: 'asc', page: 1, limit: 20 });
  assert.deepEqual(listQuestionsSchema.parse({ type: 'matching', limit: '100', page: '2', sortBy: 'updated_at', sortOrder: 'desc' }),
    { type: 'matching', sortBy: 'updated_at', sortOrder: 'desc', page: 2, limit: 100 });
  assert.equal(listQuestionsSchema.parse({ page: 2, limit: 10 }).page, 2);
  for (const input of [
    { limit: '0' }, { limit: '101' }, { page: '-1' }, { page: '0' }, { page: '1.5' },
    { page: String(Number.MAX_SAFE_INTEGER), limit: '100' }, { offset: '1' },
    { limit: '1.5' }, { limit: '' }, { type: 'unknown' }, { user_id: 'spoof' },
    { sortBy: 'invalid' }, { sortBy: 'created_at; DROP TABLE questions' },
    { sortOrder: 'invalid' }, { sortOrder: 'ASC' },
  ]) assert.equal(listQuestionsSchema.safeParse(input).success, false);
});

let databaseCalls = 0;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: {
    async query() { databaseCalls++; throw new Error('Unexpected database access'); },
    async connect() { databaseCalls++; throw new Error('Unexpected database access'); },
  } },
});
const { createQuestionInternal: create } = await import('../src/modules/quizzes/questions/handlers/createQuestion.js');
const { updateQuestionInternal: update } = await import('../src/modules/quizzes/questions/handlers/updateQuestion.js');
const { getQuestionInternal: get } = await import('../src/modules/quizzes/questions/handlers/getQuestion.js');
const { getQuestionsInternal: list } = await import('../src/modules/quizzes/questions/handlers/getQuestions.js');
const { deleteQuestionInternal: remove } = await import('../src/modules/quizzes/questions/handlers/deleteQuestion.js');
const userId = '12345678-1234-4234-8234-123456789abc';
const params = { questionId: userId };

test('all handlers require login and reject invalid requests before database access', async () => {
  await assert.rejects(create(choice), { status: 401 });
  await assert.rejects(update(params, { content: 'Updated' }), { status: 401 });
  await assert.rejects(get(params), { status: 401 });
  await assert.rejects(list({}), { status: 401 });
  await assert.rejects(remove(params), { status: 401 });
  await assert.rejects(create({ ...choice, user_id: userId }, userId), { status: 400 });
  await assert.rejects(create({ ...choice, group_ids: ['invalid'] }, userId), { status: 400 });
  await assert.rejects(update(params, {}, userId), { status: 400 });
  await assert.rejects(update(params, { group_ids: null }, userId), { status: 400 });
  await assert.rejects(get({ questionId: 'bad' }, userId), { status: 400 });
  await assert.rejects(list({ limit: '101' }, userId), { status: 400 });
  await assert.rejects(remove({ questionId: 'bad' }, userId), { status: 400 });
  assert.equal(databaseCalls, 0);
});
