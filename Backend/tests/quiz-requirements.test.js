import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import {
  createQuizRequirementSchema, updateQuizRequirementSchema, listQuizRequirementsSchema,
} from '../src/modules/quizzes-engine/quiz-requirements/helpers/quiz-requirements.validation.js';

const id = '12345678-1234-4234-8234-123456789abc';
const body = { quiz_id: id, video_id: id, min_watch_percentage: 75.25 };

test('invalid requirement bodies cannot bypass exclusive thresholds, precision, or immutable keys', () => {
  for (const input of [
    null, {}, { quiz_id: id, video_id: id }, { ...body, min_watch_seconds: 10 },
    { ...body, quiz_id: 'invalid' }, { ...body, video_id: 'invalid' },
    { ...body, min_watch_percentage: 0 }, { ...body, min_watch_percentage: 100.01 },
    { ...body, min_watch_percentage: 75.251 }, { ...body, min_watch_percentage: '75' },
    { ...body, min_watch_percentage: null, min_watch_seconds: 0 },
    { ...body, min_watch_percentage: null, min_watch_seconds: 1.5 },
    { ...body, min_watch_percentage: null, min_watch_seconds: 2147483648 },
    { ...body, min_watch_percentage: null, min_watch_seconds: '1' },
    { ...body, position: -1 }, { ...body, position: 1.5 }, { ...body, position: null },
    { ...body, user_id: id }, { ...body, video_card: {} },
  ]) assert.equal(createQuizRequirementSchema.safeParse(input).success, false, JSON.stringify(input));
  for (const input of [{}, { quiz_id: id }, { video_id: id }, { position: -1 }]) {
    assert.equal(updateQuizRequirementSchema.safeParse(input).success, false);
  }
});

test('requirements accept both threshold types, defaults, explicit clears and normalized IDs', () => {
  assert.deepEqual(createQuizRequirementSchema.parse({ ...body, quiz_id: id.toUpperCase() }),
    { ...body, min_watch_seconds: null, position: 0, is_active: true });
  for (const percentage of [0.01, 0.29, 100]) {
    assert.equal(createQuizRequirementSchema.parse({ ...body, min_watch_percentage: percentage }).min_watch_percentage, percentage);
  }
  assert.equal(createQuizRequirementSchema.parse({ quiz_id: id, video_id: id, min_watch_seconds: 1 }).min_watch_percentage, null);
  assert.deepEqual(updateQuizRequirementSchema.parse({ min_watch_percentage: null, min_watch_seconds: 60 }),
    { min_watch_percentage: null, min_watch_seconds: 60 });
  assert.deepEqual(updateQuizRequirementSchema.parse({ position: 0 }), { position: 0 });
});

test('requirement list validates pagination, allowlisted sorting and quiz filter', () => {
  assert.deepEqual(listQuizRequirementsSchema.parse({}), { sortBy: 'position', sortOrder: 'asc', page: 1, limit: 20 });
  assert.deepEqual(listQuizRequirementsSchema.parse({ quiz_id: id, page: '2', limit: '1', sortBy: 'min_watch_seconds', sortOrder: 'desc' }),
    { quiz_id: id, sortBy: 'min_watch_seconds', sortOrder: 'desc', page: 2, limit: 1 });
  for (const input of [
    { quiz_id: 'invalid' }, { page: '0' }, { page: '1.5' }, { limit: '101' }, { offset: '1' },
    { sortBy: 'position; DROP TABLE quizzes' }, { sortOrder: 'ASC' },
    { page: String(Number.MAX_SAFE_INTEGER), limit: '100' }, { user_id: id },
  ]) assert.equal(listQuizRequirementsSchema.safeParse(input).success, false);
});

let databaseCalls = 0;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: {
    async query() { databaseCalls++; throw new Error('Unexpected database access'); },
    async connect() { databaseCalls++; throw new Error('Unexpected database access'); },
  } },
});
const { createQuizRequirementInternal: create } = await import('../src/modules/quizzes-engine/quiz-requirements/handlers/createQuizRequirement.js');
const { getQuizRequirementInternal: get } = await import('../src/modules/quizzes-engine/quiz-requirements/handlers/getQuizRequirement.js');
const { getQuizRequirementsInternal: list } = await import('../src/modules/quizzes-engine/quiz-requirements/handlers/getQuizRequirements.js');
const { updateQuizRequirementInternal: update } = await import('../src/modules/quizzes-engine/quiz-requirements/handlers/updateQuizRequirement.js');
const { deleteQuizRequirementInternal: remove } = await import('../src/modules/quizzes-engine/quiz-requirements/handlers/deleteQuizRequirement.js');
const { checkQuizRequirementsInternal: check } = await import('../src/modules/quizzes-engine/quiz-requirements/handlers/checkQuizRequirements.js');
const { getQuizRequirementsProgressInternal: progress } = await import('../src/modules/quizzes-engine/quiz-requirements/handlers/getQuizRequirementsProgress.js');
const params = { quizId: id, videoId: id };

test('all requirement handlers reject missing users and malformed input before querying PostgreSQL', async () => {
  await assert.rejects(create(body), { status: 401 });
  await assert.rejects(get(params), { status: 401 });
  await assert.rejects(list({}), { status: 401 });
  await assert.rejects(update(params, { position: 1 }), { status: 401 });
  await assert.rejects(remove(params), { status: 401 });
  await assert.rejects(check(id), { status: 401 });
  await assert.rejects(check('invalid', id), { status: 400 });
  await assert.rejects(check(id, 'invalid'), { status: 400 });
  await assert.rejects(progress(id), { status: 401 });
  await assert.rejects(progress('invalid', id), { status: 400 });
  await assert.rejects(progress(id, 'invalid'), { status: 400 });
  await assert.rejects(create({ ...body, user_id: id }, id), { status: 400 });
  await assert.rejects(get({ quizId: id, videoId: 'invalid' }, id), { status: 400 });
  await assert.rejects(list({ limit: '101' }, id), { status: 400 });
  await assert.rejects(update(params, {}, id), { status: 400 });
  await assert.rejects(remove({ quizId: 'invalid', videoId: id }, id), { status: 400 });
  assert.equal(databaseCalls, 0);
});


test('is_active accepts only booleans and PATCH does not reset omitted values', () => {
  for (const is_active of [true, false]) {
    assert.equal(createQuizRequirementSchema.parse({ ...body, is_active }).is_active, is_active);
    assert.deepEqual(updateQuizRequirementSchema.parse({ is_active }), { is_active });
  }
  assert.equal('is_active' in updateQuizRequirementSchema.parse({ position: 1 }), false);
  for (const is_active of [null, 'false', 'true', 0, 1]) {
    assert.equal(createQuizRequirementSchema.safeParse({ ...body, is_active }).success, false);
    assert.equal(updateQuizRequirementSchema.safeParse({ is_active }).success, false);
  }
});
