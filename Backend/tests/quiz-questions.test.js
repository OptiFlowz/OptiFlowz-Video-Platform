import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { createQuizQuestionSchema, updateQuizQuestionSchema, listQuizQuestionsSchema } from '../src/modules/quizzes-engine/quiz-questions/helpers/quiz-questions.validation.js';

const id = '12345678-1234-4234-8234-123456789abc';

test('candidate validation enforces positive two-decimal points, nonnegative positions and immutable IDs', () => {
  assert.deepEqual(createQuizQuestionSchema.parse({ question_id: id.toUpperCase() }), { question_id: id, position: 0, max_points: 1 });
  for (const max_points of [0.01, 0.29, 1, 99999999.99]) {
    assert.equal(createQuizQuestionSchema.parse({ question_id: id, max_points }).max_points, max_points);
  }
  for (const values of [
    { position: -1 }, { position: 0.1 }, { position: 2147483648 }, { position: null }, { position: '1' },
    { max_points: 0 }, { max_points: -1 }, { max_points: 1.001 }, { max_points: 100000000 },
    { max_points: null }, { max_points: NaN }, { max_points: Infinity }, { max_points: '1' },
    { quiz_id: id }, { user_id: id }, { content: 'Changed question' },
  ]) {
    assert.equal(createQuizQuestionSchema.safeParse({ question_id: id, ...values }).success, false);
    assert.equal(updateQuizQuestionSchema.safeParse(values).success, false);
  }
  assert.equal(updateQuizQuestionSchema.safeParse({ question_id: id }).success, false);
  assert.equal(updateQuizQuestionSchema.safeParse({}).success, false);
  assert.equal(createQuizQuestionSchema.safeParse({}).success, false);
  assert.deepEqual(updateQuizQuestionSchema.parse({ position: 0 }), { position: 0 });
});

test('candidate pagination and sorting reject unsupported fields and invalid offsets', () => {
  assert.deepEqual(listQuizQuestionsSchema.parse({}), { page: 1, limit: 20, sortBy: 'position', sortOrder: 'asc' });
  for (const query of [
    { page: '0' }, { page: '1.5' }, { limit: '0' }, { limit: '101' },
    { page: String(Number.MAX_SAFE_INTEGER), limit: '100' },
    { sortBy: 'position; DROP TABLE quizzes' }, { sortOrder: 'ASC' }, { user_id: id },
  ]) assert.equal(listQuizQuestionsSchema.safeParse(query).success, false);
});

let calls = 0;
mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: {
  async query() { calls++; throw new Error('Unexpected database access'); },
  async connect() { calls++; throw new Error('Unexpected database access'); },
} } });
const { createQuizQuestionInternal: create } = await import('../src/modules/quizzes-engine/quiz-questions/handlers/createQuizQuestion.js');
const { getQuizQuestionsInternal: list } = await import('../src/modules/quizzes-engine/quiz-questions/handlers/getQuizQuestions.js');
const { getQuizQuestionInternal: get } = await import('../src/modules/quizzes-engine/quiz-questions/handlers/getQuizQuestion.js');
const { updateQuizQuestionInternal: update } = await import('../src/modules/quizzes-engine/quiz-questions/handlers/updateQuizQuestion.js');
const { deleteQuizQuestionInternal: remove } = await import('../src/modules/quizzes-engine/quiz-questions/handlers/deleteQuizQuestion.js');

test('all candidate handlers reject missing users and invalid input before database access', async () => {
  const params = { quizId: id, questionId: id };
  await assert.rejects(create(params, { question_id: id }), { status: 401 });
  await assert.rejects(list(params, {}), { status: 401 });
  await assert.rejects(get(params), { status: 401 });
  await assert.rejects(update(params, { max_points: 2 }), { status: 401 });
  await assert.rejects(remove(params), { status: 401 });
  await assert.rejects(create({ quizId: 'invalid' }, { question_id: id }, id), { status: 400 });
  await assert.rejects(create(params, { question_id: 'invalid' }, id), { status: 400 });
  await assert.rejects(list(params, { limit: '101' }, id), { status: 400 });
  await assert.rejects(get({ ...params, questionId: 'invalid' }, id), { status: 400 });
  await assert.rejects(update(params, {}, id), { status: 400 });
  await assert.rejects(remove({ ...params, quizId: 'invalid' }, id), { status: 400 });
  assert.equal(calls, 0);
});
