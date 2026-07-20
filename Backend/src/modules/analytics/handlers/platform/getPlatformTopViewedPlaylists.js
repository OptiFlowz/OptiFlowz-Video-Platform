import { readPool } from '../../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../../common/input.validation.js';
import {
  buildPlaylistCardSelect,
  buildPlaylistCardJoins,
  buildPlaylistCardVisibilityWhere,
} from '../../../../database/sql/playlistCardFragments.js';
import { buildDateFilter } from '../../helpers/dateFilter.js';

function prerequisites(object, userId) {
  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  const schema = z
    .object({
      userId: z.string().uuid('Invalid user ID'),
      fromDate: z.coerce.date().optional(),
      toDate: z.coerce.date().optional(),
    })
    .refine(
      ({ fromDate, toDate }) => !fromDate || !toDate || fromDate <= toDate,
      { message: 'fromDate must be before or equal to toDate', path: ['fromDate'] },
    );

  return validateOrThrow(schema.safeParse({ ...object, userId }));
}

export async function getPlatformTopViewedPlaylistsInternal(object, userId = null) {
  const { fromDate, toDate } = prerequisites(object, userId);

  const filter = buildDateFilter('pv', fromDate, toDate, 0);
  const { rows } = await readPool.query(
    `
      WITH period_view_counts AS (
        SELECT pv.playlist_id, COUNT(*)::int AS period_views
        FROM playlist_views pv
        WHERE true${filter.sql}
        GROUP BY pv.playlist_id
      ),
      playlist_cards AS (
        ${buildPlaylistCardSelect()},p.description
        ${buildPlaylistCardJoins()}
        WHERE ${buildPlaylistCardVisibilityWhere()}
      )
      SELECT
        playlist_cards.*,
        COALESCE(period_view_counts.period_views, 0) AS period_views
      FROM playlist_cards
      LEFT JOIN period_view_counts
        ON period_view_counts.playlist_id = playlist_cards.id
      ORDER BY period_views DESC, playlist_cards.created_at DESC
      LIMIT 3
    `,
    filter.values,
  );

  return rows;
}
