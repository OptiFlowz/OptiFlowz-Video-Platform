import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let databaseCalls = 0;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { async query() { databaseCalls++; throw new Error('Unexpected database access'); } } },
});
const { getQuizEligibilityInternal: eligibility } = await import('../src/modules/quizzes-engine/quiz-attempts/handlers/getQuizEligibility.js');

test('eligibility rejects unauthenticated users and malformed IDs before querying', async () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  await assert.rejects(eligibility(id), { status: 401 });
  await assert.rejects(eligibility('invalid', id), { status: 400 });
  await assert.rejects(eligibility(id, 'invalid'), { status: 400 });
  assert.equal(databaseCalls, 0);
});
