import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { Post } from './model';
import PostDialog from './PostDialog';
import PostCard from './PostCard';
import { ArrowSVG } from '~/constants';
import { formatDate, getToken } from '~/functions';
import { useI18n } from '~/i18n';
import { getVideoThumbnail } from '~/components/shared/videoMedia';
import type { VideoT } from '~/types';
import { getRecommendedPosts } from './api';
import { recommendedPostAuthors } from './recommendations';
import DefaultProfile from '../../../assets/DefaultProfile.webp';
import './posts.css';

export default function LatestPosts({ videos }: { videos: VideoT[] }) {
  const { t } = useI18n();
  const authors = recommendedPostAuthors(videos);
  const userIds = authors.map(author => author.uploader_id);
  const token = getToken();
  const [selection, setSelection] = useState<{ id?: string; token: typeof token }>();
  const query = useQuery({
    queryKey: ['posts', 'recommended', token, userIds, 10],
    queryFn: ({ signal }) => getRecommendedPosts(userIds, signal),
    enabled: userIds.length > 0,
    staleTime: 60_000,
    retry: false,
  });
  // An empty or unavailable feed should not leave an empty homepage section.
  if (!query.data?.posts.length) return null;

  const posts = query.data.posts.slice(0, 10);
  const popupOpen = !!selection && selection.token === token;

  return <section className="contentSection latestPostsSection mt-8 max-[450px]:mt-3">
    <div className="collection-header">
      <span className="latestPostsHeading">
        <h2 className="subTitle p-0!">{t('latestPosts')}</h2>
        <button type="button" className="button latestPostsViewAll flex items-center gap-2 z-1" aria-haspopup="dialog" onClick={() => setSelection({ token })}>
          <span className="font-semibold">{t('viewAll')}</span>{ArrowSVG}
        </button>
      </span>
    </div>
    <div className="latestPostsGrid">{posts.slice(0, 3).map(post => {
      const author = authors.find(item => item.uploader_id === post.userId);
      const textBlock = post.blocks.find(block => block.text);
      const text = textBlock?.text;
      const feature = post.blocks.find(block => block.type !== 'text');
      const contentType = feature?.type || post.blocks[0]?.type;
      const video = feature?.type === 'video'
        ? (feature.video !== undefined ? feature.video : videos.find(item => item.id === feature.videoId))
        : undefined;
      const image = feature?.type === 'image' ? feature.image : video ? getVideoThumbnail(video) : undefined;
      return <article key={post.id} className="latestPostCard">
        <button type="button" className="latestPostTrigger" aria-haspopup="dialog" aria-label={`${t('postOpen')}: ${text || post.author?.full_name || author?.uploader_name || t('channelLabel')}`} onClick={() => setSelection({ id: post.id, token })} />
        <div className="latestPostAuthor">
          <img className="latestPostAvatar" src={post.author?.image_url || DefaultProfile} alt="" loading="lazy" onError={event => { event.currentTarget.onerror = null; event.currentTarget.src = DefaultProfile; }} />
          <div><strong>{post.author?.full_name || author?.uploader_name || t('channelLabel')}</strong><time dateTime={post.createdAt}>{formatDate(post.createdAt)}</time></div>
          {contentType && <span className="latestPostType">{t(`postType_${contentType}`)}</span>}
        </div>
        <div className={`latestPostBody${image ? ' latestPostBodyWithImage' : ''}`}>
          <div className="latestPostCopy">
            {text && <div className={textBlock?.type === 'text' ? 'latestPostTextInset' : undefined}><p className="latestPostText">{text}</p></div>}
            {feature?.text && feature.text !== text && <p className="latestPostText">{feature.text}</p>}
          </div>
          {image && <img className="latestPostImage" src={image} alt="" loading="lazy" />}
          {feature && 'options' in feature && <div className="latestPostOptions" aria-hidden="true">
            {feature.options.slice(0, 2).map(option => <div key={option.id}><span className="latestPostOptionDot" /><span>{option.text}</span></div>)}
            {feature.options.length > 2 && <small>+{feature.options.length - 2}</small>}
          </div>}
        </div>
        <span className="latestPostOpen">{t('postOpen')}{ArrowSVG}</span>
      </article>;
    })}</div>
    {popupOpen && <PostDialog title={t('latestPosts')} className="latestPostsDialog" onClose={() => setSelection(undefined)}>
      <LatestPostsFeed posts={posts} videos={videos} initialPostId={selection.id} />
    </PostDialog>}
  </section>;
}

function LatestPostsFeed({ posts, videos, initialPostId }: { posts: Post[]; videos: VideoT[]; initialPostId?: string }) {
  const feedRef = useRef<HTMLDivElement>(null);
  const initialPostRef = useRef<HTMLDivElement>(null);
  const authors = recommendedPostAuthors(videos);
  useEffect(() => {
    // Wait until the parent dialog is open before measuring the selected post.
    const frame = requestAnimationFrame(() => {
      if (feedRef.current) feedRef.current.scrollTop = initialPostRef.current?.offsetTop ?? 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [initialPostId]);
  return <div ref={feedRef} className="latestPostsDialogFeed customSelectMenuScroll">
    {posts.map(post => <div key={post.id} ref={post.id === initialPostId ? initialPostRef : undefined} data-post-id={post.id}>
      <PostCard post={post} author={{ ...post.author, full_name: post.author?.full_name || authors.find(author => author.uploader_id === post.userId)?.uploader_name }} videos={videos} interactive linkAuthor />
    </div>)}
  </div>;
}
