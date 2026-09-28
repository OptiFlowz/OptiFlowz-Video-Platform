import { readFile } from 'node:fs/promises';

export async function prepareLiveSchema(client, beforeUpgrade) {
  await client.query('CREATE TEMP TABLE users (id uuid PRIMARY KEY)');
  await client.query('CREATE TEMP TABLE videos (LIKE public.videos INCLUDING DEFAULTS INCLUDING CONSTRAINTS)');
  // Also work when the application database has already applied the upgrade.
  await client.query(`ALTER TABLE pg_temp.videos DROP COLUMN IF EXISTS live_stream_id,
    DROP COLUMN IF EXISTS mux_asset_event_at, DROP COLUMN IF EXISTS mux_recording_started_at,
    DROP COLUMN IF EXISTS mux_recording_completed_at`);
  await client.query('ALTER TABLE pg_temp.videos ADD PRIMARY KEY (id)');
  for (const file of ['1790553600000_add-live-streams.sql', '1790553600001_add-live-stream-webhook-state.sql', '1790553600002_live-stream-recordings.sql']) {
    if (file.includes('0002_') && beforeUpgrade) await beforeUpgrade();
    const sql = await readFile(new URL(`../../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await client.query(sql.split('-- Down Migration')[0].replaceAll('public.', 'pg_temp.'));
  }
}
