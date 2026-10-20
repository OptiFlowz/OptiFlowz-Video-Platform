import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createQuizSourceSchema, updateQuizSourceSchema, replaceQuizSourcesSchema, listQuizSourcesSchema } from '../src/modules/quizzes-engine/quiz-sources/helpers/quiz-sources.validation.js';

const id = '12345678-1234-4234-8234-123456789abc';
test('source schemas enforce positive counts, point precision, immutable IDs and unique categories', () => {
  assert.deepEqual(createQuizSourceSchema.parse({ category_id: id.toUpperCase(), question_count: 3 }), {
    category_id: id, question_count: 3, max_points: 1, position: 0,
  });
  for (const max_points of [0.01, 0.29, 33.33, 100]) assert.equal(createQuizSourceSchema.safeParse({ category_id: id, question_count: 2, max_points }).success, true);
  for (const data of [
    {}, { question_count: 0 }, { question_count: 1.5 }, { question_count: 2147483648 },
    { question_count: '1' }, { question_percentage: 0 }, { question_count: 3.01 },
    { question_percentage: 0.001 }, { question_percentage: Infinity }, { question_percentage: NaN },
    { question_count: null, question_percentage: null }, { question_count: 1, question_percentage: 50 },
    { question_count: 1, position: -1 }, { question_count: 1, position: 0.5 },
    { question_count: 1, quiz_id: id }, { question_count: 1, user_id: id },
  ]) assert.equal(createQuizSourceSchema.safeParse({ category_id: id, ...data }).success, false);
  assert.equal(updateQuizSourceSchema.safeParse({}).success, false);
  assert.equal(updateQuizSourceSchema.safeParse({ category_id: id }).success, false);
  assert.deepEqual(updateQuizSourceSchema.parse({ question_count: 2, max_points: 1.25 }), { question_count: 2, max_points: 1.25 });
  for (const max_points of [0,-1,1.001,NaN,Infinity,null,100000000]) assert.equal(createQuizSourceSchema.safeParse({category_id:id,question_count:1,max_points}).success,false);
  assert.equal(replaceQuizSourcesSchema.safeParse({ sources: [
    { category_id: id, question_count: 1 }, { category_id: id.toUpperCase(), question_count: 1 },
  ] }).success, false);
  assert.deepEqual(replaceQuizSourcesSchema.parse({ sources: [] }), { sources: [] });
});

test('source list validates pagination and allowlisted sorting', () => {
  assert.deepEqual(listQuizSourcesSchema.parse({}), { page: 1, limit: 20, sortBy: 'position', sortOrder: 'asc' });
  for (const input of [{ page: '0' }, { limit: '101' }, { sortBy: 'category_id; DROP TABLE quizzes' },
    { sortOrder: 'ASC' }, { user_id: id }, { page: String(Number.MAX_SAFE_INTEGER), limit: '100' }]) {
    assert.equal(listQuizSourcesSchema.safeParse(input).success, false);
  }
});

let calls = 0;
mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
  async query() { calls++; throw new Error('Unexpected database access'); },
  async connect() { calls++; throw new Error('Unexpected database access'); },
} } });
const { createQuizSourceInternal: create } = await import('../src/modules/quizzes-engine/quiz-sources/handlers/createQuizSource.js');
const { updateQuizSourceInternal: update } = await import('../src/modules/quizzes-engine/quiz-sources/handlers/updateQuizSource.js');
const { getQuizSourceInternal: get } = await import('../src/modules/quizzes-engine/quiz-sources/handlers/getQuizSource.js');
const { getQuizSourcesInternal: list } = await import('../src/modules/quizzes-engine/quiz-sources/handlers/getQuizSources.js');
const { deleteQuizSourceInternal: remove } = await import('../src/modules/quizzes-engine/quiz-sources/handlers/deleteQuizSource.js');
const { replaceQuizSourcesInternal: replace } = await import('../src/modules/quizzes-engine/quiz-sources/handlers/replaceQuizSources.js');
test('source handlers reject unauthenticated users and invalid requests before querying', async () => {
  const params = { quizId: id, sourceId: id };
  for (const operation of [() => create(params, {}), () => update(params, {}), () => get(params),
    () => list(params, {}), () => remove(params), () => replace(params, {})]) await assert.rejects(operation, { status: 401 });
  await assert.rejects(create(params, { category_id: id }, id), { status: 400 });
  await assert.rejects(update(params, {}, id), { status: 400 });
  await assert.rejects(get({ ...params, sourceId: 'bad' }, id), { status: 400 });
  await assert.rejects(remove({ ...params, quizId: 'bad' }, id), { status: 400 });
  await assert.rejects(list(params, { limit: '101' }, id), { status: 400 });
  await assert.rejects(replace(params, { sources: [{ category_id: 'bad', question_count: 1 }] }, id), { status: 400 });
  assert.equal(calls, 0);
});
