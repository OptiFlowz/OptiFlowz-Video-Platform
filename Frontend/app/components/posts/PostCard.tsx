import { CheckSVG, CloseSVG } from "~/constants";
import { getVideoThumbnail } from "~/components/shared/videoMedia";
import { useRef, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { fetchFn } from '~/API';
import { getToken } from '~/functions';
import { redirectToLogin } from '~/auth/session';
import { useAuthorization } from '~/authorization/authorization';
import { fromOptions, getPost, getChannelPosts, postRequest, type Participation } from './api';
import { Link } from 'react-router';
import { useI18n } from '~/i18n';
import { formatDate, formatViews } from '~/functions';
import type { ChannelVideoT } from '~/types';
import DefaultProfile from '../../../assets/DefaultProfile.webp';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import { optionPercent, selectedPostOptions, withOptimisticVote, type Post, type PostBlock, type PostAuthor } from './model';
import './posts.css';

type PollBlock = Extract<PostBlock, { options: unknown }>;

function Poll({ block, postId, interactive, readOnly }: { block: PollBlock; postId: string; interactive: boolean; readOnly: boolean }) {
  const { t } = useI18n();
  const { user, can, loading: permissionsLoading } = useAuthorization();
  const client = useQueryClient();
  const [previewSelection, setPreviewSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState('');
  const token = getToken();
  const [updated, setUpdated] = useState<{ source: PollBlock; token: typeof token; value: PollBlock }>();
  const [optimistic, setOptimistic] = useState<{ token: typeof token; value: PollBlock }>();
  const [draftSelection, setDraftSelection] = useState<{ token: typeof token; ids: string[] }>({ token, ids: [] });
  const pendingIds = draftSelection.token === token ? draftSelection.ids : [];
  const persisted = interactive || readOnly;
  const current = optimistic?.token === token ? optimistic.value : updated?.source === block && updated.token === token ? updated.value : block;
  const selectedIds = persisted ? selectedPostOptions(current) : previewSelection;
  const submitted = selectedIds.length > 0;
  const options = persisted ? current.options : block.options;
  const correctIds = persisted ? current.correctIds : block.correctIds;
  const applyBlock = (next: PollBlock) => {
    setUpdated({ source: block, token, value: next });
    // Reuse the vote response in every cached sort/page for this viewer.
    client.setQueriesData<InfiniteData<Awaited<ReturnType<typeof getChannelPosts>>>>({
      queryKey: ['posts', 'channel'], predicate: query => query.queryKey[3] === token,
    }, data => data ? { ...data, pages: data.pages.map(page => ({ ...page,
      posts: page.posts.map(post => post.id === postId ? { ...post,
        blocks: post.blocks.map(item => item.id === block.id ? next : item),
      } : post),
    })) } : data);
  };
  const multiple = block.type === 'questionnaire' && (correctIds?.length ?? 0) > 1;
  const answerLocked = block.type === 'questionnaire' && submitted;
  const showFeedback = submitted && (block.type === 'questionnaire' || !busy);
  const answerCorrect = !!correctIds?.length && selectedIds.length === correctIds.length && selectedIds.every(id => correctIds.includes(id));
  const allowed = !user || can(block.type === 'questionnaire' ? 'posts.questioner.answer' : 'posts.poll.vote');
  const submit = async (optionIds: string[]) => {
    if (readOnly || answerLocked || inFlight.current || !optionIds.length) return;
    const optionId = optionIds[0];
    const remove = block.type === 'poll' && selectedIds.includes(optionId);
    if (!interactive) { setPreviewSelection(remove ? [] : optionIds); return; }
    if (!user) { redirectToLogin(`${window.location.pathname}${window.location.search}${window.location.hash}`); return; }
    const previous = current;
    inFlight.current = true; setBusy(true); setError('');
    setOptimistic({ token, value: withOptimisticVote(previous, remove ? [] : optionIds) });
    try {
      await client.cancelQueries({ queryKey: ['posts', 'channel'], predicate: query => query.queryKey[3] === token });
      const result = await postRequest<Participation>(`/${postId}/blocks/${block.id}/${block.type === 'questionnaire' ? 'answer' : 'vote'}`, 'POST', multiple ? { option_ids: optionIds } : { option_id: optionId, ...(remove ? { remove: true } : {}) });
      applyBlock({ ...previous, selectedOptionId: result.selected_option_id,
        selectedOptionIds: result.selected_option_ids ?? (result.selected_option_id ? [result.selected_option_id] : []),
        options: fromOptions(result.options), correctIds: result.correct_option_ids, hasResponses: result.has_responses ?? true });
    } catch (error) {
      setOptimistic(undefined);
      applyBlock(previous);
      setError(error instanceof Error ? error.message : t('postVoteError'));
      // A concurrent answer or an uncertain response must restore the server's selection.
      try {
        const post = await getPost(postId);
        const restored = post.blocks.find(item => item.id === block.id);
        if (restored && (restored.type === 'poll' || restored.type === 'questionnaire')) applyBlock(restored);
      } catch { /* Keep the submission error visible if recovery also fails. */ }
    } finally { setOptimistic(undefined); inFlight.current = false; setBusy(false); }
  };
  const choose = (optionId: string) => {
    if (readOnly || answerLocked || inFlight.current) return;
    if (multiple) {
      setDraftSelection({ token, ids: pendingIds.includes(optionId) ? pendingIds.filter(id => id !== optionId) : [...pendingIds, optionId] });
    } else { void submit([optionId]); }
  };
  return <section className="postPoll" aria-label={block.text} aria-busy={busy}>
    <p>{block.text}</p>
    <div className="postOptions">{options.map(option => {
      const correct = submitted && block.type === 'questionnaire' && !!correctIds?.includes(option.id);
      const incorrect = selectedIds.includes(option.id) && block.type === 'questionnaire' && !correctIds?.includes(option.id);
      const percent = optionPercent(options, option);
      const showResults = submitted;
      const chosen = (multiple && !submitted ? pendingIds : selectedIds).includes(option.id);
      return <button type="button" key={option.id} aria-pressed={chosen}
        className={`postOption ${chosen ? 'isSelected' : ''} ${correct ? 'isCorrect' : ''} ${incorrect ? 'isIncorrect' : ''}`}
        disabled={readOnly || answerLocked || busy || (interactive && (permissionsLoading || !allowed))}
        onClick={() => choose(option.id)}>
        <span className="postOptionFill" style={{ width: showResults ? `${percent}%` : chosen ? '100%' : '0%' }} aria-hidden="true" />
        {option.image ? <img src={option.image} alt="" /> : <span className={`postOptionDot ${correct || incorrect ? 'isResultIcon' : ''}`} aria-hidden="true">{correct ? CheckSVG : incorrect ? CloseSVG : null}</span>}
        <span className="postOptionLabel">{option.text}{correct && <small>{t('postCorrectAnswer')}</small>}</span>
        <span className={`postOptionPercent ${showResults ? 'isVisible' : ''}`} aria-hidden={!showResults}>{percent}%</span>
      </button>;
    })}</div>
    {error && <p role="alert" className="postError">{error}</p>}
    {interactive && !user && <p className="postPollFeedback">{t('postSignInVote')}</p>}
    {interactive && user && !permissionsLoading && !allowed && <p className="postPollFeedback">{t('postCannotVote')}</p>}
    {multiple && !submitted && !readOnly && <div className="postPollSubmit"><button type="button" className="postPrimary" disabled={!pendingIds.length || busy || (interactive && (permissionsLoading || !allowed))} onClick={() => void submit(pendingIds)}>{t('postSubmitAnswers')}</button></div>}
    <div className="postPollResultFeedback" data-visible={showFeedback} aria-hidden={!showFeedback}>
      <div><p className="postPollFeedback" role="status">{t(block.type === 'poll' ? 'postVoteRecorded' : answerCorrect ? 'postCorrectAnswer' : 'postWrongAnswer')}</p></div>
    </div>
  </section>;
}
export function PostAuthorHeader({ author, createdAt, children }: { author: PostAuthor; createdAt: string; children?: ReactNode }) {
  const { t } = useI18n();
  return <div className="postAuthor"><img src={author.image_url || DefaultProfile} alt="" /><div><strong>{author.full_name || t('channelLabel')}</strong><time dateTime={createdAt}>{formatDate(createdAt)}</time></div>{children}</div>;
}

export function PostVideoPreview({ video: suppliedVideo, videoId, linked = false }: { video?: ChannelVideoT; videoId?: string; linked?: boolean }) {
  const token = getToken();
  const query = useQuery({ queryKey: ['post-video', videoId, token], enabled: !!videoId && !suppliedVideo, retry: false,
    queryFn: ({ signal }) => fetchFn<ChannelVideoT>({ route: `api/videos/${videoId}`, options: { signal, headers: token ? { Authorization: `Bearer ${token}` } : {} } }) });
  const video = suppliedVideo || query.data;
  const { t } = useI18n();
  if (!video && videoId && query.isPending) return <div className="postInset">{t('postLoading')}</div>;
  if (!video) return <div className="postInset">{t('postVideoUnavailable')}</div>;
  const content = <>
    <img src={getVideoThumbnail(video) || DefaultThumbnail} onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = DefaultThumbnail; }} alt="" />
    <div><strong>{video.title}</strong><small>{video.uploader_name}</small><div className="postVideoMeta"><span>{formatViews(video.view_count)}</span><span>{formatDate(video.created_at)}</span></div></div>
  </>;
  return linked ? <Link className="postVideoMention" to={`/video/${video.id}`}>{content}</Link> : <div className="postVideoMention">{content}</div>;
}

export default function PostCard({ post, author, videos = [], interactive = false, readOnly = false }: { post: Post; author: PostAuthor; videos?: ChannelVideoT[]; interactive?: boolean; readOnly?: boolean }) {
  return <article className="postCard" aria-label={post.title}>
    <PostAuthorHeader author={author} createdAt={post.createdAt} />
    <div className="postBlocks">{post.blocks.map(block => {
      if (block.type === 'text') return <div key={block.id} className="postInset postText">{block.text}</div>;
      if (block.type === 'image') return <figure key={block.id} className="postInset">{block.text && <figcaption>{block.text}</figcaption>}{block.image && <img className="postImage" src={block.image} alt={block.text} />}</figure>;
      if (block.type === 'poll' || block.type === 'questionnaire') return <Poll key={`${post.id}-${block.id}`} block={block} postId={post.id} interactive={interactive} readOnly={readOnly} />;
      if (block.type !== 'video') return null;
      const video = videos.find(video => video.id === block.videoId) ?? block.video;
      return <section key={block.id} className="postVideoBlock">{block.text && <p>{block.text}</p>}<PostVideoPreview video={video} videoId={block.videoId} linked /></section>;
    })}</div>
  </article>;
}
