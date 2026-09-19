import { useEffect, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuthorization } from '~/authorization/authorization';
import { fetchFn } from '~/API';
import { getToken, formatDate } from '~/functions';
import { useI18n } from '~/i18n';
import { AddSVG, DeleteSVG, EditSVG, PermissionEyeSVG, PostSVG, PublicSVG, PrivateSVG, SearchSVG } from '~/constants';
import type { ChannelVideosT } from '~/types';
import Sidebar from '../myVideosPage/sidebar/sidebar';
import Pagination from '../library/pagination';
import StatusPicker from '../library/statusPicker';
import LibrarySortButton from '../library/librarySortButton';
import { ConfirmDialog } from '../confirmPopup/confirmDialog';
import { useConfirm } from '../confirmPopup/useConfirm';
import PostEditor from './PostEditor';
import PostDialog from './PostDialog';
import PostCard from './PostCard';
import { newBlock, newId, type Post } from './model';
import { usePosts } from './usePosts';
import { getPost, postRequest } from './api';
import './posts.css';

export default function MyPostsPage() {
  const { t } = useI18n();
  const { user, can } = useAuthorization();
  const canEdit = can('posts.update_own') || can('posts.update_any');
  const canDelete = can('posts.delete_own') || can('posts.delete_any');
  const channelId = user?.id || '';
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [ascending, setAscending] = useState(false);
  const [editing, setEditing] = useState<Post>();
  const [preview, setPreview] = useState<Post>();
  const [saveError, setSaveError] = useState('');
  const [busy, setBusy] = useState<string>();
  const [querySearch, setQuerySearch] = useState('');
  const selectAllRef = useRef<HTMLInputElement>(null);
  const bulkInFlight = useRef(false);
  const selectionScope = JSON.stringify([channelId, getToken(), page, limit, ascending, search]);
  const [selection, setSelection] = useState<{ scope: string; ids: string[] }>({ scope: selectionScope, ids: [] });
  useEffect(() => { const timer = setTimeout(() => { setQuerySearch(search.trim().slice(0, 255)); setPage(1); }, 300); return () => clearTimeout(timer); }, [search]);
  const { posts, pagination, refresh, loading, error } = usePosts(channelId, page, limit, ascending, querySearch);
  useEffect(() => { if (pagination && page > Math.max(1, pagination.totalPages)) setPage(Math.max(1, pagination.totalPages)); }, [pagination, page]);
  useEffect(() => { setSelection(current => current.scope === selectionScope ? current : { scope: selectionScope, ids: [] }); }, [selectionScope]);
  const selectedPosts = selection.scope === selectionScope ? posts.filter(post => selection.ids.includes(post.id)) : [];
  const allSelected = posts.length > 0 && selectedPosts.length === posts.length;
  const canSelect = canEdit || canDelete;
  const selectionDisabled = !!busy || loading || !!error || search.trim().slice(0, 255) !== querySearch;
  const checkboxClass = "appearance-none rounded-lg! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-(--text1) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2 postSelectionCheckbox";
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selectedPosts.length > 0 && !allSelected;
  }, [selectedPosts.length, allSelected]);
  const toggleSelection = (id: string, checked: boolean) => setSelection(current => {
    const ids = current.scope === selectionScope ? current.ids : [];
    return { scope: selectionScope, ids: checked ? [...new Set([...ids, id])] : ids.filter(item => item !== id) };
  });
  const openPost = async (id: string, edit: boolean) => {
    setBusy(id); setSaveError('');
    try { const post = await getPost(id); if (edit) setEditing(post); else setPreview(post); }
    catch (error) { setSaveError(error instanceof Error ? error.message : t('postLoadError')); }
    finally { setBusy(undefined); }
  };
  const { confirm, dialogProps } = useConfirm();
  const runBulkAction = async (action: 'delete' | Post['status']) => {
    if (bulkInFlight.current || selectionDisabled || !selectedPosts.length || (action === 'delete' ? !canDelete : !canEdit)) return;
    const targets = selectedPosts;
    bulkInFlight.current = true;
    setBusy('bulk');
    setSaveError('');
    try {
      if (action === 'delete' && !await confirm({
        title: t('postBulkDeleteTitle', { count: targets.length }),
        message: t('postBulkDeleteMessage'), yesText: t('adminDelete'), noText: t('adminCancel'),
      })) return;
      const failedIds: string[] = [];
      // Bound concurrent writes, and retain only failures for a safe retry.
      for (let index = 0; index < targets.length; index += 4) {
        const batch = targets.slice(index, index + 4);
        const results = await Promise.allSettled(batch.map(post =>
          action !== 'delete' && post.status === action ? Promise.resolve() :
          postRequest(`/${post.id}`, action === 'delete' ? 'DELETE' : 'PATCH', action === 'delete' ? undefined : { status: action })
        ));
        results.forEach((result, index) => { if (result.status === 'rejected') failedIds.push(batch[index].id); });
      }
      setSelection({ scope: selectionScope, ids: failedIds });
      if (failedIds.length) setSaveError(t('postBulkFailed', { count: failedIds.length, total: targets.length }));
      await refresh();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : t('postSaveError'));
    } finally { bulkInFlight.current = false; setBusy(undefined); }
  };
  const videosQuery = useInfiniteQuery({
    queryKey: ['post-video-picker', channelId], initialPageParam: 1, enabled: !!channelId,
    queryFn: ({ pageParam, signal }) => fetchFn<ChannelVideosT>({ route: `api/channels/${channelId}/videos?page=${pageParam}&limit=20&sortBy=created_at&sortOrder=desc`, options: { headers: { Authorization: `Bearer ${getToken()}` }, signal } }),
    getNextPageParam: data => data.pagination?.hasNextPage ? data.pagination.page + 1 : undefined,
  });
  const videos = videosQuery.data?.pages.flatMap(page => page.videos) ?? [];
  return <main className="myVideos managementPage myPostsPage">
    <Sidebar /><ConfirmDialog {...dialogProps} />
    {editing && <PostEditor key={editing.id} post={editing} author={user || {}} videos={videos} onClose={() => { setEditing(undefined); void refresh(); }}
      moreVideos={videosQuery.hasNextPage ? <button type="button" className="postSecondary" disabled={videosQuery.isFetchingNextPage} onClick={() => void videosQuery.fetchNextPage()}>{t('postMoreVideos')}</button> : undefined}
      onSave={async () => { await refresh(); }} />}
    {preview && <PostDialog title={t('postPreview')} onClose={() => setPreview(undefined)}><PostCard post={preview} author={user || {}} videos={videos} readOnly /></PostDialog>}
    <div className="content libraryContent"><div className="holder libraryShell">
      <div className="libraryHeader"><div className="libraryHeading"><h1>{t('navMyPosts')}</h1><p>{t('postManageDescription')}</p></div></div>
      <div className="managementToolbar"><div className="filter">{SearchSVG}<input type="search" disabled={!!busy} aria-label={t('postSearch')} placeholder={t('postSearch')} value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div>
        <button type="button" className="playlistAddBtn" aria-label={t('postCreate')} title={t('postCreate')} disabled={!!busy || !channelId || !can('posts.create') || !canEdit} onClick={() => setEditing({ id: newId(), title: '', createdAt: new Date().toISOString(), status: 'private', blocks: [newBlock('text')] })}>{AddSVG}</button></div>
      {(error || saveError) && <p role="alert" className="postError">{saveError || t('postLoadError')}{error && <button type="button" className="postSecondary" onClick={() => void refresh()}>{t('postRetry')}</button>}</p>}
      {loading && <p role="status">{t('postLoading')}</p>}
      <div className="libraryTableWrap" aria-busy={loading || busy === 'bulk'}><table className="postsTable"><thead><tr>
        <th className="notHoverable"><span className="postSelectionHeading">{canSelect && <input ref={selectAllRef} type="checkbox" className={checkboxClass} aria-label={t('postSelectPage')} checked={allSelected} disabled={selectionDisabled || !posts.length} onChange={event => setSelection({ scope: selectionScope, ids: event.target.checked ? posts.map(post => post.id) : [] })} />}<p className="py-3">{t('postLabel')}</p>
          {selectedPosts.length > 0 && <span id="selectedButtons" role="group" aria-label={t('postBulkActions')} aria-busy={busy === 'bulk'}>
            {busy === 'bulk' && <span className="uploadSpinner tiny" aria-hidden="true" />}
            {canDelete && <button type="button" className="button bg-(--accentRed) text-(--text1)" disabled={selectionDisabled} onClick={() => void runBulkAction('delete')}>{t('adminDeleteAll')}</button>}
            {canEdit && selectedPosts.some(post => post.status !== 'private') && <button type="button" className="button bg-(--background2) text-(--text1)!" disabled={selectionDisabled} onClick={() => void runBulkAction('private')}>{t('postMakeDraft')}</button>}
            {canEdit && selectedPosts.some(post => post.status !== 'public') && <button type="button" className="button bg-(--background2) text-(--text1)!" disabled={selectionDisabled} onClick={() => void runBulkAction('public')}>{t('adminMakePublic')}</button>}
          </span>}
        </span></th><th>{t('adminTableStatus')}</th><th aria-sort={ascending ? 'ascending' : 'descending'}><LibrarySortButton label={t('adminTableDate')} direction={ascending ? 'asc' : 'desc'} onClick={() => { if (!busy) { setAscending(!ascending); setPage(1); } }} /></th><th>{t('postParts')}</th><th>{t('adminTableActions')}</th>
      </tr></thead><tbody>{posts.map(post => <tr key={post.id}>
        <td><div className="postManagementSummary">{canSelect && <input type="checkbox" className={checkboxClass} aria-label={t('postSelectOne', { title: post.title })} checked={selectedPosts.some(selected => selected.id === post.id)} disabled={selectionDisabled} onChange={event => toggleSelection(post.id, event.target.checked)} />}<span className="postManagementIcon">{PostSVG}</span><div><strong>{post.title}</strong><p>{post.text}</p></div></div></td>
        <td><StatusPicker<Post['status']>
          value={post.status}
          title={post.title}
          className={`postStatus ${post.status}`}
          disabled={!canEdit || !!busy}
          options={[
            { value: 'public', label: t('postStatus_public'), icon: PublicSVG },
            { value: 'private', label: t('postStatus_private'), icon: PrivateSVG },
          ]}
          onSave={async status => { await postRequest(`/${post.id}`, 'PATCH', { status }); await refresh(); }}
        /></td><td>{formatDate(post.createdAt)}</td><td><div className="postTypeTags">{post.blockTypes.map(type => <span key={type}>{t(`postType_${type}`)}</span>)}</div></td>
        <td><div className="managementRowActions">
          <button type="button" title={t('postPreview')} aria-label={`${t('postPreview')}: ${post.title}`} disabled={!!busy} onClick={() => void openPost(post.id, false)}>{PermissionEyeSVG}</button>
          <button type="button" title={t('adminEdit')} aria-label={`${t('adminEdit')}: ${post.title}`} disabled={!!busy || !canEdit} onClick={() => void openPost(post.id, true)}>{EditSVG}</button>
          <button type="button" disabled={!!busy || !canDelete} className="danger" title={t('adminDelete')} aria-label={`${t('adminDelete')}: ${post.title}`} onClick={async () => {
            if (!await confirm({ title: t('postDeleteTitle'), message: post.title, yesText: t('adminDelete'), noText: t('adminCancel') })) return;
            setBusy(post.id);
            try { await postRequest(`/${post.id}`, 'DELETE'); await refresh(); setSaveError(''); } catch (error) { setSaveError(error instanceof Error ? error.message : t('postSaveError')); } finally { setBusy(undefined); }
          }}>{DeleteSVG}</button>
        </div></td>
      </tr>)}{!loading && !error && !posts.length && <tr><td colSpan={5}>{t('noResultsTitle')}</td></tr>}</tbody></table></div>
      <Pagination page={page} limit={limit} total={pagination?.total ?? 0} totalPages={pagination?.totalPages ?? 0} loading={loading} disabled={!!error || !!busy} label={t('navMyPosts')} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
    </div></div>
  </main>;
}
