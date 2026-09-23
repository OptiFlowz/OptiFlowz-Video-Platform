import CommentsLoading from '../playPage/commentCollection/commentsLoading';
import { lazy, Suspense, useState } from 'react';
import { useIsMutating, useMutation, useQueryClient } from '@tanstack/react-query';
import { CommentSVG, ThumbIcon } from '~/constants';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { redirectToLogin } from '~/auth/session';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import { getPost, reactToPost } from './api';
import { withPostReaction, type Post, type PostReaction } from './model';
import { postFeedFilter, updatePostReaction } from './reactionCache';

const CommentsSection = lazy(() => import('../playPage/commentCollection/commentsSection'));

type CommentControls = { commentsOpen: boolean; commentsId: string; onToggleComments: () => void };

export default function PostEngagement({ post, commentsOpen, commentsId, onToggleComments }: { post: Post } & CommentControls) {
  const { t } = useI18n();
  const { user, can, loading } = useAuthorization();
  const client = useQueryClient();
  const token = getToken();
  const [updated, setUpdated] = useState<{ source: Post; token: typeof token; value: PostReaction }>();
  const current = updated?.source === post && updated.token === token ? updated.value : post;
  const key = ['post-reaction', post.id, token];
  const pending = useIsMutating({ mutationKey: key }) > 0;
  const apply = (value: PostReaction) => {
    if (getToken() !== token) return;
    setUpdated({ source: post, token, value });
    updatePostReaction(client, post.id, token, value);
  };
  const mutation = useMutation({
    mutationKey: key,
    retry: false, // These endpoints toggle: replaying a request can undo the action.
    onMutate: async ({ reaction, previous }) => {
      await client.cancelQueries(postFeedFilter(token));
      apply(withPostReaction(previous, previous.userReaction === (reaction === 'like' ? 1 : -1) ? 0 : reaction === 'like' ? 1 : -1));
    },
    mutationFn: async ({ reaction, previous }: { reaction: 'like' | 'dislike'; previous: PostReaction }) => {
      if (getToken() !== token) throw new Error('Session changed');
      const status = await reactToPost(post.id, reaction);
      return withPostReaction(previous, status);
    },
    onSuccess: apply,
    onError: async (_error, { previous }) => {
      // A lost response may still have changed the server. Read back, never retry the toggle.
      if (getToken() !== token) return;
      apply(previous);
      try {
        const fresh = await getPost(post.id);
        apply({ likeCount: fresh.likeCount, dislikeCount: fresh.dislikeCount, userReaction: fresh.userReaction });
      } catch { /* Keep the last known counts and show the failed action. */ }
    },
  });
  const react = (reaction: 'like' | 'dislike') => {
    if (loading || client.isMutating({ mutationKey: key })) return;
    if (!user || !token) { redirectToLogin(`${window.location.pathname}${window.location.search}${window.location.hash}`); return; }
    if (!can(P.postsReact)) return;
    mutation.mutate({ reaction, previous: {
      likeCount: current.likeCount, dislikeCount: current.dislikeCount, userReaction: current.userReaction,
    } });
  };
  return <div className="postEngagement">
    <div className="postActions" aria-busy={pending}>
      <div className="postReactions">{(['like', 'dislike'] as const).map(reaction => {
        const selected = current.userReaction === (reaction === 'like' ? 1 : -1);
        return <button type="button" key={reaction} aria-label={t(reaction === 'like' ? 'postLike' : 'postDislike')}
          aria-pressed={selected} disabled={pending || loading || (!!user && !can(P.postsReact))}
          onClick={() => react(reaction)}>
          <ThumbIcon filled={selected} rotated={reaction === 'dislike'} />
          {reaction === 'like' && <span>{current.likeCount ?? 0}</span>}
        </button>;
      })}</div>
      <button type="button" aria-expanded={commentsOpen} aria-controls={commentsId} onClick={onToggleComments}>
        {CommentSVG}<span>{t('comments')}</span>
      </button>
    </div>
    {mutation.isError && <p role="alert" className="postError">{t('postReactionError')}</p>}
  </div>;
}

export function PostComments({ postId, open, id }: { postId: string; open: boolean; id: string }) {
  const { t } = useI18n();
  const { user } = useAuthorization();
  return <div id={id} hidden={!open} className="postComments" role="region" aria-label={t('comments')}>
      {open && <>
        {!user && <button type="button" className="postSecondary" onClick={() => redirectToLogin(`${window.location.pathname}${window.location.search}${window.location.hash}`)}>{t('postSignInComment')}</button>}
        <Suspense fallback={<CommentsLoading />}><CommentsSection postId={postId} /></Suspense>
      </>}
    </div>;
}
