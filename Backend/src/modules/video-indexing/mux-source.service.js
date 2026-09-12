import { transaction, enqueueSource, disableSource } from './indexing.service.js';

export async function retrieveAsset(assetId, signal) {
  const auth = Buffer.from(`${process.env.MUX_TOKEN_ID}:${process.env.MUX_TOKEN_SECRET}`).toString(
    'base64',
  );
  const response = await fetch(
    `https://api.mux.com/video/v1/assets/${encodeURIComponent(assetId)}`,
    {
      headers: { Authorization: `Basic ${auth}` },
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15000)])
        : AbortSignal.timeout(15000),
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Mux asset lookup failed (${response.status})`);
  return (await response.json()).data;
}

// Serialize reconciliation with local edits/deletions. Read current Mux state,
// not the potentially duplicated or out-of-order webhook track snapshot.
export async function reconcileTracks(assetId, videoId = null, { force = false } = {}) {
  return transaction(async (client) => {
    const { rows: videos } = await client.query(
      `SELECT id,mux_asset_id,mux_status FROM videos
      WHERE mux_asset_id=$1 OR (id=$2::uuid AND mux_asset_id IS NULL) FOR UPDATE`,
      [assetId, videoId],
    );
    const video = videos[0];
    if (!video || video.mux_status === 'deleted') return;
    const asset = await retrieveAsset(assetId);
    const { rows: sources } = await client.query(
      `SELECT * FROM video_indexing_sources
      WHERE video_id=$1 AND document_type='transcript_chunk' FOR UPDATE`,
      [video.id],
    );
    const tracks = (asset?.tracks || []).filter(
      (t) => t.type === 'text' && ['subtitles', 'captions'].includes(t.text_type),
    );
    const languages = new Set([
      ...sources.map((s) => s.language),
      ...tracks.map((t) => (t.language_code || 'und').toLowerCase()),
    ]);
    for (const language of languages) {
      const source = sources.find((s) => s.language === language);
      const candidates = tracks.filter(
        (t) => (t.language_code || 'und').toLowerCase() === language,
      );
      // Prefer the selected track; otherwise choose deterministically.
      const selected =
        candidates.find((t) => t.id === source?.source_track_id) ||
        candidates.filter((t) => t.status === 'ready').sort((a, b) => a.id.localeCompare(b.id))[0];
      if (!selected || selected.status !== 'ready') {
        if (source?.enabled) await disableSource(client, source.id);
        continue;
      }
      if (source?.source_track_id === selected.id && (!force || !source.enabled)) continue;
      const { rows } = await client.query(
        `INSERT INTO video_indexing_sources
        (video_id,document_type,language,source_track_id) VALUES ($1,'transcript_chunk',$2,$3)
        ON CONFLICT (video_id,document_type,language) DO UPDATE SET
        source_track_id=EXCLUDED.source_track_id,enabled=true,
        desired_revision=video_indexing_sources.desired_revision+1,updated_at=now() RETURNING *`,
        [video.id, language, selected.id],
      );
      // A replaced/deleted track must no longer appear in search.
      if (source?.source_track_id !== selected.id) {
        await client.query('DELETE FROM video_documents_pg WHERE source_id=$1', [rows[0].id]);
      }
      await enqueueSource(client, rows[0]);
    }
  });
}
