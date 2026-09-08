import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let calls;
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { async connect() {
    calls.push(['connect']);
    return {
      async query(sql, params) {
        calls.push([sql, params]);
        return { rowCount: 1, rows: [{ id: 'video-id' }] };
      },
      release() {},
    };
  } } },
});
const { patchVideoDetailsInternal: patch } = await import('../src/modules/videos/video-moderation/handlers/patchVideoDetails.js');
const input = body => ({ params: { videoId: 'video-id' }, body });

test('time saves an integer or SQL NULL, including zero', async () => {
  for (const time of [0, 12, 2147483647, null]) {
    calls = [];
    assert.equal((await patch(input({ time }))).success, true);
    const [sql, params] = calls.find(([sql]) => sql.includes('UPDATE public.videos'));
    assert.match(sql, /mux_thumbnail_time = \$2/);
    assert.deepEqual(params, ['video-id', time]);
    assert.ok(!sql.includes('thumbnail_settings'));
    assert.ok(!sql.includes('thumbnail_url'));
  }
});

test('omitting time leaves the saved timestamp unchanged', async () => {
  calls = [];
  await patch(input({ title: 'Updated title' }));
  const [sql] = calls.find(([sql]) => sql.includes('UPDATE public.videos'));
  assert.ok(!sql.includes('mux_thumbnail_time'));
});

test('invalid time values and removed fields fail before database access', async () => {
  for (const body of [
    ...[-1, 1.5, '12', false, {}, [], 2147483648, Infinity].map(time => ({ time })),
    { thumbnail_url: null }, { thumbnail_url: 'https://example.com/image.jpg' },
    { thumbnail_settings: null }, { time: 5, thumbnail_settings: {} },
  ]) {
    calls = [];
    await assert.rejects(patch(input(body)), { status: 400 });
    assert.deepEqual(calls, []);
  }
});
