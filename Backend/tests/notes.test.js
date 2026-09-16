import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, beforeEach, mock, test } from 'node:test';
import express from 'express';
import jwt from 'jsonwebtoken';

const userId = '12345678-1234-4234-8234-123456789def';
const videoId = '12345678-1234-4234-8234-123456789abc';
const noteId = '12345678-1234-4234-8234-123456789aaa';
const body = { video_id: videoId, title: 'Key point', text: 'Review this', timestamp: 42.5 };
const note = { id: noteId, user_id: userId, ...body, color: null };
let steps = [], calls = [], released = 0;

async function query(sql, params) {
  calls.push({ sql, params });
  const step = steps.shift();
  assert.ok(step, `Unexpected query: ${sql}`);
  assert.match(sql, step.sql);
  if (step.params) assert.deepEqual(params, step.params);
  if (step.error) throw step.error;
  const rows = step.rows || [];
  return { rows, rowCount: rows.length };
}
const client = { query, release() { released++; } };
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { query, async connect() { return client; } } },
});

const { createNoteInternal: create } = await import('../src/modules/notes/handlers/createNote.js');
const { getVideoNotesInternal: list } = await import('../src/modules/notes/handlers/getVideoNotes.js');
const { editNoteInternal: edit } = await import('../src/modules/notes/handlers/editNote.js');
const { deleteNoteInternal: remove } = await import('../src/modules/notes/handlers/deleteNote.js');
const { default: notesRoutes } = await import('../src/modules/notes/notes.routes.js');

beforeEach(() => { steps = []; calls = []; released = 0; });

function createSteps(total = 0) {
  return [
    { sql: /^BEGIN ISOLATION LEVEL READ COMMITTED$/ },
    { sql: /SELECT id FROM public.users WHERE id = \$1 FOR UPDATE/, params: [userId], rows: [{ id: userId }] },
    { sql: /FROM public.videos[\s\S]*mux_status = 'ready'[\s\S]*visibility = 'public'[\s\S]*visibility = 'private' AND uploaded_by = \$2/, params: [videoId, userId], rows: [{ id: videoId }] },
    { sql: /COUNT\(\*\)[\s\S]*user_id = \$1 AND video_id = \$2/, params: [userId, videoId], rows: [{ total }] },
  ];
}

test('create locks the author before counting, permits the 100th note, and commits fractional seconds', async () => {
  steps = [...createSteps(99),
    { sql: /INSERT INTO public.notes/, params: [userId, videoId, body.title, body.text, 42.5, null], rows: [note] },
    { sql: /^COMMIT$/ },
  ];
  assert.deepEqual(await create(body, userId), note);
  assert.equal(steps.length, 0);
  assert.equal(released, 1);
});

test('the 101st note is rejected without inserting and releases the transaction', async () => {
  steps = [...createSteps(100), { sql: /^ROLLBACK$/ }];
  await assert.rejects(create(body, userId), { status: 409, message: 'You can create up to 100 notes per video' });
  assert.equal(calls.some(call => /INSERT/.test(call.sql)), false);
  assert.equal(steps.length, 0);
  assert.equal(released, 1);
});

test('a missing or inaccessible video rolls back before counting notes', async () => {
  steps = createSteps().slice(0, 3);
  steps[2].rows = [];
  steps.push({ sql: /^ROLLBACK$/ });
  await assert.rejects(create(body, userId), { status: 404 });
  assert.equal(steps.length, 0);
  assert.equal(released, 1);
});

test('database failure during insert rolls back and releases the connection', async () => {
  steps = [...createSteps(), { sql: /INSERT INTO public.notes/, error: new Error('insert failed') }, { sql: /^ROLLBACK$/ }];
  await assert.rejects(create(body, userId), /insert failed/);
  assert.equal(steps.length, 0);
  assert.equal(released, 1);
});

test('invalid input and attempted author spoofing fail before database access', async () => {
  for (const invalid of [
    undefined, null, {}, { ...body, video_id: 'bad' }, { ...body, title: ' ' },
    { ...body, text: ' ' }, { ...body, title: 'a'.repeat(201) },
    { ...body, text: 'a'.repeat(10001) }, { ...body, timestamp: -1 },
    { ...body, timestamp: Infinity }, { ...body, timestamp: NaN },
    { ...body, timestamp: '42.5' }, { ...body, color: '' },
    { ...body, color: 'a'.repeat(51) }, { ...body, user_id: userId },
  ]) await assert.rejects(create(invalid, userId), { status: 400 });
  await assert.rejects(edit({ id: 'bad' }, { title: 'Updated' }, userId), { status: 400 });
  await assert.rejects(remove({ id: 'bad' }, userId), { status: 400 });
  await assert.rejects(list({ videoId: 'bad' }, userId), { status: 400 });
  assert.deepEqual(calls, []);
});

test('all handlers require an authenticated user', async () => {
  await assert.rejects(create(body), { status: 401 });
  await assert.rejects(list({ videoId }), { status: 401 });
  await assert.rejects(edit({ id: noteId }, { title: 'Updated' }), { status: 401 });
  await assert.rejects(remove({ id: noteId }), { status: 401 });
  assert.deepEqual(calls, []);
});

test('list scopes notes to the caller and video and orders by playback position', async () => {
  steps = [createSteps()[2], {
    sql: /FROM public.notes[\s\S]*WHERE user_id = \$1 AND video_id = \$2[\s\S]*ORDER BY timestamp ASC, id ASC/,
    params: [userId, videoId], rows: [note],
  }];
  assert.deepEqual(await list({ videoId }, userId), { notes: [note] });
  assert.equal(steps.length, 0);
});

test('list does not fetch notes for an inaccessible video', async () => {
  steps = [{ ...createSteps()[2], rows: [] }];
  await assert.rejects(list({ videoId }, userId), { status: 404 });
  assert.equal(steps.length, 0);
});

test('partial edits are author scoped, preserve omitted fields, and can clear color', async () => {
  steps = [{
    sql: /UPDATE public.notes SET title = \$3, color = \$4[\s\S]*WHERE id = \$1 AND user_id = \$2/,
    params: [noteId, userId, 'Updated', null], rows: [{ ...note, title: 'Updated' }],
  }];
  assert.deepEqual(await edit({ id: noteId }, { title: ' Updated ', color: null }, userId), { ...note, title: 'Updated' });
  assert.equal(steps.length, 0);
});

test('empty edits, ownership changes, video changes, and unknown fields are rejected', async () => {
  for (const updates of [{}, { user_id: userId }, { video_id: videoId }, { unexpected: 'value' }, { timestamp: -1 }, { text: null }]) {
    await assert.rejects(edit({ id: noteId }, updates, userId), { status: 400 });
  }
  assert.deepEqual(calls, []);
});

test('edit and delete hide foreign or nonexistent notes behind 404', async () => {
  steps = [
    { sql: /UPDATE public.notes[\s\S]*WHERE id = \$1 AND user_id = \$2/, params: [noteId, userId, 'Updated'] },
    { sql: /DELETE FROM public.notes WHERE id = \$1 AND user_id = \$2/, params: [noteId, userId] },
  ];
  await assert.rejects(edit({ id: noteId }, { title: 'Updated' }, userId), { status: 404 });
  await assert.rejects(remove({ id: noteId }, userId), { status: 404 });
  assert.equal(steps.length, 0);
});

test('delete removes only the caller’s note', async () => {
  steps = [{ sql: /DELETE FROM public.notes WHERE id = \$1 AND user_id = \$2 RETURNING id/, params: [noteId, userId], rows: [{ id: noteId }] }];
  assert.deepEqual(await remove({ id: noteId }, userId), { deleted: true });
  assert.equal(steps.length, 0);
});

let server, baseUrl, token;
before(async () => {
  process.env.JWT_SECRET = 'notes-test-secret';
  token = jwt.sign({ sub: userId, authzVersion: 1 }, process.env.JWT_SECRET);
  const app = express();
  app.use(express.json());
  app.use('/api/notes', notesRoutes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/notes`;
});
after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

function authSteps(key, effect = 'allow') {
  return [
    { sql: /SELECT id, status, authz_version/, params: [userId], rows: [{ id: userId, status: 'active', authz_version: 1 }] },
    { sql: /FROM user_roles ur/, params: [userId], rows: [{ id: '1', name: 'Viewer', position: 4, is_owner: false }] },
    { sql: /bool_or/, params: [userId], rows: [{ id: '1', key, has_allow: effect === 'allow', has_deny: effect === 'deny' }] },
  ];
}

test('every HTTP route requires login and its own permission', async () => {
  for (const [method, path, permission] of [
    ['GET', `/video/${videoId}`, 'notes.read_own'], ['POST', '', 'notes.create'],
    ['PATCH', `/${noteId}`, 'notes.edit_own'], ['DELETE', `/${noteId}`, 'notes.delete_own'],
  ]) {
    let response = await fetch(baseUrl + path, { method });
    assert.equal(response.status, 401);
    await response.json();
    for (const effect of ['none', 'deny']) {
      steps = authSteps(permission, effect);
      response = await fetch(baseUrl + path, { method, headers: { Authorization: `Bearer ${token}` } });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).requiredPermission, permission);
      assert.equal(steps.length, 0);
    }
  }
});

test('authorized HTTP routes connect to the handlers and use shared response envelopes', async () => {
  for (const scenario of [
    { method: 'POST', path: '', permission: 'notes.create', body, status: 201, result: { note }, steps: [...createSteps(), { sql: /INSERT INTO public.notes/, rows: [note] }, { sql: /^COMMIT$/ }] },
    { method: 'GET', path: `/video/${videoId}`, permission: 'notes.read_own', status: 200, result: { notes: [note] }, steps: [createSteps()[2], { sql: /FROM public.notes/, params: [userId, videoId], rows: [note] }] },
    { method: 'PATCH', path: `/${noteId}`, permission: 'notes.edit_own', body: { timestamp: 0 }, status: 200, result: { note: { ...note, timestamp: 0 } }, steps: [{ sql: /UPDATE public.notes/, params: [noteId, userId, 0], rows: [{ ...note, timestamp: 0 }] }] },
    { method: 'DELETE', path: `/${noteId}`, permission: 'notes.delete_own', status: 200, result: { deleted: true }, steps: [{ sql: /DELETE FROM public.notes/, params: [noteId, userId], rows: [{ id: noteId }] }] },
  ]) {
    steps = [...authSteps(scenario.permission), ...scenario.steps];
    const response = await fetch(baseUrl + scenario.path, {
      method: scenario.method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: scenario.body ? JSON.stringify(scenario.body) : undefined,
    });
    assert.equal(response.status, scenario.status);
    assert.deepEqual(await response.json(), { success: true, ...scenario.result });
    assert.equal(steps.length, 0);
  }
});
