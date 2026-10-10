import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  createQuizSchema, updateQuizSchema, listQuizzesSchema,
} from '../src/modules/quizzes-engine/quizzes/helpers/quizzes.validation.js';

const body = { title: 'Quiz', question_count: 10 };

test('quiz creation trims text and applies all database-aligned defaults', () => {
  assert.deepEqual(createQuizSchema.parse({ ...body, title: ' Quiz ' }), {
    ...body, description: null, status: 'draft', time_limit_seconds: null, max_attempts: null,
    passing_score_percentage: 50, shuffle_questions: true, shuffle_options: true, has_certificate: false,
  });
  for (const status of ['draft', 'published', 'archived']) {
    assert.equal(createQuizSchema.parse({ ...body, status }).status, status);
  }
  for (const passing_score_percentage of [0, 100, 0.29, 75.25]) {
    assert.equal(createQuizSchema.parse({ ...body, passing_score_percentage }).passing_score_percentage, passing_score_percentage);
  }
});

test('invalid quiz settings, readonly fields and future membership fields are rejected', () => {
  const invalid = [
    undefined, null, {}, { title: 'Quiz' }, { ...body, title: ' ' }, { ...body, title: 'x'.repeat(256) },
    { ...body, status: 'unknown' }, { ...body, user_id: 'spoof' }, { ...body, id: 'spoof' },
    { ...body, created_at: '2026-01-01' }, { ...body, updated_at: '2026-01-01' },
    { ...body, question_ids: [] }, { ...body, group_ids: [] }, { ...body, description: 1 },
    { ...body, shuffle_questions: 'false' }, { ...body, shuffle_options: 0 }, { ...body, has_certificate: null },
  ];
  for (const field of ['question_count', 'time_limit_seconds', 'max_attempts']) {
    for (const value of [0, -1, 1.5, 2147483648, '1', Infinity, NaN]) invalid.push({ ...body, [field]: value });
  }
  for (const value of [-0.01, 100.01, 75.251, 0.001, '50', null, Infinity, NaN]) {
    invalid.push({ ...body, passing_score_percentage: value });
  }
  invalid.push({ ...body, question_count: null });
  for (const input of invalid) assert.equal(createQuizSchema.safeParse(input).success, false, JSON.stringify(input));
});

test('PATCH permits false, zero score and explicit null limits while preserving omission', () => {
  const updates = { description: null, time_limit_seconds: null, max_attempts: null, passing_score_percentage: 0,
    shuffle_questions: false, shuffle_options: false, has_certificate: false };
  assert.deepEqual(updateQuizSchema.parse(updates), updates);
  assert.deepEqual(updateQuizSchema.parse({ title: ' New title ' }), { title: 'New title' });
  for (const input of [{}, { title: '' }, { status: null }, { question_count: null }, { user_id: 'spoof' }, { question_ids: [] }]) {
    assert.equal(updateQuizSchema.safeParse(input).success, false);
  }
});

test('quiz listing validates title/status filters, page-based pagination and sorting', () => {
  assert.deepEqual(listQuizzesSchema.parse({}), { sortBy: 'created_at', sortOrder: 'asc', page: 1, limit: 20 });
  assert.deepEqual(listQuizzesSchema.parse({ title: ' PROGRAMMING ', status: 'published', page: '2', limit: '1', sortBy: 'passing_score_percentage', sortOrder: 'desc' }),
    { title: 'PROGRAMMING', status: 'published', sortBy: 'passing_score_percentage', sortOrder: 'desc', page: 2, limit: 1 });
  for (const input of [
    { title: ['A'] }, { title: 'x'.repeat(256) }, { status: 'invalid' }, { page: '0' }, { page: '1.5' },
    { limit: '101' }, { limit: '0' }, { offset: '1' }, { sortBy: 'title; DROP TABLE quizzes' },
    { sortOrder: 'ASC' }, { page: String(Number.MAX_SAFE_INTEGER), limit: '100' }, { user_id: 'spoof' },
  ]) assert.equal(listQuizzesSchema.safeParse(input).success, false);
});

let databaseCalls = 0;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { async query() { databaseCalls++; throw new Error('Unexpected database access'); } } },
});
const { createQuizInternal: create } = await import('../src/modules/quizzes-engine/quizzes/handlers/createQuiz.js');
const { getQuizInternal: get } = await import('../src/modules/quizzes-engine/quizzes/handlers/getQuiz.js');
const { getQuizzesInternal: list } = await import('../src/modules/quizzes-engine/quizzes/handlers/getQuizzes.js');
const { updateQuizInternal: update } = await import('../src/modules/quizzes-engine/quizzes/handlers/updateQuiz.js');
const { deleteQuizInternal: remove } = await import('../src/modules/quizzes-engine/quizzes/handlers/deleteQuiz.js');
const userId = '12345678-1234-4234-8234-123456789abc';
const params = { quizId: userId };

test('every quiz handler rejects unauthenticated and malformed input before database access', async () => {
  await assert.rejects(create(body), { status: 401 });
  await assert.rejects(get(params), { status: 401 });
  await assert.rejects(list({}), { status: 401 });
  await assert.rejects(update(params, { title: 'A' }), { status: 401 });
  await assert.rejects(remove(params), { status: 401 });
  await assert.rejects(create({ ...body, user_id: userId }, userId), { status: 400 });
  await assert.rejects(get({ quizId: 'invalid' }, userId), { status: 400 });
  await assert.rejects(list({ limit: '101' }, userId), { status: 400 });
  await assert.rejects(update(params, {}, userId), { status: 400 });
  await assert.rejects(remove({ quizId: 'invalid' }, userId), { status: 400 });
  assert.equal(databaseCalls, 0);
});
