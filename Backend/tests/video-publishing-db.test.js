import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { mock, test } from 'node:test';
import pg from 'pg';

const uuid = n => `12345678-1234-4234-8234-${String(n).padStart(12, '0')}`;
const owner = uuid(100), viewer = uuid(101), playlist = uuid(200);
const published = uuid(1), scheduled = uuid(2), draft = uuid(3), privateId = uuid(4), processing = uuid(5);

test('publication rules against PostgreSQL temporary fixtures', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  // Every table is connection-local. No application tables are read or changed.
  await client.query('SET search_path = pg_temp, pg_catalog');
  await client.query(`
    CREATE TEMP TABLE videos (
      id uuid PRIMARY KEY, uploaded_by uuid, title text, description text,
      thumbnail_url text, duration_seconds integer DEFAULT 60,
      view_count integer DEFAULT 0, like_count integer DEFAULT 0, dislike_count integer DEFAULT 0,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
      published_at timestamptz, visibility text DEFAULT 'public', mux_status text DEFAULT 'ready',
      mux_playback_id text DEFAULT 'fixture-playback', playback_policy text DEFAULT 'public',
      mux_thumbnail_time double precision, tags text[] DEFAULT '{tutorial}', chapters jsonb
    );
    CREATE TEMP TABLE users (id uuid PRIMARY KEY, full_name text, image_url text);
    CREATE TEMP TABLE people (id uuid PRIMARY KEY, name text, image_url text, description text);
    CREATE TEMP TABLE video_chairs (video_id uuid, person_id uuid, type integer);
    CREATE TEMP TABLE categories (id uuid PRIMARY KEY, name text, color text);
    CREATE TEMP TABLE video_categories (video_id uuid, category_id uuid);
    CREATE TEMP TABLE watch_progress (video_id uuid, user_id uuid, progress_seconds numeric,
      percentage_watched numeric, total_watch_seconds numeric, last_watched_at timestamptz);
    CREATE TEMP TABLE video_reactions (video_id uuid, user_id uuid, reaction integer, created_at timestamptz);
    CREATE TEMP TABLE video_views (id uuid, video_id uuid, created_at timestamptz);
    CREATE TEMP TABLE video_comments (id uuid, video_id uuid, user_id uuid, parent_id uuid,
      is_deleted boolean, content text, like_count integer, dislike_count integer,
      reply_count integer, created_at timestamptz, updated_at timestamptz);
    CREATE TEMP TABLE comment_reactions (comment_id uuid, user_id uuid, reaction integer);
    CREATE TEMP TABLE playlists (id uuid PRIMARY KEY, created_by uuid, title text,
      description text, thumbnail_url text, view_count integer DEFAULT 0, save_count integer DEFAULT 0,
      created_at timestamptz DEFAULT now(), tags text[], featured boolean DEFAULT true, status text DEFAULT 'public');
    CREATE TEMP TABLE playlist_items (playlist_id uuid, video_id uuid, position integer);
    CREATE TEMP TABLE playlist_saves (playlist_id uuid, user_id uuid, created_at timestamptz DEFAULT now());
  `);
  await client.query('INSERT INTO users (id, full_name) VALUES ($1, $2)', [owner, 'Uploader']);
  for (const [id, visibility, muxStatus, date] of [
    [published, 'public', 'ready', '2000-01-01T00:00:00Z'],
    [scheduled, 'public', 'ready', '2999-01-01T00:00:00Z'],
    [draft, 'public', 'ready', null],
    [privateId, 'private', 'ready', '2000-01-01T00:00:00Z'],
    [processing, 'public', 'processing', '2000-01-01T00:00:00Z'],
  ]) {
    await client.query('INSERT INTO videos(id, uploaded_by, title, visibility, mux_status, published_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, owner, id, visibility, muxStatus, date]);
    await client.query('INSERT INTO playlist_items VALUES ($1,$2,$3)', [playlist, id, id === scheduled ? 0 : 1]);
    await client.query('INSERT INTO watch_progress VALUES ($1,$2,10,10,10,now())', [id, viewer]);
    await client.query('INSERT INTO video_reactions VALUES ($1,$2,1,now())', [id, viewer]);
  }
  await client.query('INSERT INTO playlists(id,created_by,title) VALUES ($1,$2,$3)', [playlist, owner, 'Playlist']);
  await client.query('INSERT INTO playlist_saves(playlist_id,user_id) VALUES ($1,$2)', [playlist, viewer]);
  await client.query('INSERT INTO people(id,name) VALUES ($1,$2)', [uuid(300), 'Speaker']);
  await client.query('INSERT INTO video_chairs SELECT id,$1,0 FROM videos', [uuid(300)]);

  const database = {
    query: (sql, params) => client.query(sql.replaceAll('public.', 'pg_temp.'), params),
    async connect() { return { query: this.query, release() {} }; },
  };
  mock.module(new URL('../src/database/index.js', import.meta.url).href, { namedExports: { writePool: database, readPool: database } });
  mock.module(new URL('../src/modules/video-indexing/indexing.service.js', import.meta.url).href, { namedExports: { scheduleOverview: async () => {} } });
  const load = path => import(`../src/modules/${path}.js`);
  const { getVideoByIdInternal: details } = await load('videos/video/handlers/getVideoById');
  const { getVideoPlaybackInternal: playback } = await load('videos/video/handlers/getVideoPlayback');
  const { searchVideosInternal: search } = await load('videos/video/handlers/searchVideos');
  const { getTrendingInternal: trending } = await load('videos/video/handlers/getTrending');
  const { getChannelVideosInternal: channel } = await load('channels/handlers/getChannelVideos');
  const { getMyVideosInternal: mine } = await load('videos/video-moderation/handlers/getMyVideos');
  const { patchVideoDetailsInternal: patch } = await load('videos/video-moderation/handlers/patchVideoDetails');
  const { withVideoCardMedia: media } = await load('videos/helpers/videoCardMedia');
  const { withPlaylistCardMedia: playlistMedia } = await load('playlists/helpers/playlistCardMedia');
  const { getCommentsInternal: comments } = await load('videos/video/handlers/getComments');
  const { requireVisibleVideo } = await import('../src/common/videoAccess.js');

  await t.test('details, playback, media, notes and comments deny scheduled/draft access but allow uploader previews', async () => {
    for (const id of [scheduled, draft, privateId]) {
      assert.equal(await details(id), null);
      assert.equal(await details(id, viewer), null);
      assert.equal((await details(id, owner)).id, id);
      await assert.rejects(playback(id), { status: 404 });
      await assert.rejects(playback(id, viewer), { status: 404 });
      assert.equal((await playback(id, owner)).video_id, id);
      assert.equal((await media([{ id }], viewer))[0].mux_thumbnail_url, null);
      assert.ok((await media([{ id }], owner))[0].mux_thumbnail_url);
      await assert.rejects(requireVisibleVideo(database, id, viewer), { status: 404 });
      await assert.rejects(comments({ params: { id }, query: {} }, viewer), { status: 404 });
      await requireVisibleVideo(database, id, owner);
      assert.equal((await comments({ params: { id }, query: {} }, owner)).total, 0);
    }
    assert.equal((await details(published)).id, published);
    assert.equal((await playback(published)).video_id, published);
    assert.equal(await details(processing, owner), null);
    await assert.rejects(playback(processing, owner), { status: 409 });
  });

  await t.test('public search, trending, channel lists, history and counts exclude unavailable videos', async () => {
    const result = await search({});
    assert.equal(result.total, 1);
    assert.deepEqual(result.videos.map(v => v.id), [published]);
    assert.deepEqual((await trending({ query: {} })).videos.map(v => v.id), [published]);
    const channelResult = await channel({ id: owner }, owner);
    assert.equal(channelResult.pagination.total, 1);
    assert.deepEqual(channelResult.videos.map(v => v.id), [published]);
    for (const name of ['getLikedVideos', 'getContinueWatching', 'getUserHistory']) {
      const module = await load(`videos/video/handlers/${name}`);
      assert.deepEqual((await module[`${name}Internal`]({ query: {} }, viewer)).videos.map(v => v.id), [published]);
    }
    const myVideos = await mine({ query: {} }, owner);
    assert.equal(myVideos.total, 5);
    assert.ok(myVideos.videos.find(v => v.id === scheduled).published_at);
    assert.equal(myVideos.videos.find(v => v.id === draft).published_at, null);
  });

  await t.test('playlist videos, counts, and fallback artwork honor publication', async () => {
    const { getPlaylistWithVideosInternal: withVideos } = await load('playlists/playlists/handlers/getPlaylistWithVideos');
    const { getPlaylistVideosInternal: videos } = await load('playlists/playlists/handlers/getPlaylistVideos');
    const { getPlaylistByIdInternal: byId } = await load('playlists/playlists/handlers/getPlaylistById');
    const { searchPlaylistsInternal: searchLists } = await load('playlists/playlists/handlers/searchPlaylists');
    const { getFeaturedPlaylistsInternal: featured } = await load('playlists/playlists/handlers/getFeaturedPlaylists');
    const { getSavedPlaylistsInternal: saved } = await load('playlists/playlists/handlers/getSavedPlaylists');
    const result = await withVideos(playlist, viewer);
    assert.equal(result.video_count, 1);
    assert.deepEqual(result.videos.map(v => v.id), [published]);
    const page = await videos({ id: playlist }, viewer);
    assert.equal(page.pagination.total, 1);
    assert.deepEqual(page.videos.map(v => v.id), [published]);
    assert.equal((await byId({ id: playlist })).video_count, 1);
    for (const lists of [await searchLists({}), await featured(), await saved(viewer)]) {
      assert.equal(lists.playlists[0].video_count, 1);
    }
    await client.query('UPDATE videos SET thumbnail_url = $1 WHERE id = $2', ['https://example.test/published.png', published]);
    await client.query('UPDATE videos SET thumbnail_url = $1 WHERE id = $2', ['https://example.test/scheduled.png', scheduled]);
    assert.equal((await playlistMedia([{ id: playlist }], viewer))[0].thumbnail_url, 'https://example.test/published.png');
    assert.equal((await playlistMedia([{ id: playlist }], owner))[0].thumbnail_url, 'https://example.test/scheduled.png');
  });

  await t.test('scheduling, rescheduling, publish-now and cancellation preserve intended timestamps', async () => {
    const update = body => patch({ params: { videoId: scheduled }, body });
    const state = async () => (await client.query('SELECT * FROM videos WHERE id=$1', [scheduled])).rows[0];
    const future = '2999-09-20T18:00:00+02:00';
    await update({ visibility: 'public', published_at: future });
    assert.equal((await state()).published_at.toISOString(), '2999-09-20T16:00:00.000Z');
    await update({ visibility: 'public' });
    await update({ title: 'Scheduled title' });
    assert.equal((await state()).published_at.toISOString(), '2999-09-20T16:00:00.000Z');
    await update({ published_at: null });
    assert.equal((await state()).published_at, null);
    assert.equal(await details(scheduled), null);
    await update({ visibility: 'public' });
    assert.equal((await details(scheduled)).id, scheduled);
    await update({ published_at: future });
    assert.equal(await details(scheduled), null);
    await update({ visibility: 'private' });
    assert.equal((await state()).published_at, null);
    await update({ visibility: 'public', published_at: '2000-01-01T00:00:00Z' });
    assert.equal((await details(scheduled)).id, scheduled);
  });

  await t.test('availability changes as database time passes, without any background update', async () => {
    await client.query("UPDATE videos SET published_at=clock_timestamp()+interval '500 milliseconds' WHERE id=$1", [scheduled]);
    const before = (await client.query('SELECT published_at FROM videos WHERE id=$1', [scheduled])).rows[0].published_at;
    await assert.rejects(playback(scheduled, viewer), { status: 404 });
    await setTimeout(750);
    assert.equal((await playback(scheduled, viewer)).video_id, scheduled);
    const after = (await client.query('SELECT published_at FROM videos WHERE id=$1', [scheduled])).rows[0].published_at;
    assert.equal(after.getTime(), before.getTime());
  });
});
