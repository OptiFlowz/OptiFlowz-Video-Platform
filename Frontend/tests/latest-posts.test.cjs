const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { JSDOM } = require('jsdom');

function loadPosts(name, mocks = {}) {
  const cache = new Map();
  function load(file) {
    if (!path.extname(file)) file += fs.existsSync(`${file}.ts`) ? '.ts' : '.tsx';
    if (cache.has(file)) return cache.get(file).exports;
    const mod = { exports: {} };
    cache.set(file, mod);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', code)(name => {
      if (Object.hasOwn(mocks, name)) return mocks[name];
      if (name.endsWith('.css')) return {};
      if (name.startsWith('.')) return load(path.resolve(path.dirname(file), name));
      return require(name);
    }, mod, mod.exports);
    return mod.exports;
  }
  return load(path.resolve(__dirname, '../app/components/posts', name));
}
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('recommended post authors preserve order, skip missing/invalid IDs and deduplicate before limiting to five', () => {
  const { recommendedPostAuthors } = loadPosts('recommendations.ts');
  const videos = [{}, { uploader_id: 'invalid' }, ...[1, 1, 2, 3, 4, 5, 6].map(n => ({ uploader_id: uuid(n), uploader_name: `Channel ${n}` }))];
  assert.deepEqual(recommendedPostAuthors(videos).map(author => author.uploader_id), [1, 2, 3, 4, 5].map(uuid));
});

test('recommended posts use one authenticated POST, request ten newest posts and retain option order', async () => {
  const requests = [];
  const api = loadPosts('api.ts', {
    '~/functions': { getToken: () => 'viewer-token' },
    '~/API': { fetchFn: async request => {
      requests.push(request);
      return { posts: [{ id: uuid(10), user_id: uuid(1), title: 'Poll', author_full_name: 'API channel', author_image_url: '/channel.webp', status: 'public', created_at: '2026-09-19', blocks: [{ id: uuid(11), type: 'poll', content: { text: 'Question' }, options: [{ id: 'b', text: 'B', position: 1 }, { id: 'a', text: 'A', position: 0 }] }] }], pagination: { total: 1 } };
    } },
  });
  const signal = new AbortController().signal;
  const result = await api.getRecommendedPosts([uuid(1)], signal);
  assert.deepEqual(result.posts[0].author, { full_name: 'API channel', image_url: '/channel.webp' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].route, 'api/posts/recommended?page=1&limit=10&sortBy=created_at&sortOrder=desc');
  assert.equal(requests[0].options.method, 'POST');
  assert.equal(requests[0].options.headers.Authorization, 'Bearer viewer-token');
  assert.equal(requests[0].options.signal, signal);
  assert.deepEqual(JSON.parse(requests[0].options.body), { user_ids: [uuid(1)] });
  assert.deepEqual(result.posts[0].blocks[0].options.map(option => option.id), ['a', 'b']);
});

test('homepage previews open dialogs without channel links, vote controls or results', () => {
  const post = { id: uuid(10), userId: uuid(1), title: 'Internal title', author: { full_name: 'API channel', image_url: '/channel.webp' }, createdAt: '2026-09-19', blocks: [{ id: 'block', type: 'questionnaire', text: 'Which answer?', correctIds: ['a'], selectedOptionIds: ['a'], options: [{ id: 'a', text: 'Option A', votes: 10 }, { id: 'b', text: 'Option B', votes: 0 }] }] };
  let posts = [post, { ...post, id: uuid(11) }, { ...post, id: uuid(12) }, { ...post, id: uuid(13) }];
  const Preview = loadPosts('LatestPosts.tsx', {
    '@tanstack/react-query': { useQuery: () => ({ data: { posts } }) },
    'react-router': { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
    '~/constants': { ArrowSVG: null },
    '../../../assets/DefaultProfile.webp': '/default-profile.webp',
    '~/functions': { getToken: () => 'token', formatDate: value => value },
    '~/i18n': { useI18n: () => ({ t: key => key }) },
    '~/components/shared/videoMedia': { getVideoThumbnail: video => video.thumbnail_url },
    './api': { getRecommendedPosts: () => {} },
    './PostCard': () => null,
    './PostDialog': () => null,
  }).default;
  const html = renderToStaticMarkup(React.createElement(Preview, { videos: [{ uploader_id: uuid(1), uploader_name: 'The channel' }] }));
  const dom = new JSDOM(html);
  const triggers = dom.window.document.querySelectorAll('.latestPostTrigger[aria-haspopup="dialog"]');
  assert.equal(triggers.length, 3);
  assert.ok(dom.window.document.querySelector('.latestPostsViewAll[aria-haspopup="dialog"]'));
  assert.equal(dom.window.document.querySelectorAll('a, input, .postOption').length, 0);
  assert.ok(html.includes('API channel'));
  assert.ok(!html.includes('The channel'));
  assert.ok(!html.includes('Internal title'));
  assert.equal(dom.window.document.querySelector('.latestPostAvatar').getAttribute('src'), '/channel.webp');
  assert.ok(dom.window.document.querySelector('.latestPostAuthor .latestPostType'));
  assert.equal(dom.window.document.querySelector('.latestPostBody .latestPostType'), null);
  assert.ok(html.includes('Option A'));
  assert.ok(!html.includes('100%'));
  assert.ok(!html.includes('Correct answer'));
  dom.window.close();
  posts = [];
  assert.equal(renderToStaticMarkup(React.createElement(Preview, { videos: [] })), '');
});

test('popup voting is immediate, survives reopening and supports single and multiple questionnaire answers without navigation', async () => {
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const { QueryClient, QueryClientProvider } = require('@tanstack/react-query');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test/' });
  const names = ['window', 'document', 'HTMLElement', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    requestAnimationFrame: callback => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout, IS_REACT_ACT_ENVIRONMENT: true });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  Object.defineProperty(dom.window.HTMLElement.prototype, 'offsetTop', { get() { return this.dataset.postId ? (Number(this.dataset.postId.slice(-12)) - 10) * 240 : 0; } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const options = [{ id: 'a', text: 'Option A', votes: 0 }, { id: 'b', text: 'Option B', votes: 0 }];
  const posts = ['poll', 'questionnaire', 'questionnaire'].map((type, i) => ({ id: uuid(10 + i), userId: uuid(1), title: 'Post', author: { full_name: 'Channel' }, createdAt: '2026-09-19', blocks: [{ id: `block-${i}`, type, text: 'Question', options, correctIds: i === 1 ? ['a', 'b'] : i === 2 ? ['a'] : [], selectedOptionIds: [] }] }));
  posts.push(...Array.from({ length: 8 }, (_, i) => ({ id: uuid(13 + i), userId: uuid(1), title: 'Text post', author: { full_name: 'Channel' }, createdAt: '2026-09-19', blocks: [{ id: `text-${i}`, type: 'text', text: `Extra post ${i}` }] })));
  const key = ['posts', 'recommended', 'token', [uuid(1)], 10];
  client.setQueryData(key, { posts });
  const channelKey = ['posts', 'channel', uuid(1), 'token', false];
  client.setQueryData(channelKey, { pages: [{ posts }], pageParams: [1] });
  const requests = [];
  let respond;
  const Preview = loadPosts('LatestPosts.tsx', {
    'react-router': { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
    '~/constants': { ArrowSVG: null, CheckSVG: null, CloseSVG: null },
    '../../../assets/DefaultProfile.webp': '/default-profile.webp',
    '../../../assets/DefaultThumbnail.webp': '/default-thumbnail.webp',
    '~/functions': { getToken: () => 'token', formatDate: value => value },
    '~/i18n': { useI18n: () => ({ t: key => key }) },
    '~/components/shared/videoMedia': { getVideoThumbnail: () => '' },
    '~/authorization/authorization': { useAuthorization: () => ({ user: {}, can: () => true, loading: false }) },
    '~/auth/session': { redirectToLogin: () => assert.fail('Already signed in') },
    '~/API': { fetchFn: request => { requests.push(request); return new Promise(resolve => { respond = resolve; }); } },
  }).default;
  const root = createRoot(document.getElementById('root'));
  const click = async element => { assert.ok(element); await act(async () => { element.click(); }); };
  const close = async () => {
    await click(document.querySelector('dialog button[aria-label="close"]'));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 220)); });
    assert.equal(document.querySelector('dialog'), null);
  };
  let activeCard;
  const open = async index => {
    const button = document.querySelectorAll('.latestPostTrigger')[index]; button.focus(); await click(button);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    activeCard = document.querySelector(`[data-post-id="${posts[index].id}"]`);
    assert.equal(document.querySelectorAll('.latestPostsDialogFeed .postCard').length, 10);
    assert.equal(document.querySelector('.postDialogHeading h2').textContent, 'latestPosts');
    assert.equal(document.querySelector('.latestPostsDialogFeed').scrollTop, index * 240);
  };
  const reply = async ids => {
    await act(async () => {
      respond({ selected_option_id: ids[0], selected_option_ids: ids, options: options.map(option => ({ ...option, vote_count: ids.includes(option.id) ? 1 : 0 })), correct_option_ids: ids });
      await new Promise(resolve => setTimeout(resolve, 0));
    });
  };
  try {
    await act(async () => { root.render(React.createElement(QueryClientProvider, { client }, React.createElement(Preview, { videos: [{ uploader_id: uuid(1) }] }))); });
    await open(0);
    assert.equal(requests.length, 0, 'Opening reuses the already loaded post');
    await click(activeCard.querySelector('.postOption'));
    assert.equal(activeCard.querySelector('.postOption').getAttribute('aria-pressed'), 'true');
    assert.equal(requests.length, 1);
    assert.ok(requests[0].route.endsWith('/vote'));
    await reply(['a']);
    assert.deepEqual(client.getQueryData(channelKey).pages[0].posts[0].blocks[0].selectedOptionIds, ['a']);
    await close();
    assert.equal(document.activeElement, document.querySelector('.latestPostTrigger'));
    await open(0);
    assert.equal(activeCard.querySelector('.postOption').getAttribute('aria-pressed'), 'true', 'Vote remains after reopening');
    await close();
    await open(1);
    await click(activeCard.querySelectorAll('.postOption')[0]);
    await click(activeCard.querySelectorAll('.postOption')[1]);
    assert.equal(requests.length, 1, 'Multiple answers wait for submit');
    await click(activeCard.querySelector('.postPollSubmit button'));
    assert.deepEqual(JSON.parse(requests[1].options.body), { option_ids: ['a', 'b'] });
    assert.equal(activeCard.querySelectorAll('.postOption.isCorrect').length, 2);
    await reply(['a', 'b']);
    await close();
    await open(2);
    await click(activeCard.querySelector('.postOption'));
    assert.equal(requests.length, 3, 'Single answer submits on click');
    assert.ok(activeCard.querySelector('.postOption.isCorrect'), 'Correctness is shown before the response');
    await reply(['a']);
    await close();
    const viewAll = document.querySelector('.latestPostsViewAll');
    viewAll.focus();
    await click(viewAll);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.equal(document.querySelectorAll('.latestPostsDialogFeed .postCard').length, 10);
    assert.equal(document.querySelector('.latestPostsDialogFeed').scrollTop, 0, 'View all starts at the latest post');
    assert.equal(document.querySelector('.postAuthorLink').getAttribute('href'), `/channel/${uuid(1)}`);
    assert.equal(requests.length, 3, 'View all reuses loaded posts without extra requests');
    await close();
    assert.equal(document.activeElement, viewAll);
    assert.equal(dom.window.location.href, 'https://example.test/');
    assert.equal(document.body.style.overflow, '');
  } finally {
    await act(async () => root.unmount());
    client.clear(); dom.window.close();
    for (const name of names) { const descriptor = previous.get(name); if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
  }
});

test('all post feeds retain embedded video cards and explicit unavailable videos', async () => {
  const video = { id: uuid(30), title: 'Embedded video', thumbnail_url: '/thumbnail.webp', mux_thumbnail_url: 'https://image.mux.com/video/thumbnail.webp?token=signed', preview_url: '/preview.webp', media_expires_at: 1234, uploader_id: uuid(1), uploader_name: 'Channel', duration_seconds: 30, view_count: 8, created_at: '2026-09-19', people: [], progress_seconds: null, percentage_watched: null };
  const post = { id: uuid(10), user_id: uuid(1), title: 'Mention', created_at: '2026-09-19', status: 'public', blocks: [
    { id: 'available', type: 'video', content: { video_id: video.id, text: 'Watch this' }, video_card: video },
    { id: 'unavailable', type: 'video', content: { video_id: uuid(31), text: 'Unavailable caption' }, video_card: null },
  ] };
  const requests = [];
  const api = loadPosts('api.ts', {
    '~/functions': { getToken: () => 'token' },
    '~/API': { fetchFn: async request => { requests.push(request.route); return { post, posts: [post], pagination: {} }; } },
  });
  const results = [(await api.getRecommendedPosts([uuid(1)])).posts[0], (await api.getChannelPosts(uuid(1), 1, false)).posts[0], await api.getPost(post.id)];
  for (const result of results) {
    assert.deepEqual(result.blocks[0].video, video);
    assert.equal(result.blocks[1].video, null);
    assert.equal(result.blocks[1].text, 'Unavailable caption');
  }
  assert.ok(requests.every(route => route.startsWith('api/posts/')));
});

test('video mentions render embedded cards without video detail requests and respect null cards', () => {
  const video = { id: uuid(30), title: 'Embedded video', thumbnail_url: '/embedded.webp', uploader_name: 'Channel', view_count: 8, created_at: '2026-09-19' };
  const mocks = {
    '@tanstack/react-query': { useQuery: () => assert.fail('Video previews must not fetch'), useQueryClient: () => ({}) },
    '~/API': { fetchFn: () => assert.fail('Video previews must not record views') },
    '~/constants': { CheckSVG: null, CloseSVG: null },
    '~/functions': { getToken: () => 'token', formatDate: value => value, formatViews: value => `${value} views` },
    '~/i18n': { useI18n: () => ({ t: key => key }) },
    '~/components/shared/videoMedia': { getVideoThumbnail: video => video.thumbnail_url },
    '~/authorization/authorization': {}, '~/auth/session': {},
    '../../../assets/DefaultProfile.webp': '/profile.webp', '../../../assets/DefaultThumbnail.webp': '/fallback.webp',
    'react-router': { Link: ({ to, children, ...props }) => React.createElement('a', { href: to, ...props }, children) },
  };
  const PostCard = loadPosts('PostCard.tsx', mocks).default;
  const post = { id: uuid(10), title: 'Mention', createdAt: '2026-09-19', blocks: [{ id: 'block', type: 'video', videoId: video.id, text: 'Caption', video }] };
  const render = () => renderToStaticMarkup(React.createElement(PostCard, { post, author: {}, videos: [{ ...video, title: 'Stale list title' }] }));
  let html = render();
  assert.ok(html.includes('Embedded video'));
  assert.ok(html.includes('/embedded.webp'));
  assert.ok(html.includes(`/video/${video.id}`));
  assert.ok(!html.includes('Stale list title'));
  post.blocks[0].video = null;
  html = render();
  assert.ok(html.includes('postVideoUnavailable'));
  assert.ok(html.includes('Caption'));
  assert.ok(!html.includes(`/video/${video.id}`));
  assert.ok(!html.includes('Stale list title'));
});
