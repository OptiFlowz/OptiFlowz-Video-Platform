import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';
import pg from 'pg';

test('question CRUD against PostgreSQL session-local tables', { skip: !process.env.TEST_DATABASE_URL }, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  await client.query(`CREATE TEMP TABLE users (
    id uuid PRIMARY KEY, status text NOT NULL DEFAULT 'active', authz_version integer NOT NULL DEFAULT 1
  )`);
  const migration = await readFile(new URL('../src/database/migrations/1791590400001_add-questions.sql', import.meta.url), 'utf8');
  await client.query(migration.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
  const userId = randomUUID(), otherUserId = randomUUID();
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1), ($2)', [userId, otherUserId]);
  const { rows: [legacy] } = await client.query(
    "INSERT INTO pg_temp.questions(user_id,type,content) VALUES ($1,'matching','Before timestamp migration') RETURNING id", [otherUserId],
  );
  const timestampMigration = await readFile(new URL('../src/database/migrations/1791590400002_add-question-timestamps.sql', import.meta.url), 'utf8');
  const [timestampUp, timestampDown] = timestampMigration.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  await client.query(timestampUp);
  const groupMigration = await readFile(new URL('../src/database/migrations/1791590400003_add-question-groups.sql', import.meta.url), 'utf8');
  await client.query(groupMigration.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
  const groupIds = [];
  for (const name of ['Group A', 'Group B', 'Group C']) {
    groupIds.push((await client.query('INSERT INTO pg_temp.question_groups(user_id,name) VALUES ($1,$2) RETURNING id', [userId, name])).rows[0].id);
  }
  const foreignGroup = (await client.query("INSERT INTO pg_temp.question_groups(user_id,name) VALUES ($1,'Foreign group') RETURNING id", [otherUserId])).rows[0].id;
  let failChildWrite = false, failGroupSync = false, failQuestionDelete = false, releases = 0;
  const database = {
    async query(sql, params) {
      if (failChildWrite && /INSERT INTO public.question_(options|matching_options)/.test(sql)) {
        failChildWrite = false;
        throw new Error('Injected child write failure');
      }
      if (failGroupSync && /DELETE FROM public.question_group_items/.test(sql)) {
        failGroupSync = false;
        await client.query(sql.replaceAll('public.', 'pg_temp.'), params);
        throw new Error('Injected failure after membership removal');
      }
      if (failQuestionDelete && /DELETE FROM public.questions WHERE/.test(sql)) {
        failQuestionDelete = false;
        await client.query(sql.replaceAll('public.', 'pg_temp.'), params);
        throw new Error('Injected failure after question deletion');
      }
      return client.query(sql.replaceAll('public.', 'pg_temp.'), params);
    },
    release() { releases++; },
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, {
    namedExports: { writePool: { query: database.query, async connect() { return database; } } },
  });
  const { default: router } = await import('../src/modules/quizzes/quizzes.routes.js');
  const { createQuestionInternal: create } = await import('../src/modules/quizzes/questions/handlers/createQuestion.js');
  const { updateQuestionInternal: update } = await import('../src/modules/quizzes/questions/handlers/updateQuestion.js');
  const { deleteQuestionInternal: remove } = await import('../src/modules/quizzes/questions/handlers/deleteQuestion.js');
  const previousSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = 'questions-test-secret';
  t.after(() => { if (previousSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = previousSecret; });
  const token = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  const otherToken = jwt.sign({ sub: otherUserId, authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/quizzes', router);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/quizzes/questions`;
  async function request(method, path = '', body, bearer = token) {
    const response = await fetch(baseUrl + path, {
      method, headers: { 'Content-Type': 'application/json', ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, ...await response.json() };
  }
  const choiceBody = {
    type: 'single_choice', content: ' Select a language ', explanation: 'Original explanation',
    options: [
      { option_no: 20, content: 'CSS', position: 2 },
      { option_no: 5, content: 'Python', is_correct: true, position: 1 },
    ],
  };
  const matchingBody = {
    type: 'matching', content: 'Match technology to category',
    matching_options: [{ option_no: 10, content: 'Language', position: 1 }],
    matching_items: [
      { item_no: 7, content: 'Python', correct_option_no: 10, position: 2 },
      { item_no: 3, content: 'JavaScript', correct_option_no: 10, position: 1 },
    ],
  };
  let choice, matching;

  await t.test('timestamp migration backfills existing questions without losing data', async () => {
    const { rows: [question] } = await client.query('SELECT * FROM pg_temp.questions WHERE id=$1', [legacy.id]);
    assert.equal(question.content, 'Before timestamp migration');
    assert.ok(question.created_at instanceof Date);
    assert.equal(question.created_at.getTime(), question.updated_at.getTime());
  });

  await t.test('all five endpoints reject anonymous and temporary-token access', async () => {
    const temporary = jwt.sign({ sub: userId, purpose: 'two_factor' }, process.env.JWT_SECRET);
    for (const [method, path] of [['GET', ''], ['GET', `/${randomUUID()}`], ['POST', ''], ['PATCH', `/${randomUUID()}`], ['DELETE', `/${randomUUID()}`]]) {
      assert.equal((await request(method, path, undefined, null)).status, 401);
      assert.equal((await request(method, path, undefined, temporary)).status, 401);
    }
  });

  await t.test('creates and reads choice and matching questions with ordered stable identifiers', async () => {
    const created = await request('POST', '', choiceBody);
    assert.equal(created.status, 201); assert.equal(created.success, true);
    choice = created.question;
    assert.equal(choice.user_id, userId); assert.equal(choice.content, 'Select a language');
    assert.ok(Number.isFinite(Date.parse(choice.created_at)));
    assert.equal(choice.updated_at, choice.created_at);
    assert.deepEqual(choice.options.map(option => option.option_no), [5, 20]);
    assert.equal(choice.options[1].is_correct, false);
    assert.deepEqual((await request('GET', `/${choice.id}`)).question, choice);
    const matched = await request('POST', '', matchingBody);
    assert.equal(matched.status, 201); matching = matched.question;
    assert.ok(Number.isFinite(Date.parse(matching.created_at)));
    assert.equal(matching.updated_at, matching.created_at);
    assert.deepEqual(matching.options, []);
    assert.deepEqual(matching.matching_items.map(item => item.item_no), [3, 7]);
    assert.ok(matching.matching_items.every(item => item.correct_option_no === 10));
  });

  await t.test('lists only the owner’s questions with pagination, type filtering and totals beyond the last page', async () => {
    assert.equal((await request('POST', '', choiceBody, otherToken)).status, 201);
    const listed = await request('GET');
    assert.equal(listed.status, 200);
    assert.deepEqual(listed.pagination, { page: 1, limit: 20, total: 2, totalPages: 1, hasNextPage: false, hasPreviousPage: false });
    assert.deepEqual(listed.sorting, { sortBy: 'created_at', sortOrder: 'asc' });
    assert.ok(listed.questions.every(question => question.user_id === userId));
    assert.ok(listed.questions.every(question => Number.isFinite(Date.parse(question.created_at)) && Number.isFinite(Date.parse(question.updated_at))));
    assert.equal('total' in listed, false); assert.equal('offset' in listed, false);
    const filtered = await request('GET', '?type=matching&limit=1&page=1');
    assert.equal(filtered.pagination.total, 1); assert.equal(filtered.questions[0].id, matching.id);
    assert.equal(filtered.pagination.limit, 1); assert.equal(filtered.pagination.page, 1);
    const first = await request('GET', '?limit=1&page=1');
    const second = await request('GET', '?limit=1&page=2');
    assert.deepEqual(first.pagination, { page: 1, limit: 1, total: 2, totalPages: 2, hasNextPage: true, hasPreviousPage: false });
    assert.deepEqual(second.pagination, { page: 2, limit: 1, total: 2, totalPages: 2, hasNextPage: false, hasPreviousPage: true });
    assert.notEqual(first.questions[0].id, second.questions[0].id);
    const beyond = await request('GET', '?limit=1&page=100');
    assert.equal(beyond.pagination.total, 2); assert.deepEqual(beyond.questions, []);
    assert.equal(beyond.pagination.hasPreviousPage, true); assert.equal(beyond.pagination.hasNextPage, false);
    const empty = await request('GET', '?type=multiple_choice');
    assert.deepEqual(empty.questions, []);
    assert.deepEqual(empty.pagination, { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false });
  });

  await t.test('every allowed sort field supports asc and desc with stable page boundaries for ties', async () => {
    await client.query("UPDATE pg_temp.questions SET created_at='2026-01-01',updated_at='2026-03-02' WHERE id=$1", [choice.id]);
    await client.query("UPDATE pg_temp.questions SET created_at='2026-02-01',updated_at='2026-03-01' WHERE id=$1", [matching.id]);
    for (const [sortBy, ascendingIds] of [
      ['created_at', [choice.id, matching.id]], ['updated_at', [matching.id, choice.id]],
      ['content', [matching.id, choice.id]], ['type', [choice.id, matching.id]],
    ]) {
      for (const sortOrder of ['asc', 'desc']) {
        const response = await request('GET', `?sortBy=${sortBy}&sortOrder=${sortOrder}`);
        assert.equal(response.status, 200);
        assert.deepEqual(response.sorting, { sortBy, sortOrder });
        assert.deepEqual(response.questions.map(question => question.id), sortOrder === 'asc' ? ascendingIds : [...ascendingIds].reverse());
      }
    }
    await client.query("UPDATE pg_temp.questions SET created_at='2026-01-01' WHERE user_id=$1", [userId]);
    for (const sortOrder of ['asc', 'desc']) {
      const first = await request('GET', `?page=1&limit=1&sortOrder=${sortOrder}`);
      const second = await request('GET', `?page=2&limit=1&sortOrder=${sortOrder}`);
      assert.deepEqual([first.questions[0].id, second.questions[0].id], [choice.id, matching.id].sort());
    }
    choice = (await request('GET', `/${choice.id}`)).question;
    matching = (await request('GET', `/${matching.id}`)).question;
  });

  await t.test('partial edits preserve omitted fields and reordering changes positions without renumbering', async () => {
    const edited = await request('PATCH', `/${choice.id}`, { content: 'Updated', explanation: null });
    assert.equal(edited.status, 200); assert.equal(edited.question.explanation, null);
    assert.equal(edited.question.created_at, choice.created_at);
    assert.ok(Date.parse(edited.question.updated_at) > Date.parse(choice.updated_at));
    assert.deepEqual(edited.question.options, choice.options);
    const reordered = await request('PATCH', `/${choice.id}`, {
      options: choice.options.map(option => ({ ...option, position: option.option_no === 20 ? 1 : 2 })),
    });
    assert.equal(reordered.status, 200);
    assert.deepEqual(reordered.question.options.map(option => option.option_no), [20, 5]);
    assert.equal(reordered.question.options.find(option => option.option_no === 5).content, 'Python');
    assert.equal(reordered.question.content, 'Updated');
    assert.equal(reordered.question.created_at, choice.created_at);
    assert.ok(Date.parse(reordered.question.updated_at) > Date.parse(edited.question.updated_at));
    choice = reordered.question;
  });

  await t.test('matching edits reject dangling references and atomically replace options and item references', async () => {
    const invalid = await request('PATCH', `/${matching.id}`, { matching_options: [] });
    assert.equal(invalid.status, 400);
    assert.deepEqual((await request('GET', `/${matching.id}`)).question, matching);
    const edited = await request('PATCH', `/${matching.id}`, {
      matching_options: [{ option_no: 22, content: 'Programming language', position: 1 }],
      matching_items: matching.matching_items.map(item => ({ ...item, correct_option_no: 22, position: 4 - item.position })),
    });
    assert.equal(edited.status, 200); matching = edited.question;
    assert.deepEqual(matching.matching_options.map(option => option.option_no), [22]);
    assert.deepEqual(matching.matching_items.map(item => item.item_no), [7, 3]);
    assert.ok(matching.matching_items.every(item => item.correct_option_no === 22));
    await assert.rejects(client.query('DELETE FROM pg_temp.question_matching_options WHERE question_id=$1', [matching.id]), { code: '23503' });
  });

  await t.test('missing and foreign IDs return 404 without exposing or modifying another user’s question', async () => {
    for (const id of [choice.id, randomUUID()]) {
      assert.equal((await request('GET', `/${id}`, undefined, otherToken)).status, 404);
      assert.equal((await request('PATCH', `/${id}`, { content: 'Stolen' }, otherToken)).status, 404);
      assert.equal((await request('DELETE', `/${id}`, undefined, otherToken)).status, 404);
    }
    assert.deepEqual((await request('GET', `/${choice.id}`)).question, choice);
  });

  await t.test('invalid IDs, spoofed ownership, cross-type children, invalid pagination and empty PATCH return 400', async () => {
    for (const [method, path, body] of [
      ['GET', '/invalid'], ['DELETE', '/invalid'], ['PATCH', '/invalid', { content: 'x' }],
      ['PATCH', `/${choice.id}`, {}], ['PATCH', `/${choice.id}`, { user_id: otherUserId }],
      ['POST', '', { ...choiceBody, user_id: otherUserId }],
      ['POST', '', { ...choiceBody, created_at: '2026-01-01' }],
      ['PATCH', `/${choice.id}`, { updated_at: '2026-01-01' }],
      ['POST', '', { ...choiceBody, options: [choiceBody.options[0], choiceBody.options[0]] }],
      ['POST', '', { ...matchingBody, options: choiceBody.options }],
      ['POST', '', { ...matchingBody, matching_options: [] }],
      ['PATCH', `/${choice.id}`, { matching_options: matchingBody.matching_options }],
      ['GET', '?limit=101'], ['GET', '?type=invalid'], ['GET', '?page=0'], ['GET', '?page=-1'],
      ['GET', '?offset=1'], ['GET', '?sortBy=invalid'], ['GET', '?sortOrder=invalid'],
    ]) assert.equal((await request(method, path, body)).status, 400, `${method} ${path}`);
  });

  await t.test('type changes clear previous children while incomplete drafts remain editable', async () => {
    const draft = await request('POST', '', { type: 'single_choice', content: '' });
    assert.equal(draft.status, 201); assert.deepEqual(draft.question.options, []);
    const changed = await request('PATCH', `/${choice.id}`, { ...matchingBody, content: 'Converted' });
    assert.equal(changed.status, 200); assert.deepEqual(changed.question.options, []);
    assert.equal(changed.question.matching_items.length, 2);
    const back = await request('PATCH', `/${choice.id}`, { type: 'multiple_choice' });
    assert.equal(back.status, 200); assert.equal(back.question.content, 'Converted');
    assert.deepEqual(back.question.matching_items, []); assert.deepEqual(back.question.matching_options, []);
    assert.deepEqual(back.question.options, []);
    const twoCorrect = await request('PATCH', `/${choice.id}`, {
      type: 'single_choice', options: choiceBody.options.map(option => ({ ...option, is_correct: true })),
    });
    assert.equal(twoCorrect.status, 200); choice = twoCorrect.question;
  });

  await t.test('failed child writes roll back both parent and children and release connections', async () => {
    const count = async () => (await client.query('SELECT count(*)::int AS total FROM pg_temp.questions')).rows[0].total;
    const before = await count(), releasedBefore = releases;
    failChildWrite = true;
    await assert.rejects(create(choiceBody, userId), /Injected child write failure/);
    assert.equal(await count(), before);
    failChildWrite = true;
    await assert.rejects(update({ questionId: choice.id }, { content: 'Should roll back', options: choice.options }, userId), /Injected child write failure/);
    assert.deepEqual((await request('GET', `/${choice.id}`)).question, choice);
    assert.equal(releases, releasedBefore + 2);
  });

  await t.test('deleting questions cascades to choice options and matching options/items', async () => {
    for (const question of [choice, matching]) {
      assert.deepEqual(await request('DELETE', `/${question.id}`), { status: 200, success: true, deleted: true });
      assert.equal((await request('GET', `/${question.id}`)).status, 404);
      assert.equal((await request('DELETE', `/${question.id}`)).status, 404);
      for (const table of ['question_options', 'question_matching_options', 'question_matching_items']) {
        assert.equal((await client.query(`SELECT count(*)::int AS total FROM pg_temp.${table} WHERE question_id=$1`, [question.id])).rows[0].total, 0);
      }
    }
  });

  const memberships = async questionId => (await client.query(
    'SELECT group_id, ctid::text AS row_id FROM pg_temp.question_group_items WHERE question_id=$1 ORDER BY group_id', [questionId],
  )).rows;

  await t.test('all question types create answers and same-owner memberships atomically, deduplicating UUIDs', async () => {
    const created = [];
    for (const body of [choiceBody, { ...choiceBody, type: 'multiple_choice' }, matchingBody]) {
      const response = await request('POST', '', { ...body, group_ids: [groupIds[0], groupIds[0].toUpperCase(), groupIds[1]] });
      assert.equal(response.status, 201);
      const question = response.question;
      assert.deepEqual(question.group_ids, groupIds.slice(0, 2).sort());
      assert.equal((await memberships(question.id)).length, 2);
      assert.deepEqual((await request('GET', `/${question.id}`)).question, question);
      assert.equal(body.type === 'matching' ? question.matching_items.length : question.options.length,
        body.type === 'matching' ? body.matching_items.length : body.options.length);
      created.push(question);
    }
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.question_group_items WHERE group_id=$1', [groupIds[0]])).rows[0].n, 3);
    for (const question of created) {
      assert.equal((await request('DELETE', `/${question.id}`)).status, 200);
      assert.deepEqual(await memberships(question.id), []);
    }
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.question_groups')).rows[0].n, 4);
  });

  await t.test('PATCH adds and removes memberships, retains existing rows, and supports omission and an empty array', async () => {
    const response = await request('POST', '', { ...choiceBody, group_ids: groupIds.slice(0, 2) });
    assert.equal(response.status, 201);
    const questionId = response.question.id;
    const before = await memberships(questionId);
    const omitted = await request('PATCH', `/${questionId}`, { content: 'Metadata only' });
    assert.equal(omitted.status, 200); assert.deepEqual(omitted.question.group_ids, groupIds.slice(0, 2).sort());
    assert.deepEqual(await memberships(questionId), before);
    const changedType = await request('PATCH', `/${questionId}`, matchingBody);
    assert.equal(changedType.status, 200); assert.deepEqual(changedType.question.group_ids, groupIds.slice(0, 2).sort());
    assert.deepEqual(await memberships(questionId), before);
    const changed = await request('PATCH', `/${questionId}`, { group_ids: [groupIds[1], groupIds[2], groupIds[1]] });
    assert.equal(changed.status, 200); assert.deepEqual(changed.question.group_ids, groupIds.slice(1).sort());
    const after = await memberships(questionId);
    assert.equal(after.find(row => row.group_id === groupIds[1]).row_id, before.find(row => row.group_id === groupIds[1]).row_id);
    const repeated = await request('PATCH', `/${questionId}`, { group_ids: groupIds.slice(1) });
    assert.equal(repeated.status, 200); assert.deepEqual(await memberships(questionId), after);
    const cleared = await request('PATCH', `/${questionId}`, { group_ids: [] });
    assert.equal(cleared.status, 200); assert.deepEqual(cleared.question.group_ids, []);
    assert.deepEqual(await memberships(questionId), []);
    assert.equal(cleared.question.type, 'matching');
    assert.equal(cleared.question.matching_items.length, matchingBody.matching_items.length);
    assert.equal((await request('DELETE', `/${questionId}`)).status, 200);
  });

  await t.test('missing and foreign group IDs reject the whole request while preserving existing question data', async () => {
    const counts = async () => (await client.query(`SELECT
      (SELECT count(*)::int FROM pg_temp.questions) AS questions,
      (SELECT count(*)::int FROM pg_temp.question_options) AS options,
      (SELECT count(*)::int FROM pg_temp.question_group_items) AS memberships`)).rows[0];
    const beforeCreate = await counts();
    for (const invalidGroup of [randomUUID(), foreignGroup]) {
      const invalid = await request('POST', '', { ...choiceBody, group_ids: [groupIds[0], invalidGroup] });
      assert.equal(invalid.status, 404);
      assert.deepEqual(await counts(), beforeCreate);
    }
    const response = await request('POST', '', { ...choiceBody, group_ids: groupIds.slice(0, 2) });
    const question = response.question;
    const links = await memberships(question.id);
    for (const invalidGroup of [randomUUID(), foreignGroup]) {
      const invalid = await request('PATCH', `/${question.id}`, {
        content: 'Must not be saved', options: [], group_ids: [groupIds[2], invalidGroup],
      });
      assert.equal(invalid.status, 404);
      assert.deepEqual((await request('GET', `/${question.id}`)).question, question);
      assert.deepEqual(await memberships(question.id), links);
    }
    assert.equal((await request('PATCH', `/${question.id}`, { group_ids: [foreignGroup] }, otherToken)).status, 404);
    for (const group_ids of [null, 'not-an-array', ['invalid-uuid']]) {
      assert.equal((await request('POST', '', { ...choiceBody, group_ids })).status, 400);
      assert.equal((await request('PATCH', `/${question.id}`, { group_ids })).status, 400);
    }
    assert.equal((await request('DELETE', `/${question.id}`)).status, 200);
  });

  await t.test('membership write failure rolls back the question, answers, links and timestamp together', async () => {
    const count = async () => (await client.query('SELECT count(*)::int AS n FROM pg_temp.questions')).rows[0].n;
    const beforeCreate = await count(), releasedBefore = releases;
    failGroupSync = true;
    await assert.rejects(create({ ...choiceBody, group_ids: groupIds.slice(0, 2) }, userId), /Injected failure after membership removal/);
    assert.equal(await count(), beforeCreate);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.question_group_items')).rows[0].n, 0);
    const question = await create({ ...choiceBody, group_ids: groupIds.slice(0, 2) }, userId);
    const links = await memberships(question.id);
    failGroupSync = true;
    await assert.rejects(update({ questionId: question.id }, {
      content: 'Must roll back', options: [], group_ids: groupIds.slice(1),
    }, userId), /Injected failure after membership removal/);
    // Handler returns Date timestamps; compare the read through the same handler.
    const { getQuestionInternal: get } = await import('../src/modules/quizzes/questions/handlers/getQuestion.js');
    assert.deepEqual(await get({ questionId: question.id }, userId), question);
    assert.deepEqual(await memberships(question.id), links);
    assert.equal(releases, releasedBefore + 3);
    assert.equal((await request('DELETE', `/${question.id}`)).status, 200);
  });

  await t.test('DELETE runs transactionally, restores cascaded data on failure and preserves groups on success', async () => {
    const question = await create({ ...matchingBody, group_ids: groupIds.slice(0, 2) }, userId);
    const links = await memberships(question.id);
    const releasedBefore = releases;
    failQuestionDelete = true;
    await assert.rejects(remove({ questionId: question.id }, userId), /Injected failure after question deletion/);
    const { getQuestionInternal: get } = await import('../src/modules/quizzes/questions/handlers/getQuestion.js');
    assert.deepEqual(await get({ questionId: question.id }, userId), question);
    assert.deepEqual(await memberships(question.id), links);
    assert.equal(releases, releasedBefore + 1);
    assert.deepEqual(await remove({ questionId: question.id }, userId), { deleted: true });
    assert.deepEqual(await memberships(question.id), []);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.question_matching_items WHERE question_id=$1', [question.id])).rows[0].n, 0);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.question_groups WHERE id=ANY($1::uuid[])', [groupIds])).rows[0].n, 3);
  });

  await t.test('timestamp migration down removes only its columns and indexes', async () => {
    const { rows: [before] } = await client.query('SELECT count(*)::int AS total FROM pg_temp.questions');
    await client.query(timestampDown);
    assert.equal((await client.query('SELECT count(*)::int AS total FROM pg_temp.questions')).rows[0].total, before.total);
    const { rows: [question] } = await client.query('SELECT * FROM pg_temp.questions WHERE id=$1', [legacy.id]);
    assert.equal(question.content, 'Before timestamp migration');
    assert.equal('created_at' in question, false); assert.equal('updated_at' in question, false);
    const { rows: indexes } = await client.query("SELECT relname FROM pg_class WHERE relnamespace=pg_my_temp_schema() AND relname IN ('questions_user_created_at_idx','questions_user_updated_at_idx')");
    assert.deepEqual(indexes, []);
  });
});
