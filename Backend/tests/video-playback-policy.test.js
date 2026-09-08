import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const id = '12345678-1234-4234-8234-123456789abc';
let video, snapshot, calls, failure;
const client = {
  async query(sql, values) {
    calls.push([sql.trim(), values]);
    if (sql === 'BEGIN') snapshot = structuredClone(video);
    else if (sql === 'ROLLBACK') video = snapshot;
    else if (sql === 'COMMIT') {
      if (failure === 'commit') throw new Error('commit failed');
      snapshot = structuredClone(video);
    } else if (sql.includes('SELECT')) return { rows: video ? [structuredClone(video)] : [] };
    else if (sql.includes('SET playback_policy')) {
      if (failure === 'update') throw new Error('update failed');
      Object.assign(video, { playback_policy: values[1], mux_playback_id: values[2], mux_playback_id_pending_deletion: values[3] });
    } else if (sql.includes('SET mux_playback_id_pending_deletion')) video.mux_playback_id_pending_deletion = null;
    return { rows: [] };
  },
  release() { calls.push(['release']); },
};
mock.module(new URL('../src/database/index.js', import.meta.url).href, {
  namedExports: { writePool: { async connect() { calls.push(['connect']); return client; } } },
});
mock.module('@mux/mux-node', {
  defaultExport: class {
    video = { assets: {
      async createPlaybackId(asset, { policy }) {
        calls.push(['create', asset, policy]);
        if (failure === 'create') throw new Error('Mux unavailable');
        return { id: 'new-id', policy };
      },
      async deletePlaybackId(asset, playback) {
        calls.push(['delete', asset, playback]);
        if (failure === 'delete') throw new Error('Mux unavailable');
        if (failure === '404') throw Object.assign(new Error('Missing'), { status: 404 });
      },
    } };
  },
});
const { updateVideoPlaybackPolicyInternal: update } = await import('../src/modules/videos/video-moderation/handlers/updateVideoPlaybackPolicy.js');
function reset(policy = 'public') {
  video = { id, mux_asset_id: 'asset', mux_playback_id: 'old-id', playback_policy: policy, mux_playback_id_pending_deletion: null };
  calls = [];
  failure = null;
}
const input = policy => ({ params: { videoId: id }, body: { playback_policy: policy } });

for (const [from, to] of [['public', 'signed'], ['signed', 'public']]) {
  test(`${from} to ${to} saves the replacement before deleting the previous ID`, async () => {
    reset(from);
    const result = await update(input(to));
    assert.equal(result.playback_policy, to);
    assert.equal(result.changed, true);
    assert.equal(video.mux_playback_id, 'new-id');
    assert.equal(video.mux_playback_id_pending_deletion, null);
    assert.deepEqual(calls.filter(c => c[0] === 'delete'), [['delete', 'asset', 'old-id']]);
    assert.ok(calls.findIndex(c => c[0] === 'COMMIT') < calls.findIndex(c => c[0] === 'delete'));
  });
  test(`${from} unchanged makes no Mux calls or database updates`, async () => {
    reset(from);
    assert.equal((await update(input(from))).changed, false);
    assert.equal(calls.some(c => /^(create|delete|UPDATE)/.test(c[0])), false);
  });
}
test('invalid policies and IDs fail before connecting', async () => {
  reset();
  for (const policy of [null, undefined, 'drm', 'PUBLIC', {}, []]) {
    await assert.rejects(update(input(policy)), { status: 400 });
  }
  await assert.rejects(update({ params: { videoId: 'bad' }, body: { playback_policy: 'signed' } }), { status: 400 });
  assert.deepEqual(calls, []);
});
test('missing videos and assets cannot create playback IDs', async () => {
  reset(); video = null;
  await assert.rejects(update(input('signed')), { status: 404 });
  reset(); video.mux_asset_id = null;
  await assert.rejects(update(input('signed')), { status: 409 });
  assert.equal(calls.some(c => c[0] === 'create'), false);
});
test('creation failure preserves original playback', async () => {
  reset(); failure = 'create';
  await assert.rejects(update(input('signed')), { status: 502 });
  assert.equal(video.mux_playback_id, 'old-id');
  assert.equal(calls.some(c => c[0] === 'delete'), false);
});
test('database update failure removes the unused replacement only', async () => {
  reset(); failure = 'update';
  await assert.rejects(update(input('signed')), /update failed/);
  assert.equal(video.mux_playback_id, 'old-id');
  assert.deepEqual(calls.filter(c => c[0] === 'delete'), [['delete', 'asset', 'new-id']]);
});
test('deletion failure persists cleanup and identical retry finishes without another creation', async () => {
  reset(); failure = 'delete';
  await assert.rejects(update(input('signed')), error => error.body.code === 'PLAYBACK_CLEANUP_PENDING');
  assert.equal(video.playback_policy, 'signed');
  assert.equal(video.mux_playback_id_pending_deletion, 'old-id');
  failure = null;
  assert.equal((await update(input('signed'))).changed, false);
  assert.equal(video.mux_playback_id_pending_deletion, null);
  assert.equal(calls.filter(c => c[0] === 'create').length, 1);
});
test('already deleted old IDs complete cleanup successfully', async () => {
  reset(); failure = '404';
  await update(input('signed'));
  assert.equal(video.mux_playback_id_pending_deletion, null);
});
test('ambiguous commit never deletes either playback ID', async () => {
  reset(); failure = 'commit';
  await assert.rejects(update(input('signed')), /commit failed/);
  assert.equal(calls.some(c => c[0] === 'delete'), false);
});
