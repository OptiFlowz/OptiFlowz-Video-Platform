import { HttpError } from '../../../common/httpError.js';

// Only fixed literals are interpolated. Invalid kinds fail before executing SQL.
export function analyticsSource(table, kind) {
  if (!['videos', 'video_views', 'video_reactions', 'video_comments'].includes(table)) throw new Error('Unsupported analytics source');
  if (kind === undefined || kind === 'all') return `public.${table}`;
  if (kind !== 'upload' && kind !== 'live') throw new HttpError(400, { message: 'kind must be upload, live, or all' });
  const value = kind === 'live' ? "'live'" : "'upload'";
  return table === 'videos' ? `(SELECT * FROM public.videos WHERE kind = ${value})`
    : `(SELECT * FROM public.${table} WHERE video_id IN (SELECT id FROM public.videos WHERE kind = ${value}))`;
}
