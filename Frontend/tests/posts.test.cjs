const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (!path.extname(file)) file += '.ts';
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (mocks[name]) return mocks[name];
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    }, mod, mod.exports);
    cache.set(file, mod.exports); return mod.exports;
  }
  return name => load(path.join(root, 'app/components/posts', name));
}
const { newBlock, validPost, optionPercent } = loader()('model.ts');
const metadata = { id: 'post-1', user_id: 'author-1', title: 'Post', status: 'private', created_at: '2026-09-19T12:00:00Z', blocks: [] };
function api(mock) { return loader({ '~/API': { fetchFn: mock }, '~/functions': { getToken: () => 'token' } })('api.ts'); }

test('questionnaire validation supports multiple correct answers and rejects removed choices', () => {
  const block = newBlock('questionnaire'); block.text = 'Choose';
  block.options.forEach((option, index) => { option.text = `Answer ${index}`; });
  const post = { title: 'Question', status: 'private', blocks: [block] };
  assert.equal(validPost(post), false);
  block.correctIds = block.options.map(option => option.id);
  assert.equal(validPost(post), true);
  block.correctIds = ['removed'];
  assert.equal(validPost(post), false);
});
test('percentages are calculated from server counts without adding another local vote', () => {
  const options = [{ id: 'a', votes: 1 }, { id: 'b', votes: 2 }];
  assert.equal(optionPercent(options, options[0]), 33.33);
  assert.equal(optionPercent([{ id: 'a', votes: 0 }], { id: 'a', votes: 0 }), 0);
});
test('public questioner data does not invent a correct answer', () => {
  const { fromPost } = api(() => {});
  const mapped = fromPost({ ...metadata, blocks: [{ id: 'q', type: 'questioner', content: { text: 'Q' }, has_responses: true, options: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }] }] });
  assert.deepEqual(mapped.blocks[0].correctIds, []);
  assert.equal(mapped.blocks[0].hasResponses, true);
  assert.equal(mapped.blocks[0].type, 'questionnaire');
});
test('editing title/order keeps answered block IDs and never rewrites their options', async () => {
  const calls = [];
  const { fromPost, savePost } = api(async request => { calls.push(request); return { post: metadata }; });
  const post = fromPost({ ...metadata, blocks: [{ id: 'q', type: 'questioner', content: { text: 'Q' }, has_responses: true, options: [{ id: 'a', text: 'A', is_correct: true }, { id: 'b', text: 'B', is_correct: false }] }] });
  const session = { current: structuredClone(post) };
  await savePost({ ...post, title: 'New title' }, session, () => {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].route, 'api/posts/post-1');
  assert.deepEqual(JSON.parse(calls[0].options.body), { title: 'New title', status: 'private', block_order: ['q'] });
});
test('retry after a failed append reuses the private post and all successfully saved sections', async () => {
  const calls = []; let fail = true; let number = 0;
  const { savePost } = api(async request => {
    calls.push(request);
    if (request.route === 'api/posts') return { post: metadata };
    if (request.options.method === 'POST') {
      if (number === 1 && fail) { fail = false; throw new Error('upload failed'); }
      number++;
      return { block: { id: `saved-${number}`, type: 'text', content: JSON.parse(request.options.body).content } };
    }
    return { post: metadata };
  });
  let draft = { id: 'local', title: 'Post', status: 'public', createdAt: metadata.created_at, blocks: [{ id: 'one', type: 'text', text: 'One' }, { id: 'two', type: 'text', text: 'Two' }] };
  const session = {};
  const checkpoint = next => { draft = next; };
  await assert.rejects(savePost(draft, session, checkpoint), /upload failed/);
  assert.equal(draft.id, 'post-1');
  assert.equal(draft.blocks[0].id, 'saved-1');
  assert.equal(calls.some(call => call.options.method === 'PATCH'), false);
  await savePost(draft, session, checkpoint);
  assert.equal(calls.filter(call => call.route === 'api/posts').length, 1);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body).block_order, ['saved-1', 'saved-2']);
  assert.equal(JSON.parse(calls.at(-1).options.body).status, 'public');
});
test('option image uploads use the multipart block contract and browser boundary', async () => {
  let upload;
  const { savePost } = api(async request => {
    if (request.route === 'api/posts') return { post: metadata };
    if (request.options.method === 'POST') {
      upload = request;
      return { block: { id: 'poll', type: 'poll', content: { text: 'Question' }, options: [{ id: 'a', text: 'A', image_url: 'https://images.example/a.webp' }, { id: 'b', text: 'B' }] } };
    }
    return { post: metadata };
  });
  await savePost({ title: 'Post', status: 'private', blocks: [{ id: 'local', type: 'poll', text: 'Question', options: [{ id: 'a', text: 'A', image: 'data:image/png;base64,YQ==', votes: 0 }, { id: 'b', text: 'B', votes: 0 }] }] }, {}, () => {});
  assert.ok(upload.options.body instanceof FormData);
  assert.ok(upload.options.body.get('option_0') instanceof File);
  assert.equal(upload.options.headers['Content-Type'], undefined);
  assert.deepEqual(JSON.parse(upload.options.body.get('block')).options, [{ position: 0, text: 'A' }, { position: 1, text: 'B' }]);
});

test('post reactions normalize server counts and handle add, switch, remove without negative counts', () => {
  const { fromPost } = api(() => {});
  const { withPostReaction } = loader()('model.ts');
  let post = fromPost({ ...metadata, like_count: 12, dislike_count: 2, user_reaction: 0 });
  assert.equal(post.likeCount, 12);
  post = withPostReaction(post, 1); assert.deepEqual(post, { likeCount: 13, dislikeCount: 2, userReaction: 1 });
  post = withPostReaction(post, -1); assert.deepEqual(post, { likeCount: 12, dislikeCount: 3, userReaction: -1 });
  post = withPostReaction(post, 0); assert.deepEqual(post, { likeCount: 12, dislikeCount: 2, userReaction: 0 });
  assert.equal(withPostReaction({ userReaction: 1 }, 0).likeCount, 0);
});

test('post reactions send bearer auth with no body and reject invalid responses', async () => {
  const calls = [];
  const { reactToPost } = api(async request => { calls.push(request); return { success: true, status: -1 }; });
  assert.equal(await reactToPost('post-1', 'dislike'), -1);
  assert.equal(calls[0].route, 'api/posts/post-1/dislike');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(new Headers(calls[0].options.headers).get('Authorization'), 'Bearer token');
  assert.equal(calls[0].options.body, undefined);
  await assert.rejects(api(async () => ({ success: false, status: 1 })).reactToPost('post-1', 'like'));
});

test('reaction cache sync updates every loaded page and sort for this viewer only', () => {
  const { QueryClient } = require('@tanstack/react-query');
  const client = new QueryClient();
  const post = { id: 'post', likeCount: 1, dislikeCount: 0, userReaction: 0 };
  const keys = [['posts','recommended','me'], ['posts','channel','channel','me',false], ['posts','channel','channel','me',true]];
  client.setQueryData(keys[0], { posts: [post] });
  for (const key of keys.slice(1)) client.setQueryData(key, { pages: [{ posts: [] }, { posts: [post] }], pageParams: [1,2] });
  client.setQueryData(['posts','recommended','other'], { posts: [post] });
  loader()('reactionCache.ts').updatePostReaction(client, 'post', 'me', { likeCount: 2, dislikeCount: 0, userReaction: 1 });
  assert.equal(client.getQueryData(keys[0]).posts[0].userReaction, 1);
  for (const key of keys.slice(1)) assert.equal(client.getQueryData(key).pages[1].posts[0].likeCount, 2);
  assert.equal(client.getQueryData(['posts','recommended','other']).posts[0].userReaction, 0);
  client.clear();
});
