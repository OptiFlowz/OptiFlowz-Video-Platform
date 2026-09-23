import { fetchFn } from '~/API';
import type { ChannelVideoT } from '~/types';
import { getToken } from '~/functions';
import type { Post, PostBlock, PostOption, PostSummary } from './model';

export type ApiOption = { id: string; position?: number; text: string; image_url?: string | null; is_correct?: boolean; vote_count?: number; answer_count?: number };
export type ApiBlock = { id: string; type: 'text' | 'image' | 'video' | 'poll' | 'questioner'; content: { text?: string; url?: string; video_id?: string }; video_card?: ChannelVideoT | null; options?: ApiOption[]; has_responses?: boolean; selected_option_id?: string | null; selected_option_ids?: string[]; correct_option_ids?: string[] };
export type ApiPost = { like_count?: number; dislike_count?: number; user_reaction?: -1 | 0 | 1; id: string; user_id: string; author_full_name?: string | null; author_image_url?: string | null; title: string; status: Post['status']; created_at: string; blocks: ApiBlock[] };
export type PaginationData = { page: number; limit: number; total: number; totalPages: number; hasNextPage: boolean };
export type Participation = { has_responses?: boolean; selected_option_id: string | null; selected_option_ids?: string[]; options: ApiOption[]; correct_option_ids?: string[]; is_correct?: boolean; total_votes?: number; total_answers?: number };
export function postRequest<T>(route: string, method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const multipart = body instanceof FormData;
  if (body !== undefined && !multipart) headers['Content-Type'] = 'application/json';
  return fetchFn<T>({ route: `api/posts${route}`, options: { method, headers, signal, ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }) } });
}
export const fromOption = (option: ApiOption): PostOption => ({ id: option.id, position: option.position, text: option.text, image: option.image_url || undefined, votes: option.vote_count ?? option.answer_count ?? 0, isCorrect: option.is_correct });
// Keep the API's explicit ordering for feed, preview, editor, and vote results.
export function fromOptions(options: ApiOption[]): PostOption[] {
  return options.map((option, index) => ({ ...fromOption(option), position: option.position ?? index }))
    .sort((a, b) => a.position - b.position);
}
export function fromBlock(block: ApiBlock): PostBlock {
  const base = { id: block.id, text: block.content.text || '', hasResponses: block.has_responses };
  if (block.type === 'image') return { ...base, type: 'image', image: block.content.url || '' };
  if (block.type === 'video') return { ...base, type: 'video', videoId: block.content.video_id || '', video: block.video_card };
  if (block.type === 'poll' || block.type === 'questioner') return { ...base, type: block.type === 'questioner' ? 'questionnaire' : 'poll', options: fromOptions(block.options || []), selectedOptionId: block.selected_option_id ?? null, selectedOptionIds: block.selected_option_ids ?? (block.selected_option_id ? [block.selected_option_id] : []), correctIds: block.correct_option_ids ?? block.options?.filter(option => option.is_correct).map(option => option.id) };
  return { ...base, type: 'text' };
}
export const fromPost = (post: ApiPost): Post => ({ likeCount: post.like_count ?? 0, dislikeCount: post.dislike_count ?? 0, userReaction: post.user_reaction ?? 0, id: post.id, userId: post.user_id, author: { full_name: post.author_full_name || undefined, image_url: post.author_image_url }, title: post.title, status: post.status, createdAt: post.created_at, blocks: post.blocks.map(fromBlock), persisted: true });
export async function getPost(id: string, signal?: AbortSignal) { return fromPost((await postRequest<{ post: ApiPost }>(`/details/${id}`, 'GET', undefined, signal)).post); }
export async function getMyPosts(page: number, limit: number, ascending: boolean, search: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit), sortBy: 'created_at', sortOrder: ascending ? 'asc' : 'desc', q: search });
  const data = await postRequest<{ posts: Array<Omit<ApiPost, 'blocks'> & { text: string; block_types: ApiBlock['type'][] }>; pagination: PaginationData }>(`/my?${params}`, 'GET', undefined, signal);
  return { ...data, posts: data.posts.map((post): PostSummary => ({ id: post.id, title: post.title, createdAt: post.created_at, status: post.status, text: post.text, blockTypes: post.block_types.map(type => type === 'questioner' ? 'questionnaire' : type), persisted: true })) };
}
export async function getChannelPosts(id: string, page: number, ascending: boolean, signal?: AbortSignal) {
  const data = await postRequest<{ posts: ApiPost[]; pagination: PaginationData }>(`/${id}?page=${page}&limit=20&sortBy=created_at&sortOrder=${ascending ? 'asc' : 'desc'}`, 'GET', undefined, signal);
  return { ...data, posts: data.posts.map(fromPost) };
}

export async function getRecommendedPosts(userIds: string[], signal?: AbortSignal) {
  const data = await postRequest<{ posts: ApiPost[]; pagination: PaginationData }>(
    '/recommended?page=1&limit=10&sortBy=created_at&sortOrder=desc', 'POST', { user_ids: userIds }, signal,
  );
  return { ...data, posts: data.posts.map(fromPost) };
}

// Only locally selected data URLs become uploads; existing server URLs are never re-uploaded.
function imageFile(image?: string) {
  if (!image?.startsWith('data:image/')) return undefined;
  const [prefix, encoded] = image.split(',');
  const mime = prefix.match(/^data:(image\/(?:png|jpeg|webp));base64$/)?.[1];
  if (!mime || !encoded) throw new Error('Invalid image');
  const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
  if (bytes.length > 5 * 1024 * 1024) throw new Error('Image exceeds 5 MB');
  return new File([bytes], `image.${mime.split('/')[1]}`, { type: mime });
}
function payload(data: unknown, files: Array<[string, File | undefined]>, field = 'data') {
  if (!files.some(([, file]) => file)) return data;
  const form = new FormData(); form.append(field, JSON.stringify(data));
  files.forEach(([name, file]) => { if (file) form.append(name, file); });
  return form;
}
export type SaveSession = { current?: Post };
// Checkpoint each successful write so a retry after a partial failure keeps IDs and responses.
export async function savePost(input: Post, session: SaveSession, checkpoint: (draft: Post) => void): Promise<Post> {
  const draft = structuredClone(input);
  try {
    if (!session.current) {
      const { post } = await postRequest<{ post: ApiPost }>('', 'POST', { title: draft.title.trim(), status: 'private' });
      session.current = fromPost(post);
      draft.id = post.id; draft.persisted = true; draft.createdAt = post.created_at;
      checkpoint(structuredClone(draft));
    }
    const current = session.current;
    const base = `/${current.id}`;
    for (const block of [...current.blocks]) {
      if (!draft.blocks.some(item => item.id === block.id)) {
        await postRequest(`${base}/blocks/${block.id}`, 'DELETE');
        current.blocks = current.blocks.filter(item => item.id !== block.id);
      }
    }
    for (let index = 0; index < draft.blocks.length; index++) {
      let block = draft.blocks[index];
      let old = current.blocks.find(item => item.id === block.id);
      if (!old) {
        const data = { type: block.type === 'questionnaire' ? 'questioner' : block.type, content: { text: block.text.trim(), ...(block.type === 'video' ? { video_id: block.videoId } : {}) }, ...('options' in block ? { options: block.options.map((option, position) => ({ position, text: option.text.trim(), ...(block.type === 'questionnaire' ? { is_correct: !!block.correctIds?.includes(option.id) } : {}) })) } : {}) };
        const files: Array<[string, File | undefined]> = block.type === 'image' ? [['file', imageFile(block.image)]] : 'options' in block ? block.options.map((option, i) => [`option_${i}`, imageFile(option.image)]) : [];
        const response = await postRequest<{ block: ApiBlock }>(`${base}/blocks`, 'POST', payload(data, files, 'block'));
        const appended = fromBlock(response.block);
        if (appended.type === 'video' && block.type === 'video' && appended.video === undefined) appended.video = block.video;
        block = appended; draft.blocks[index] = block; current.blocks.push(structuredClone(block));
        checkpoint(structuredClone(draft));
        continue;
      }
      const route = `${base}/blocks/${block.id}`;
      const content: Record<string, string> = {};
      if (old.text !== block.text.trim()) content.text = block.text.trim();
      if (block.type === 'video' && old.type === 'video' && old.videoId !== block.videoId) content.video_id = block.videoId;
      const file = block.type === 'image' ? imageFile(block.image) : undefined;
      if (Object.keys(content).length || file) {
        const result = fromBlock((await postRequest<{ block: ApiBlock }>(route, 'PATCH', payload({ content }, [['file', file]]))).block);
        old.text = result.text;
        if (result.type === 'image' && old.type === 'image' && block.type === 'image') old.image = block.image = result.image;
        if (result.type === 'video' && old.type === 'video' && block.type === 'video') {
          old.videoId = result.videoId;
          old.video = result.video !== undefined ? result.video : block.video;
        }
      }
      if ('options' in block && 'options' in old) {
        const desired = block;
        const saved = old;
        // Mark newly correct existing choices before unmarking/removing old correct choices.
        for (const option of desired.options) {
          if (desired.correctIds?.includes(option.id) && saved.options.some(item => item.id === option.id) && !saved.correctIds?.includes(option.id)) {
            await postRequest(`${route}/options/${option.id}`, 'PATCH', { is_correct: true });
            saved.correctIds = [...(saved.correctIds || []), option.id];
          }
        }
        const removeUnneeded = async () => {
          for (const option of [...saved.options]) {
            if (saved.options.length <= 2) break;
            if (desired.options.some(item => item.id === option.id)) continue;
            if (saved.type === 'questionnaire' && saved.correctIds?.includes(option.id) && saved.correctIds.length === 1) continue;
            await postRequest(`${route}/options/${option.id}`, 'DELETE');
            saved.options = saved.options.filter(item => item.id !== option.id).map((item, position) => ({ ...item, position }));
            saved.correctIds = saved.correctIds?.filter(id => id !== option.id);
          }
        };
        await removeUnneeded();
        // Add correct choices first so the server can always retain a correct answer.
        const additions = desired.options.filter(option => !saved.options.some(item => item.id === option.id)).sort((a, b) => Number(desired.correctIds?.includes(b.id)) - Number(desired.correctIds?.includes(a.id)));
        for (const option of additions) {
          const localId = option.id;
          const isCorrect = !!desired.correctIds?.includes(localId);
          const data = { position: saved.options.length, text: option.text.trim(), ...(desired.type === 'questionnaire' ? { is_correct: isCorrect } : {}) };
          const added = fromOption((await postRequest<{ option: ApiOption }>(`${route}/options`, 'POST', payload(data, [['file', imageFile(option.image)]]))).option);
          Object.assign(option, added);
          desired.correctIds = desired.correctIds?.map(id => id === localId ? added.id : id);
          saved.options.push(structuredClone(added));
          if (isCorrect) saved.correctIds = [...(saved.correctIds || []), added.id];
          checkpoint(structuredClone(draft));
          await removeUnneeded();
        }
        for (const option of desired.options) {
          const previous = saved.options.find(item => item.id === option.id)!;
          const changes: Record<string, string | boolean> = {};
          if (previous.text !== option.text.trim()) changes.text = option.text.trim();
          const correct = !!desired.correctIds?.includes(option.id);
          if (desired.type === 'questionnaire' && correct !== !!saved.correctIds?.includes(option.id)) changes.is_correct = correct;
          const image = imageFile(option.image);
          if (Object.keys(changes).length || image) {
            const updated = fromOption((await postRequest<{ option: ApiOption }>(`${route}/options/${option.id}`, 'PATCH', payload(changes, [['file', image]]))).option);
            Object.assign(previous, updated);
            if (image) option.image = updated.image;
            saved.correctIds = [...(saved.correctIds || []).filter(id => id !== option.id), ...(correct ? [option.id] : [])];
          }
          if (!option.image && previous.image) {
            await postRequest(`${route}/options/${option.id}/image`, 'DELETE');
            previous.image = undefined;
          }
        }
        await removeUnneeded();
        // Correct choices may have been added first to satisfy backend validation.
        // Restore the editor order once all additions/deletions have succeeded.
        for (let position = 0; position < desired.options.length; position++) {
          const option = desired.options[position];
          const savedIndex = saved.options.findIndex(item => item.id === option.id);
          if (savedIndex !== position) {
            await postRequest(`${route}/options/${option.id}`, 'PATCH', { position });
            const [moved] = saved.options.splice(savedIndex, 1);
            saved.options.splice(position, 0, moved);
            saved.options.forEach((item, index) => { item.position = index; });
          }
          option.position = position;
        }
      }
      checkpoint(structuredClone(draft));
    }
    const order = draft.blocks.map(block => block.id);
    await postRequest(base, 'PATCH', { title: draft.title.trim(), status: draft.status, block_order: order });
    current.title = draft.title.trim(); current.status = draft.status;
    current.blocks = order.map(id => current.blocks.find(block => block.id === id)!);
    return structuredClone(current);
  } finally { checkpoint(structuredClone(draft)); }
}

export async function reactToPost(id: string, reaction: 'like' | 'dislike') {
  const result = await postRequest<{ success: boolean; status: -1 | 0 | 1 }>(`/${id}/${reaction}`, 'POST');
  if (!result?.success || ![1, 0, -1].includes(result.status)) throw new Error('Invalid post reaction response');
  return result.status;
}
