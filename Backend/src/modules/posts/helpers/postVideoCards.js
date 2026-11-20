import { videoCardAudienceWhere, visibleVideoWhere } from '../../../common/videoAccess.js';
import { z } from 'zod';
import { readPool } from '../../../database/index.js';
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
    const { rows } = await readPool.query(
      `${buildVideoCardSelect({ includeWatchProgress })}
       ${buildVideoCardJoins({ includeWatchProgress, watchProgressUserParam: '$2' })}
       WHERE v.id = ANY($1::uuid[]) AND ${visibleVideoWhere()} AND ${videoCardAudienceWhere('$2')}`,
      [videoIds, viewerId],
    );
    cards = await withVideoCardMedia(rows, viewerId);
  }
  const cardsById = new Map(cards.map(card => [card.id, card]));
  // Keep existing placeholders for unavailable attachments. Remove the entire
  // block, including its stored video ID, when the viewer may not discover it.
  const unresolved = videoIds.filter(id => !cardsById.has(id));
  const hiddenIds = new Set();
  if (unresolved.length) {
    const { rows } = await readPool.query(
      `SELECT v.id FROM public.videos v WHERE v.id = ANY($1::uuid[]) AND NOT ${videoCardAudienceWhere('$2')}`,
      [unresolved, viewerId],
    );
    for (const row of rows) hiddenIds.add(row.id);
  }
  return posts.map(post => {
    const key = post.blocks ? 'blocks' : 'video_blocks';
    if (!Array.isArray(post[key])) return post;
    return {
      ...post,
      [key]: post[key].flatMap(block => {
        if (block.type !== 'video') return [block];
        const id = videoId(block);
        return hiddenIds.has(id) ? [] : [{ ...block, video_card: cardsById.get(id) ?? null }];
      }),
    };
  });
}
