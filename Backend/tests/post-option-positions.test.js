import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, afterEach, before, beforeEach, mock, test } from 'node:test';
import express from 'express';

const userId = '12345678-1234-4234-8234-123456789def';
const postId = '12345678-1234-4234-8234-123456789abc';
const blockId = '12345678-1234-4234-8234-123456789bbb';
// Deliberately opposite to UUID order.
const optionIds = ['ccc', 'aaa', 'ddd', 'eee'].map(end => `12345678-1234-4234-8234-123456789${end}`);
const authorization = { isOwner: true };
let steps, calls, released;

async function query(sql, params) {
  calls.push({ sql, params });
  const step = steps.shift();
  assert.ok(step, `Unexpected SQL: ${sql}`);
  assert.match(sql, step.sql);
  if (step.params) assert.deepEqual(params, step.params);
  if (step.error) throw step.error;
  return { rows: step.rows || [] };
}

mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { query, async connect() { return { query, release() { released++; } }; } } },
});
mock.module(new URL('../src/middleware/auth.js', import.meta.url).href, {
  namedExports: {
    requireAuth(req, _res, next) { req.user = { sub: userId }; req.authorization = authorization; next(); },
    optionalAuth(_req, _res, next) { next(); },
  },
});
// Avoid external image storage; verify files remain attached to request indices.
mock.module(new URL('../src/modules/posts/helpers/postImages.js', import.meta.url).href, {
  namedExports: {
    MAX_POST_IMAGE_BYTES: 5 * 1024 * 1024,
    POST_IMAGE_MIME_TYPES: ['image/png'],
    validateBlockFiles() {}, validatePostImageFile() {},
    async uploadPostImage(_postId, file) { return `image:${file.originalname}`; },
    async cleanupPostImages() {}, async deletePostImages() {},
    getPostImageObjects() { return []; },
  },
});

const { appendPostBlockInternal: append } = await import('../src/modules/posts/handlers/appendPostBlock.js');
const { addPostOptionInternal: add } = await import('../src/modules/posts/handlers/addPostOption.js');
const { editPostOptionInternal: edit } = await import('../src/modules/posts/handlers/editPostOption.js');
const { deletePostOptionInternal: remove } = await import('../src/modules/posts/handlers/deletePostOption.js');
const { votePostPollInternal: vote } = await import('../src/modules/posts/handlers/votePostPoll.js');
const { answerPostQuestionerInternal: answer } = await import('../src/modules/posts/handlers/answerPostQuestioner.js');
const { postBlocksSql } = await import('../src/modules/posts/helpers/postBlocksSql.js');
const { default: routes } = await import('../src/modules/posts/posts.routes.js');

beforeEach(() => { steps = []; calls = []; released = 0; });
afterEach(() => { assert.equal(steps.length, 0, 'All expected queries were executed'); });

function choices(type, count = 3) {
  return optionIds.slice(0, count).map((id, position) => ({
    id, block_id: blockId, text: `Choice ${position}`, image_url: null, position,
    ...(type === 'questioner' ? { is_correct: position === 0 } : {}),
  }));
}
function access() {
  return { sql: /SELECT id, user_id FROM public.posts/, rows: [{ id: postId, user_id: userId }] };
}
function mutation(type, options = choices(type), hasResponses = false) {
  return [
    { sql: /^BEGIN/ }, access(),
    { sql: /FROM public.post_blocks.*\s+WHERE.*FOR UPDATE/, rows: [{ id: blockId, post_id: postId, type }] },
    { sql: new RegExp(`FROM public.${type}_options.*ORDER BY position, id FOR UPDATE`), rows: options },
    { sql: /SELECT EXISTS/, rows: [{ has_responses: hasResponses }] },
  ];
}
function reorder(type, ids) {
  return [
    { sql: new RegExp(`UPDATE public.${type}_options SET position = position \\+ \\$2`) },
    { sql: /WITH ORDINALITY/, params: [blockId, ids] },
  ];
}
const params = { postId, blockId, optionId: optionIds[0] };

for (const type of ['poll', 'questioner']) {
  for (const explicit of [false, true]) {
    test(`${type} append persists ${explicit ? 'explicit positions and image associations' : 'request-array order by default'}`, async () => {
      const options = choices(type, 2).map(({ text, is_correct }, index) => ({
        text, ...(type === 'questioner' ? { is_correct } : {}),
        ...(explicit ? { position: 1 - index } : {}),
      }));
      const persisted = choices(type, 2).map((option, index) => ({
        ...option, position: explicit ? 1 - index : index,
        image_url: explicit ? `image:${index}.png` : null,
      }));
      steps = [
        { sql: /^BEGIN/ }, access(),
        { sql: /COUNT\(\*\)/, rows: [{ total: 0, next_position: 0 }] },
        { sql: /INSERT INTO public.post_blocks/, rows: [{ id: blockId, type, position: 0 }] },
        ...persisted.map(option => ({
          sql: new RegExp(`INSERT INTO public.${type}_options.*position`),
          params: [blockId, option.text, option.image_url, option.position,
            ...(type === 'questioner' ? [option.is_correct] : [])],
          rows: [option],
        })),
        { sql: /^COMMIT$/ },
      ];
      const files = explicit ? { option_0: [{ originalname: '0.png' }], option_1: [{ originalname: '1.png' }] } : {};
      const result = await append({ postId }, { type, content: { text: 'Pick' }, options }, files, userId, authorization);
      assert.deepEqual(result.options, persisted.toSorted((a, b) => a.position - b.position));
      assert.equal(released, 1);
    });
  }

  for (const position of [undefined, 0, 2]) {
    test(`${type} add ${position === undefined ? 'appends by default' : `inserts at ${position} and shifts existing options`}`, async () => {
      const inserted = { ...choices(type)[0], id: optionIds[3], position: 3 };
      const order = optionIds.slice(0, 3);
      order.splice(position ?? 3, 0, inserted.id);
      steps = [...mutation(type),
        { sql: /INSERT INTO.*position/, params: [blockId, 'New', null, 3, ...(type === 'questioner' ? [false] : [])], rows: [inserted] },
        ...(position === undefined ? [] : reorder(type, order)),
        { sql: /^COMMIT$/ },
      ];
      const result = await add(params, { text: 'New', ...(position === undefined ? {} : { position }) }, null, userId, authorization);
      assert.equal(result.position, position ?? 3);
      assert.equal(result.id, optionIds[3]);
    });
  }

  for (const [from, to] of [[0, 2], [2, 0]]) {
    test(`${type} position-only edit moves ${from} to ${to} without replacing IDs`, async () => {
      const options = choices(type);
      const option = options[from];
      const ordered = options.filter(item => item !== option);
      ordered.splice(to, 0, option);
      steps = [...mutation(type, options), ...reorder(type, ordered.map(item => item.id)),
        { sql: /UPDATE.*SET text = \$3/, rows: [{ ...option, position: to }] },
        { sql: /^COMMIT$/ },
      ];
      const result = await edit({ ...params, optionId: option.id }, { position: to }, null, userId, authorization);
      assert.equal(result.position, to);
      assert.equal(result.id, option.id);
      assert.equal(calls.some(call => /INSERT INTO|DELETE FROM/.test(call.sql)), false);
    });
  }

  test(`${type} delete closes the position gap`, async () => {
    steps = [...mutation(type),
      { sql: /DELETE FROM/, params: [optionIds[1], blockId] },
      ...reorder(type, [optionIds[0], optionIds[2]]), { sql: /^COMMIT$/ },
    ];
    assert.deepEqual(await remove({ ...params, optionId: optionIds[1] }, userId, authorization), {
      deleted: true, option_id: optionIds[1],
    });
  });

  test(`${type} rejects invalid position values before writing`, async () => {
    for (const position of [-1, 1.5, '1', null, 20, 3]) {
      steps = [...mutation(type).slice(0, position === 3 ? 5 : 4), { sql: /^ROLLBACK$/ }];
      await assert.rejects(edit(params, { position }, null, userId, authorization), { status: 400 });
      assert.equal(steps.length, 0);
    }
    steps = [...mutation(type), { sql: /^ROLLBACK$/ }];
    await assert.rejects(add(params, { text: 'New', position: 4 }, null, userId, authorization), { status: 400 });
    assert.equal(calls.some(call => /UPDATE|INSERT INTO/.test(call.sql.replaceAll('FOR UPDATE', ''))), false);
  });

  test(`${type} cannot reorder after responses`, async () => {
    steps = [...mutation(type, choices(type), true), { sql: /^ROLLBACK$/ }];
    await assert.rejects(edit(params, { position: 2 }, null, userId, authorization), { status: 409 });
  });

  test(`${type} rejects duplicate or out-of-range initial positions`, async () => {
    for (const positions of [[0, 0], [0, 2], [1, undefined]]) {
      const options = choices(type, 2).map(({ text, is_correct }, index) => ({
        text, position: positions[index], ...(type === 'questioner' ? { is_correct } : {}),
      }));
      await assert.rejects(append({ postId }, { type, content: { text: 'Pick' }, options }, {}, userId, authorization), { status: 400 });
    }
    assert.equal(calls.length, 0);
  });

  test(`${type} participation returns position-ordered choices with positions`, async () => {
    const options = choices(type);
    steps = [
      { sql: /^BEGIN/ },
      { sql: /FROM public.posts.*FOR UPDATE/, rows: [{ id: postId, user_id: userId, status: 'public' }] },
      { sql: /FROM public.post_blocks.*FOR UPDATE/, rows: [{ id: blockId, post_id: postId, type }] },
      { sql: /ORDER BY position, id FOR UPDATE/, rows: options },
      { sql: type === 'poll' ? /DELETE FROM public.poll_votes/ : /SELECT a.option_id/ },
      { sql: /INSERT INTO public\.(poll_votes|questioner_answers)/ },
      { sql: /COUNT\(r.user_id\)/, rows: [{ id: optionIds[0], response_count: 1 }] },
      { sql: /^COMMIT$/ },
    ];
    const result = await (type === 'poll' ? vote : answer)(params, { option_id: optionIds[0] }, userId, authorization);
    assert.deepEqual(result.options.map(option => [option.id, option.position]), options.map(option => [option.id, option.position]));
    assert.equal(result.options[0][type === 'poll' ? 'vote_count' : 'answer_count'], 1);
  });
}

test('feed and details SQL includes position and orders both option types by it', () => {
  const sql = postBlocksSql();
  assert.equal((sql.match(/'position', position/g) || []).length, 2);
  assert.equal((sql.match(/ORDER BY position, id/g) || []).length, 2);
});

test('failed reorder rolls back before committing', async () => {
  steps = [...mutation('poll'),
    { sql: /SET position = position/, error: new Error('write failed') },
    { sql: /^ROLLBACK$/ },
  ];
  await assert.rejects(edit(params, { position: 1 }, null, userId, authorization), /write failed/);
  assert.equal(released, 1);
});

let server, baseUrl;
before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/posts', routes);
  server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  baseUrl = `http://127.0.0.1:${server.address().port}/api/posts/${postId}/blocks/${blockId}/options/${optionIds[0]}`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); });

for (const multipart of [false, true]) {
  test(`option PATCH route accepts position-only ${multipart ? 'multipart data' : 'JSON'} and returns position`, async () => {
    steps = [access(), ...mutation('poll'), ...reorder('poll', [optionIds[1], optionIds[2], optionIds[0]]),
      { sql: /UPDATE.*SET text/, rows: [{ ...choices('poll')[0], position: 2 }] },
      { sql: /^COMMIT$/ },
    ];
    const form = new FormData();
    form.append('data', JSON.stringify({ position: 2 }));
    const response = await fetch(baseUrl, {
      method: 'PATCH', headers: multipart ? {} : { 'Content-Type': 'application/json' },
      body: multipart ? form : JSON.stringify({ position: 2 }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.option.position, 2);
    assert.equal(result.option.id, optionIds[0]);
  });
}
