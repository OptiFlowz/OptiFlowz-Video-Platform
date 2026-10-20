import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  createQuestionCategorySchema, updateQuestionCategorySchema, listQuestionCategoriesSchema,
  mapQuestionCategoryWriteError, syncQuestionCategoryQuestionsSchema,
} from '../src/modules/quizzes-engine/question-categories/helpers/question-categories.validation.js';

test('category creation trims text and defaults the optional description to null', () => {
  assert.deepEqual(createQuestionCategorySchema.parse({ name: ' Languages ' }), { name: 'Languages', description: null });
  assert.deepEqual(createQuestionCategorySchema.parse({ name: 'Languages', description: ' Practice ' }), { name: 'Languages', description: 'Practice' });
  assert.ok(createQuestionCategorySchema.safeParse({ name: 'x'.repeat(255), description: null }).success);
});

test('invalid names, spoofed fields and membership payloads are rejected', () => {
  for (const input of [
    undefined, null, {}, { name: null }, { name: ' ' }, { name: 'x'.repeat(256) },
    { name: 'A', description: 3 }, { name: 'A', id: 'spoofed' },
    { name: 'A', user_id: 'spoofed' }, { name: 'A', question_ids: [] },
    { name: 'A', questions: [] }, { name: 'A', items: [] },
  ]) assert.equal(createQuestionCategorySchema.safeParse(input).success, false);
});

test('partial category edits can clear description but cannot be empty or change ownership', () => {
  assert.deepEqual(updateQuestionCategorySchema.parse({ name: ' New name ' }), { name: 'New name' });
  assert.deepEqual(updateQuestionCategorySchema.parse({ description: null }), { description: null });
  for (const input of [{}, { name: '' }, { user_id: 'spoofed' }, { categoryId: 'spoofed' }, { questions: [] }]) {
    assert.equal(updateQuestionCategorySchema.safeParse(input).success, false);
  }
});

test('list uses page-based pagination, name filtering and allowlisted sort parameters', () => {
  assert.deepEqual(listQuestionCategoriesSchema.parse({}), { sortBy: 'name', sortOrder: 'asc', page: 1, limit: 20 });
  assert.deepEqual(listQuestionCategoriesSchema.parse({ name: ' LANGUAGE ', page: '2', limit: '1', sortBy: 'id', sortOrder: 'desc' }),
    { name: 'LANGUAGE', sortBy: 'id', sortOrder: 'desc', page: 2, limit: 1 });
  assert.equal(listQuestionCategoriesSchema.parse({ name: ' ' }).name, '');
  for (const input of [
    { name: ['A'] }, { name: 'x'.repeat(256) }, { page: '0' }, { page: '-1' },
    { page: '1.5' }, { limit: '0' }, { limit: '101' }, { offset: '1' },
    { sortBy: 'name; DROP TABLE question_categories' }, { sortOrder: 'ASC' },
    { page: String(Number.MAX_SAFE_INTEGER), limit: '100' }, { user_id: 'spoofed' },
  ]) assert.equal(listQuestionCategoriesSchema.safeParse(input).success, false);
});

test('only the category name uniqueness violation maps to a 409', () => {
  const duplicate = mapQuestionCategoryWriteError(Object.assign(new Error('duplicate'), { code: '23505', constraint: 'question_categories_user_name_key' }));
  assert.equal(duplicate.status, 409);
  const failure = Object.assign(new Error('Other database error'), { code: '23505', constraint: 'other_constraint' });
  assert.equal(mapQuestionCategoryWriteError(failure), failure);
});

test('membership PUT requires a UUID array, deduplicates IDs and accepts explicit clearing', () => {
  const questionId = '12345678-abcd-4234-8234-123456789abc';
  assert.deepEqual(syncQuestionCategoryQuestionsSchema.parse({ question_ids: [questionId, questionId.toUpperCase()] }), { question_ids: [questionId] });
  assert.deepEqual(syncQuestionCategoryQuestionsSchema.parse({ question_ids: [] }), { question_ids: [] });
  for (const input of [undefined, null, [], {}, { question_ids: null }, { question_ids: questionId },
    { question_ids: ['invalid'] }, { question_ids: [1] }, { question_ids: [], user_id: 'spoofed' }, { question_ids: [], name: 'Override' }]) {
    assert.equal(syncQuestionCategoryQuestionsSchema.safeParse(input).success, false);
  }
});

let databaseCalls = 0;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: {
    async query() { databaseCalls++; throw new Error('Unexpected database access'); },
    async connect() { databaseCalls++; throw new Error('Unexpected database access'); },
  } },
});
const { createQuestionCategoryInternal: create } = await import('../src/modules/quizzes-engine/question-categories/handlers/createQuestionCategory.js');
const { getQuestionCategoryInternal: get } = await import('../src/modules/quizzes-engine/question-categories/handlers/getQuestionCategory.js');
const { getQuestionCategoriesInternal: list } = await import('../src/modules/quizzes-engine/question-categories/handlers/getQuestionCategories.js');
const { updateQuestionCategoryInternal: update } = await import('../src/modules/quizzes-engine/question-categories/handlers/updateQuestionCategory.js');
const { deleteQuestionCategoryInternal: remove } = await import('../src/modules/quizzes-engine/question-categories/handlers/deleteQuestionCategory.js');
const { syncQuestionCategoryQuestionsInternal: sync } = await import('../src/modules/quizzes-engine/question-categories/handlers/syncQuestionCategoryQuestions.js');
const userId = '12345678-1234-4234-8234-123456789abc';
const params = { categoryId: userId };

test('every handler rejects unauthenticated or invalid requests before database access', async () => {
  await assert.rejects(create({ name: 'A' }), { status: 401 });
  await assert.rejects(get(params), { status: 401 });
  await assert.rejects(list({}), { status: 401 });
  await assert.rejects(update(params, { name: 'A' }), { status: 401 });
  await assert.rejects(remove(params), { status: 401 });
  await assert.rejects(sync(params, { question_ids: [] }), { status: 401 });
  await assert.rejects(create({ name: 'A', user_id: userId }, userId), { status: 400 });
  await assert.rejects(get({ categoryId: 'invalid' }, userId), { status: 400 });
  await assert.rejects(list({ limit: '101' }, userId), { status: 400 });
  await assert.rejects(update(params, {}, userId), { status: 400 });
  await assert.rejects(remove({ categoryId: 'invalid' }, userId), { status: 400 });
  await assert.rejects(sync({ categoryId: 'invalid' }, { question_ids: [] }, userId), { status: 400 });
  await assert.rejects(sync(params, {}, userId), { status: 400 });
  await assert.rejects(sync(params, { question_ids: ['invalid'] }, userId), { status: 400 });
  assert.equal(databaseCalls, 0);
});
