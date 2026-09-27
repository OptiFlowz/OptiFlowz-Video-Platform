import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { buildVideoCardSelect, buildVideoCardJoins } from '../../../database/sql/videoCardFragments.js';
import { withVideoCardMedia } from '../../videos/helpers/videoCardMedia.js';

const videoIdSchema = z.string().uuid();

function videoId(block) {
  const parsed = videoIdSchema.safeParse(block.content?.video_id);
  return parsed.success ? parsed.data.toLowerCase() : null;
}

// Full feeds carry blocks; the owner's summary cards carry only video_blocks.
// Resolve each referenced video once per response, preserving block order.
export async function withPostVideoCards(posts, viewerId = null) {
  const videoIds = [...new Set(posts.flatMap(post => (post.blocks ?? post.video_blocks ?? [])
    .filter(block => block.type === 'video').map(videoId)).filter(Boolean))];
  let cards = [];
  if (videoIds.length) {
    const includeWatchProgress = viewerId !== null;
    const { rows } = await writePool.query(
      `${buildVideoCardSelect({ includeWatchProgress })}
       ${buildVideoCardJoins({ includeWatchProgress, watchProgressUserParam: '$2' })}
       WHERE v.id = ANY($1::uuid[]) AND v.mux_status = 'ready'
         AND ((v.visibility = 'public' AND v.published_at <= NOW())
           OR (v.visibility IN ('public', 'private') AND v.uploaded_by = $2::uuid))`,
      [videoIds, viewerId],
    );
    cards = await withVideoCardMedia(rows, viewerId);
  }
  const cardsById = new Map(cards.map(card => [card.id, card]));
  return posts.map(post => {
    const key = post.blocks ? 'blocks' : 'video_blocks';
    if (!Array.isArray(post[key])) return post;
    return {
      ...post,
      [key]: post[key].map(block => block.type === 'video'
        ? { ...block, video_card: cardsById.get(videoId(block)) ?? null }
        : block),
    };
  });
}
