import assert from 'node:assert/strict';
import { setTimeout } from 'node:timers/promises';
import { createHmac } from 'node:crypto';
import { mock, test } from 'node:test';
import pg from 'pg';

const uuid = n => `12345678-1234-4234-8234-${String(n).padStart(12, '0')}`;
const owner = uuid(100), viewer = uuid(101), playlist = uuid(200);
const published = uuid(1), scheduled = uuid(2), draft = uuid(3), privateId = uuid(4), processing = uuid(5);
const live = uuid(6), liveDraft = uuid(7);

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
      id uuid PRIMARY KEY, kind text NOT NULL DEFAULT 'upload', uploaded_by uuid, title text, description text,
      thumbnail_url text, duration_seconds integer DEFAULT 60,
      view_count integer DEFAULT 0, like_count integer DEFAULT 0, dislike_count integer DEFAULT 0,
      created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now(),
      published_at timestamptz, visibility text DEFAULT 'public', mux_status text DEFAULT 'ready',
      mux_asset_id text, mux_playback_id text DEFAULT 'fixture-playback', playback_policy text DEFAULT 'public',
      mux_thumbnail_time double precision, tags text[] DEFAULT '{tutorial}', chapters jsonb
    );
    CREATE TEMP TABLE video_livestreams (
      video_id uuid PRIMARY KEY, mode text DEFAULT 'standard', status text DEFAULT 'ended',
      scheduled_start_at timestamptz, started_at timestamptz, ended_at timestamptz, stop_at timestamptz,
      max_duration_seconds integer DEFAULT 3600, recording_finalized_at timestamptz DEFAULT now(),
      mux_live_stream_id text, mux_live_playback_id text, policy_sync_pending boolean DEFAULT false,
      mux_stream_pending_deletion text, updated_at timestamptz DEFAULT now()
    );
    CREATE TEMP TABLE users (id uuid PRIMARY KEY, full_name text, image_url text);
    CREATE TEMP TABLE people (id uuid PRIMARY KEY, name text, image_url text, description text);
    CREATE TEMP TABLE video_chairs (video_id uuid, person_id uuid, type integer);
    CREATE TEMP TABLE categories (id uuid PRIMARY KEY, name text, color text);
    CREATE TEMP TABLE video_categories (video_id uuid, category_id uuid);
    CREATE TEMP TABLE watch_progress (video_id uuid, user_id uuid, progress_seconds numeric,
      percentage_watched numeric, total_watch_seconds numeric, last_watched_at timestamptz,
      UNIQUE (user_id, video_id));
    CREATE TEMP TABLE video_reactions (video_id uuid, user_id uuid, reaction integer, created_at timestamptz);
    CREATE TEMP TABLE video_views (id uuid, video_id uuid, created_at timestamptz,
      user_id uuid, last_heartbeat_at timestamptz, last_seq bigint, watch_duration bigint,
      ip_address text, user_agent text, is_playing boolean DEFAULT false);
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
    [live, 'public', 'ready', '2000-01-01T00:00:00Z'],
    [liveDraft, 'private', 'processing', null],
  ]) {
    await client.query('INSERT INTO videos(id, uploaded_by, title, visibility, mux_status, published_at) VALUES ($1,$2,$3,$4,$5,$6)', [id, owner, id, visibility, muxStatus, date]);
    await client.query('INSERT INTO playlist_items VALUES ($1,$2,$3)', [playlist, id, id === scheduled ? 0 : 1]);
    await client.query('INSERT INTO watch_progress VALUES ($1,$2,10,10,10,now())', [id, viewer]);
    await client.query('INSERT INTO video_reactions VALUES ($1,$2,1,now())', [id, viewer]);
  }
  await client.query("UPDATE videos SET kind = 'live', mux_asset_id = 'live-asset' WHERE id = ANY($1::uuid[])", [[live, liveDraft]]);
  await client.query("INSERT INTO video_livestreams(video_id) VALUES ($1),($2)", [live, liveDraft]);
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

  await t.test('live details and actions use visibility, recording state, and resource permissions', async () => {
    const { updateWatchProgressInternal: progress } = await load('videos/video/handlers/updateWatchProgress');
    const { requireVideoAccess } = await load('authorization/resource-authorization');
    assert.equal((await details(live, viewer)).kind, 'live');
    assert.equal((await playback(live, viewer)).stream_type, 'on-demand');
    assert.equal(await details(liveDraft, viewer), null);
    assert.equal((await details(liveDraft, owner)).kind, 'live');
    await assert.rejects(playback(liveDraft, owner), { status: 409 });
    await requireVisibleVideo(database, liveDraft, owner);
    assert.equal((await comments({ params: { id: live }, query: {} }, viewer)).total, 0);
    await patch({ params: { videoId: live }, body: { title: 'Changed live title' } });
    await progress(live, viewer, 25);
    const guard = requireVideoAccess({ ownPermission: 'videos.update_own', anyPermission: 'videos.update_any' });
    for (const [permission, expected] of [['videos.update_own', 403], ['livestreams.update_own', 200]]) {
      let status = 200;
      await guard({ params: { videoId: live }, user: { sub: owner }, authorization: { isOwner: false, permissions: new Map([[permission, 'allow']]) } },
        { status(code) { status = code; return this; }, json() {} }, error => { if (error) throw error; });
      assert.equal(status, expected);
    }
    await client.query("UPDATE video_livestreams SET status = 'live', recording_finalized_at = NULL, mux_live_playback_id = 'live-playback' WHERE video_id = $1", [live]);
    await assert.rejects(progress(live, viewer, 25), { status: 404 });
    await assert.rejects(patch({ params: { videoId: live }, body: { chapters: [] } }), { status: 409 });
    assert.equal((await playback(live, viewer)).mux_playback_id, 'live-playback');
    await client.query("UPDATE video_livestreams SET mode = 'dvr' WHERE video_id = $1", [live]);
    assert.equal((await playback(live, viewer)).mux_playback_id, 'fixture-playback');
    const { heartbeatWatchDurationInternal: heartbeat } = await load('videos/video/handlers/heartbeatWatchDuration');
    await client.query('INSERT INTO video_views VALUES ($1,$2,now(),$3,now(),0,0,NULL,NULL,false)', [uuid(400), live, viewer]);
    assert.ok(await heartbeat(uuid(400), { seq: 1, userId: viewer }));
    await client.query("UPDATE video_livestreams SET status = 'ended', recording_finalized_at = now() WHERE video_id = $1", [live]);
  });

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
      assert.deepEqual((await module[`${name}Internal`]({ query: {} }, viewer)).videos.map(v => v.id).sort(), [published, live]);
    }
    const myVideos = await mine({ query: {} }, owner);
    assert.equal(myVideos.total, 5);
    assert.ok(myVideos.videos.find(v => v.id === scheduled).published_at);
    assert.equal(myVideos.videos.find(v => v.id === draft).published_at, null);
  });

  await t.test('playlist videos and counts include ready livestreams while honoring publication', async () => {
    const { getPlaylistWithVideosInternal: withVideos } = await load('playlists/playlists/handlers/getPlaylistWithVideos');
    const { getPlaylistVideosInternal: videos } = await load('playlists/playlists/handlers/getPlaylistVideos');
    const { getPlaylistByIdInternal: byId } = await load('playlists/playlists/handlers/getPlaylistById');
    const { searchPlaylistsInternal: searchLists } = await load('playlists/playlists/handlers/searchPlaylists');
    const { getFeaturedPlaylistsInternal: featured } = await load('playlists/playlists/handlers/getFeaturedPlaylists');
    const { getSavedPlaylistsInternal: saved } = await load('playlists/playlists/handlers/getSavedPlaylists');
    const result = await withVideos(playlist, viewer);
    assert.equal(result.video_count, 2);
    assert.deepEqual(result.videos.map(v => v.id).sort(), [published, live]);
    assert.equal(result.videos.find(v => v.id === live).kind, 'live');
    assert.ok(result.videos.find(v => v.id === live).mux_thumbnail_url);
    const page = await videos({ id: playlist }, viewer);
    assert.equal(page.pagination.total, 2);
    assert.deepEqual(page.videos.map(v => v.id).sort(), [published, live]);
    assert.equal(page.videos.find(v => v.id === live).kind, 'live');
    assert.equal(page.videos.find(v => v.id === published).kind, 'upload');
    assert.ok(page.videos.find(v => v.id === live).mux_thumbnail_url);
    assert.equal((await byId({ id: playlist })).video_count, 2);
    for (const lists of [await searchLists({}), await featured(), await saved(viewer)]) {
      assert.equal(lists.playlists[0].video_count, 2);
    }
    await client.query('UPDATE videos SET thumbnail_url = $1 WHERE id = $2', ['https://example.test/published.png', published]);
    await client.query('UPDATE videos SET thumbnail_url = $1 WHERE id = $2', ['https://example.test/scheduled.png', scheduled]);
    assert.equal((await playlistMedia([{ id: playlist }], viewer))[0].thumbnail_url, 'https://example.test/published.png');
    assert.equal((await playlistMedia([{ id: playlist }], owner))[0].thumbnail_url, 'https://example.test/scheduled.png');
  });

  await t.test('live-only playlists support adding, pagination, discovery, artwork and removal', async () => {
    const livePlaylist = uuid(201);
    const { addVideoToPlaylistInternal: add } = await load('playlists/playlist-moderation/handlers/addVideoToPlaylist');
    const { removeVideoFromPlaylistInternal: remove } = await load('playlists/playlist-moderation/handlers/removeVideoFromPlaylist');
    const { getPlaylistVideosInternal: videos } = await load('playlists/playlists/handlers/getPlaylistVideos');
    const { getPlaylistWithVideosInternal: withVideos } = await load('playlists/playlists/handlers/getPlaylistWithVideos');
    const { searchPlaylistsInternal: searchLists } = await load('playlists/playlists/handlers/searchPlaylists');
    await client.query('INSERT INTO playlists(id,created_by,title) VALUES ($1,$2,$3)', [livePlaylist, owner, 'Livestream playlist']);
    const input = { params: { playlistId: livePlaylist }, body: { video_id: live } };
    assert.equal((await add(input)).success, true);
    await assert.rejects(add(input), { status: 409 });
    const page = await videos({ id: livePlaylist, limit: 1 }, viewer);
    assert.equal(page.pagination.total, 1);
    assert.equal(page.pagination.totalPages, 1);
    assert.equal(page.videos[0].kind, 'live');
    assert.deepEqual((await videos({ id: livePlaylist, limit: 1, page: 2 }, viewer)).videos, []);
    assert.equal((await searchLists({})).playlists.find(p => p.id === livePlaylist).video_count, 1);
    const artwork = (await playlistMedia([{ id: livePlaylist }], viewer))[0];
    assert.ok(artwork.thumbnail_url.includes('/fixture-playback/thumbnail.webp'));
    await client.query('UPDATE videos SET thumbnail_url=$1 WHERE id=$2', ['https://example.test/live.png', live]);
    assert.equal((await playlistMedia([{ id: livePlaylist }], viewer))[0].thumbnail_url, 'https://example.test/live.png');

    // Adding a live entry does not bypass the normal visibility/readiness rules.
    for (const [visibility, publishedAt, muxStatus] of [
      ['private', '2000-01-01T00:00:00Z', 'ready'],
      ['public', '2999-01-01T00:00:00Z', 'ready'],
      ['public', null, 'ready'],
    ]) {
      await client.query('UPDATE videos SET visibility=$1,published_at=$2,mux_status=$3 WHERE id=$4', [visibility, publishedAt, muxStatus, live]);
      assert.equal((await videos({ id: livePlaylist }, viewer)).pagination.total, 0);
      assert.equal((await withVideos(livePlaylist, viewer)).videos.length, 0);
      assert.equal((await searchLists({})).playlists.some(p => p.id === livePlaylist), false);
      assert.equal((await playlistMedia([{ id: livePlaylist }], viewer))[0].thumbnail_url, null);
    }
    await client.query("UPDATE videos SET visibility='public',published_at='2000-01-01',mux_status='ready' WHERE id=$1", [live]);
    assert.equal((await playback(live, owner)).stream_type, 'on-demand');
    assert.equal((await media([{ id: live }], owner))[0].mux_thumbnail_url, null);
    assert.equal((await remove({ params: { playlistId: livePlaylist, videoId: live } })).success, true);
    assert.equal((await videos({ id: livePlaylist }, viewer)).pagination.total, 0);
  });

  await t.test('scheduled lives appear in playlists, posts and live search, but not continue watching or similar results', async () => {
    const { listLivestreamsInternal: list } = await load('livestreams/handlers/listLivestreams');
    const { withPostVideoCards: posts } = await load('posts/helpers/postVideoCards');
    const { getContinueWatchingInternal: continued } = await load('videos/video/handlers/getContinueWatching');
    const { getUserHistoryInternal: history } = await load('videos/video/handlers/getUserHistory');
    const { getSimilarVideosInternal: similar } = await load('videos/video/handlers/getSimilarVideos');
    const { getPlaylistVideosInternal: playlistVideos } = await load('playlists/playlists/handlers/getPlaylistVideos');
    await client.query("UPDATE videos SET mux_status='preparing' WHERE id=$1", [live]);
    await client.query("UPDATE video_livestreams SET status='scheduled', recording_finalized_at=NULL WHERE video_id=$1", [live]);
    const listed = (await list({}, viewer)).livestreams;
    assert.deepEqual(listed.map(v => v.id), [live]);
    assert.equal(listed[0].playback_available, false);
    assert.equal(listed[0].thumbnail_url, 'https://example.test/live.png');
    assert.equal((await list({}, owner, true)).livestreams.length, 2);
    assert.equal((await list({ q: 'does-not-exist' }, viewer)).livestreams.length, 0);
    assert.equal((await list({ channel_id: viewer }, viewer)).livestreams.length, 0);
    const embedded = await posts([{ blocks: [{ type: 'video', content: { video_id: live } }] }], viewer);
    assert.equal(embedded[0].blocks[0].video_card.livestream.status, 'scheduled');
    assert.ok((await playlistVideos({ id: playlist }, viewer)).videos.some(v => v.id === live));
    assert.ok(!(await continued({ query: {} }, viewer)).videos.some(v => v.id === live));
    assert.deepEqual((await history({ query: {}, allowedKinds: ['upload'] }, viewer)).videos.map(v => v.id), [published]);
    assert.deepEqual((await history({ query: {}, allowedKinds: ['live'] }, viewer)).videos.map(v => v.id), [live]);
    assert.ok((await similar(live, viewer)).every(v => v.id !== live && v.id !== liveDraft));
    await assert.rejects(requireVisibleVideo(database, live, viewer, { recording: true }), { status: 404 });
    await client.query("UPDATE videos SET mux_status='ready' WHERE id=$1", [live]);
    await client.query("UPDATE video_livestreams SET status='ended', recording_finalized_at=now() WHERE video_id=$1", [live]);
  });

  await t.test('platform and channel metrics include both kinds and honor kind filters', async () => {
    await client.query('INSERT INTO video_views VALUES ($1,$2,now(),$3,now(),0,12,NULL,NULL,false)', [uuid(401), published, viewer]);
    for (const [folder, name] of [['platform','getPlatformDeviceSplit'],['channel','getChannelDeviceSplit'],['channel','getChannelOverviewAnalytics']]) {
      const fn = (await load('analytics/handlers/' + folder + '/' + name))[name + 'Internal'];
      assert.equal((await fn({}, owner)).totalViews, 2);
      assert.equal((await fn({ kind: 'live' }, owner)).totalViews, 1);
      assert.equal((await fn({ kind: 'upload' }, owner)).totalViews, 1);
      await assert.rejects(fn({ kind: 'invalid' }, owner), { status: 400 });
    }
  });

  await t.test('shared endpoint permissions select the stored kind and mixed libraries preserve denials', async () => {
    const { requireContentPermission, requireMixedLibrary } = await load('authorization/video-permissions.middleware');
    for (const [videoId, permission, expected] of [[live,'videos.react',403],[live,'livestreams.react',200],[published,'livestreams.react',403],[published,'videos.react',200]]) {
      let status=200;
      const req={ params: {id:videoId},user:{sub:viewer},authorization:{isOwner:false,permissions:new Map([[permission,'allow']])} };
      await requireContentPermission('react')(req,{status(code){status=code;return this;},json(){}},error=>{if(error)throw error;});
      assert.equal(status,expected);
    }
    const req={ user:{sub:viewer}, authorization:{isOwner:false,permissions:new Map([['videos.library.read','deny'],['livestreams.library.read','allow']])} };
    await requireMixedLibrary(req,{status(){assert.fail('Live-only library access should work');}},error=>{if(error)throw error;});
    assert.deepEqual(req.allowedVideoKinds,['live']);
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
