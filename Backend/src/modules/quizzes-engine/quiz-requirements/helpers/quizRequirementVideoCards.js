import { writePool } from '../../../../database/index.js';
import { buildVideoCardSelect, buildVideoCardJoins } from '../../../../database/sql/videoCardFragments.js';
import { withVideoCardMedia } from '../../../videos/helpers/videoCardMedia.js';

export async function withQuizRequirementVideoCards(requirements, userId) {
  if (!requirements.length) return [];
  const videoIds = [...new Set(requirements.map(requirement => requirement.video_id))];
  const { rows } = await writePool.query(`
    ${buildVideoCardSelect({ includeWatchProgress: true })}
    ${buildVideoCardJoins({ includeWatchProgress: true, watchProgressUserParam: '$2' })}
    WHERE v.id = ANY($1::uuid[]) AND v.mux_status = 'ready'
      AND ((v.visibility = 'public' AND v.published_at <= NOW())
        OR (v.visibility IN ('public', 'private') AND v.uploaded_by = $2))
  `, [videoIds, userId]);
  const cards = await withVideoCardMedia(rows, userId);
  const cardsById = new Map(cards.map(card => [card.id, card]));
  return requirements.map(requirement => ({
    ...requirement, video_card: cardsById.get(requirement.video_id) ?? null,
  }));
}
