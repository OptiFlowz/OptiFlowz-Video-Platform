import type { ChannelVideoT } from '~/types';
export type PostOption = { id: string; text: string; image?: string; votes: number; isCorrect?: boolean };
export type PostBlock = { hasResponses?: boolean } & (
  | { id: string; type: 'text'; text: string }
  | { id: string; type: 'image'; image: string; text: string }
  | { id: string; type: 'video'; videoId: string; text: string; video?: ChannelVideoT }
  | { id: string; type: 'poll' | 'questionnaire'; text: string; options: PostOption[]; correctIds?: string[]; selectedOptionId?: string | null; selectedOptionIds?: string[] }
);
export type Post = { id: string; title: string; createdAt: string; status: 'public' | 'private'; blocks: PostBlock[]; persisted?: boolean; userId?: string };
export type PostSummary = Omit<Post, 'blocks'> & { text: string; blockTypes: PostBlock['type'][] };
export type PostAuthor = { full_name?: string; image_url?: string | null };
export const blockTypes = ['text', 'image', 'poll', 'questionnaire', 'video'] as const;
export const newId = () => crypto.randomUUID();
export function newBlock(type: PostBlock['type']): PostBlock {
  const base = { id: newId(), text: '' };
  if (type === 'image') return { ...base, type, image: '' };
  if (type === 'video') return { ...base, type, videoId: '' };
  if (type === 'poll' || type === 'questionnaire') return { ...base, type, options: [0, 1].map(() => ({ id: newId(), text: '', votes: 0 })) };
  return { ...base, type };
}
export function validPost(post: Post): boolean {
  return !!post.title.trim() && post.title.trim().length <= 255 && post.blocks.length > 0 && post.blocks.length <= 50 && post.blocks.every(block => {
    if (block.text.trim().length > 10000) return false;
    if (block.type === 'text') return !!block.text.trim();
    if (block.type === 'image') return !!block.image;
    if (block.type === 'video') return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(block.videoId);
    return !!block.text.trim() && block.options.length >= 2 && block.options.length <= 20 && block.options.every(option => !!option.text.trim() && option.text.trim().length <= 500)
      && (block.type !== 'questionnaire' || block.options.some(option => block.correctIds?.includes(option.id)));
  });
}
export function optionPercent(options: PostOption[], option: PostOption) {
  const total = options.reduce((sum, item) => sum + item.votes, 0);
  return total ? Math.round(option.votes / total * 10000) / 100 : 0;
}

export function selectedPostOptions(block: Extract<PostBlock, { options: unknown }>) {
  return block.selectedOptionIds ?? (block.selectedOptionId ? [block.selectedOptionId] : []);
}
// Subtract the previous set before adding the submitted set, without changing the source.
export function withOptimisticVote(block: Extract<PostBlock, { options: unknown }>, selectedOptionIds: string[]) {
  const previous = selectedPostOptions(block);
  const options = block.options.map(option => ({ ...option,
    votes: Math.max(0, option.votes - (previous.includes(option.id) ? 1 : 0))
      + (selectedOptionIds.includes(option.id) ? 1 : 0),
  }));
  return { ...block, selectedOptionIds, selectedOptionId: selectedOptionIds.length === 1 ? selectedOptionIds[0] : null,
    options, hasResponses: options.some(option => option.votes > 0) };
}
