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

test('time saves fractional seconds or SQL NULL, including zero', async () => {
  for (const time of [0, 0.125, 12.5, 2147483648, null]) {
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
    ...[-1, -0.5, '12', false, {}, [], NaN, Infinity, -Infinity].map(time => ({ time })),
    { thumbnail_url: null }, { thumbnail_url: 'https://example.com/image.jpg' },
    { thumbnail_settings: null }, { time: 5, thumbnail_settings: {} },
  ]) {
    calls = [];
    await assert.rejects(patch(input(body)), { status: 400 });
    assert.deepEqual(calls, []);
  }
});

test('publication dates accept timezone-aware timestamps and null, independently of other fields', async () => {
  for (const published_at of ['2030-09-20T18:00:00+02:00', '2030-09-20T16:00:00Z', null]) {
    calls = [];
    await patch(input({ published_at }));
    const [sql, params] = calls.find(([sql]) => sql.includes('UPDATE public.videos'));
    assert.match(sql, /published_at = \$2::timestamptz/);
    assert.deepEqual(params, ['video-id', published_at]);
    assert.ok(!sql.includes('visibility ='));
  }
});

test('visibility-only updates preserve existing public schedules and clear private publication dates', async () => {
  calls = [];
  await patch(input({ visibility: 'public' }));
  assert.match(calls.find(([sql]) => sql.includes('UPDATE public.videos'))[0], /published_at = COALESCE\(published_at, NOW\(\)\)/);
  calls = [];
  await patch(input({ visibility: 'private' }));
  assert.match(calls.find(([sql]) => sql.includes('UPDATE public.videos'))[0], /published_at = NULL/);
});

test('an explicit publication date takes precedence over visibility defaults', async () => {
  for (const visibility of ['public', 'private']) {
    for (const published_at of ['2030-09-20T16:00:00Z', null]) {
      calls = [];
      await patch(input({ visibility, published_at }));
      const [sql, params] = calls.find(([sql]) => sql.includes('UPDATE public.videos'));
      assert.match(sql, /published_at = \$3::timestamptz/);
      assert.deepEqual(params, ['video-id', visibility, published_at]);
      assert.equal((sql.match(/published_at =/g) || []).length, 1);
    }
  }
});

test('invalid publication dates fail before database access', async () => {
  for (const published_at of ['', 'now', '2030-02-30T12:00:00Z', '2030-09-20T12:00:00', 0, false, {}, [], 'Infinity']) {
    calls = [];
    await assert.rejects(patch(input({ published_at })), { status: 400 });
    assert.deepEqual(calls, []);
  }
});
