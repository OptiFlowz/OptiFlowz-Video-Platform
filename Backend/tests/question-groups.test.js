import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  createQuestionGroupSchema, updateQuestionGroupSchema, listQuestionGroupsSchema,
  mapQuestionGroupWriteError, syncQuestionGroupQuestionsSchema,
} from '../src/modules/quizzes-engine/question-groups/helpers/question-groups.validation.js';

test('group creation trims text and defaults the optional description to null', () => {
  assert.deepEqual(createQuestionGroupSchema.parse({ name: ' Languages ' }), { name: 'Languages', description: null });
  assert.deepEqual(createQuestionGroupSchema.parse({ name: 'Languages', description: ' Practice ' }), { name: 'Languages', description: 'Practice' });
  assert.ok(createQuestionGroupSchema.safeParse({ name: 'x'.repeat(255), description: null }).success);
});

test('invalid names, spoofed fields and membership payloads are rejected', () => {
  for (const input of [
    undefined, null, {}, { name: null }, { name: ' ' }, { name: 'x'.repeat(256) },
    { name: 'A', description: 3 }, { name: 'A', id: 'spoofed' },
    { name: 'A', user_id: 'spoofed' }, { name: 'A', question_ids: [] },
    { name: 'A', questions: [] }, { name: 'A', items: [] },
  ]) assert.equal(createQuestionGroupSchema.safeParse(input).success, false);
});

test('partial group edits can clear description but cannot be empty or change ownership', () => {
  assert.deepEqual(updateQuestionGroupSchema.parse({ name: ' New name ' }), { name: 'New name' });
  assert.deepEqual(updateQuestionGroupSchema.parse({ description: null }), { description: null });
  for (const input of [{}, { name: '' }, { user_id: 'spoofed' }, { groupId: 'spoofed' }, { questions: [] }]) {
    assert.equal(updateQuestionGroupSchema.safeParse(input).success, false);
  }
});

test('list uses page-based pagination, name filtering and allowlisted sort parameters', () => {
  assert.deepEqual(listQuestionGroupsSchema.parse({}), { sortBy: 'name', sortOrder: 'asc', page: 1, limit: 20 });
  assert.deepEqual(listQuestionGroupsSchema.parse({ name: ' LANGUAGE ', page: '2', limit: '1', sortBy: 'id', sortOrder: 'desc' }),
    { name: 'LANGUAGE', sortBy: 'id', sortOrder: 'desc', page: 2, limit: 1 });
  assert.equal(listQuestionGroupsSchema.parse({ name: ' ' }).name, '');
  for (const input of [
    { name: ['A'] }, { name: 'x'.repeat(256) }, { page: '0' }, { page: '-1' },
    { page: '1.5' }, { limit: '0' }, { limit: '101' }, { offset: '1' },
    { sortBy: 'name; DROP TABLE question_groups' }, { sortOrder: 'ASC' },
    { page: String(Number.MAX_SAFE_INTEGER), limit: '100' }, { user_id: 'spoofed' },
  ]) assert.equal(listQuestionGroupsSchema.safeParse(input).success, false);
});

test('only the group name uniqueness violation maps to a 409', () => {
  const duplicate = mapQuestionGroupWriteError(Object.assign(new Error('duplicate'), { code: '23505', constraint: 'question_groups_user_name_key' }));
  assert.equal(duplicate.status, 409);
  const failure = Object.assign(new Error('Other database error'), { code: '23505', constraint: 'other_constraint' });
  assert.equal(mapQuestionGroupWriteError(failure), failure);
});

test('membership PUT requires a UUID array, deduplicates IDs and accepts explicit clearing', () => {
  const questionId = '12345678-abcd-4234-8234-123456789abc';
  assert.deepEqual(syncQuestionGroupQuestionsSchema.parse({ question_ids: [questionId, questionId.toUpperCase()] }), { question_ids: [questionId] });
  assert.deepEqual(syncQuestionGroupQuestionsSchema.parse({ question_ids: [] }), { question_ids: [] });
  for (const input of [undefined, null, [], {}, { question_ids: null }, { question_ids: questionId },
    { question_ids: ['invalid'] }, { question_ids: [1] }, { question_ids: [], user_id: 'spoofed' }, { question_ids: [], name: 'Override' }]) {
    assert.equal(syncQuestionGroupQuestionsSchema.safeParse(input).success, false);
  }
});

let databaseCalls = 0;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: {
    async query() { databaseCalls++; throw new Error('Unexpected database access'); },
    async connect() { databaseCalls++; throw new Error('Unexpected database access'); },
  } },
});
const { createQuestionGroupInternal: create } = await import('../src/modules/quizzes-engine/question-groups/handlers/createQuestionGroup.js');
const { getQuestionGroupInternal: get } = await import('../src/modules/quizzes-engine/question-groups/handlers/getQuestionGroup.js');
const { getQuestionGroupsInternal: list } = await import('../src/modules/quizzes-engine/question-groups/handlers/getQuestionGroups.js');
const { updateQuestionGroupInternal: update } = await import('../src/modules/quizzes-engine/question-groups/handlers/updateQuestionGroup.js');
const { deleteQuestionGroupInternal: remove } = await import('../src/modules/quizzes-engine/question-groups/handlers/deleteQuestionGroup.js');
const { syncQuestionGroupQuestionsInternal: sync } = await import('../src/modules/quizzes-engine/question-groups/handlers/syncQuestionGroupQuestions.js');
const userId = '12345678-1234-4234-8234-123456789abc';
const params = { groupId: userId };

test('every handler rejects unauthenticated or invalid requests before database access', async () => {
  await assert.rejects(create({ name: 'A' }), { status: 401 });
  await assert.rejects(get(params), { status: 401 });
  await assert.rejects(list({}), { status: 401 });
  await assert.rejects(update(params, { name: 'A' }), { status: 401 });
  await assert.rejects(remove(params), { status: 401 });
  await assert.rejects(sync(params, { question_ids: [] }), { status: 401 });
  await assert.rejects(create({ name: 'A', user_id: userId }, userId), { status: 400 });
  await assert.rejects(get({ groupId: 'invalid' }, userId), { status: 400 });
  await assert.rejects(list({ limit: '101' }, userId), { status: 400 });
  await assert.rejects(update(params, {}, userId), { status: 400 });
  await assert.rejects(remove({ groupId: 'invalid' }, userId), { status: 400 });
  await assert.rejects(sync({ groupId: 'invalid' }, { question_ids: [] }, userId), { status: 400 });
  await assert.rejects(sync(params, {}, userId), { status: 400 });
  await assert.rejects(sync(params, { question_ids: ['invalid'] }, userId), { status: 400 });
  assert.equal(databaseCalls, 0);
});
