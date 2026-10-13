import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { AddSVG, DeleteSVG, EditSVG, PermissionEyeSVG, SearchSVG } from '~/constants';
import { formatDate, getToken } from '~/functions';
import { useI18n } from '~/i18n';
import Sidebar from '~/components/myVideosPage/sidebar/sidebar';
import Pagination from '~/components/library/pagination';
import LibrarySortButton from '~/components/library/librarySortButton';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import { deleteCollection, getCollections, updateCollectionVisibility } from './api';
import type { Collection, CollectionSort } from './model';
import CollectionState from './CollectionState';
import CollectionVisibility from './CollectionVisibility';
import '~/components/library/mediaManagement.css';
import './collections.css';

const checkboxClass = "appearance-none rounded-lg! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative checked:after:content-['✓'] checked:after:absolute checked:after:text-(--text1) checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2";
const EMPTY_COLLECTIONS: Collection[] = [];

export default function MyCollectionsPage() {
  const { t } = useI18n(); const { user, can, canOwn } = useAuthorization(); const client = useQueryClient();
  const [filter, setFilter] = useState(''), [search, setSearch] = useState('');
  const [page, setPage] = useState(1), [limit, setLimit] = useState(20);
  const [sortBy, setSortBy] = useState<CollectionSort>('created_at'), [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [busy, setBusy] = useState(false), [error, setError] = useState(false); const pending = useRef(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const { confirm, dialogProps } = useConfirm();
  useEffect(() => { const timer = setTimeout(() => { setSearch(filter.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [filter]);
  const query = useQuery({ queryKey: ['collections', 'mine', getToken(), user?.id, page, limit, search, sortBy, sortOrder],
    queryFn: ({ signal }) => getCollections({ userId: user!.id, page, limit, title: search, sortBy, sortOrder }, signal),
    enabled: !!user?.id, retry: false });
  const items = query.data?.collections ?? EMPTY_COLLECTIONS;
  const canEdit = (item: Collection) => canOwn(P.collectionsUpdateOwn, P.collectionsUpdateAny, item.created_by);
  const canDelete = (item: Collection) => canOwn(P.collectionsDeleteOwn, P.collectionsDeleteAny, item.created_by);
  const selectable = items.filter(item => canEdit(item) || canDelete(item));
  const selected = selectable.filter(item => selectedIds.includes(item.id));
  const allSelected = selectable.length > 0 && selected.length === selectable.length;
  useEffect(() => { setSelectedIds([]); }, [page, limit, search, sortBy, sortOrder, user?.id]);
  useEffect(() => {
    setSelectedIds(previous => {
      const next = previous.filter(id => items.some(item => item.id === id));
      return next.length === previous.length ? previous : next;
    });
  }, [items]);
  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = selected.length > 0 && !allSelected;
  }, [selected.length, allSelected]);
  async function bulkAction(action: 'delete' | Collection['visibility']) {
    if (pending.current || !selected.length || !selected.every(action === 'delete' ? canDelete : canEdit)) return;
    const targets = selected.filter(item => action === 'delete' || item.visibility !== action);
    if (!targets.length) return;
    pending.current = true; setBusy(true); setError(false);
    try {
      if (!await confirm({
        title: t(action === 'delete' ? 'collectionBulkDeleteTitle' : 'collectionBulkVisibilityTitle', { count: targets.length }),
        message: t(action === 'delete' ? 'collectionDeleteHelp' : action === 'public' ? 'collectionBulkPublicHelp' : 'collectionBulkPrivateHelp'),
        yesText: t(action === 'delete' ? 'adminDelete' : 'adminChangeVisibility'), noText: t('adminCancel'),
      })) return;
      const results = await Promise.allSettled(targets.map(item => action === 'delete' ? deleteCollection(item.id) : updateCollectionVisibility(item.id, action)));
      const failed = targets.filter((_, index) => results[index].status === 'rejected').map(item => item.id);
      setSelectedIds(failed); setError(failed.length > 0);
      await client.invalidateQueries({ queryKey: ['collections'] });
    } catch { setError(true); } finally { pending.current = false; setBusy(false); }
  }
  const totalPages = query.data?.pagination.totalPages ?? 1;
  useEffect(() => { if (query.data && !query.isFetching && page > Math.max(1, totalPages)) setPage(Math.max(1, totalPages)); }, [query.data, query.isFetching, page, totalPages]);
  function sort(column: CollectionSort) { setSortBy(column); setSortOrder(sortBy === column && sortOrder === 'desc' ? 'asc' : 'desc'); setPage(1); }
  async function remove(item: Collection) {
    if (pending.current || !canOwn(P.collectionsDeleteOwn, P.collectionsDeleteAny, item.created_by)) return;
    pending.current = true;
    try {
      if (!await confirm({ title: t('collectionDeleteTitle', { title: item.title }), message: t('collectionDeleteHelp'), yesText: t('adminDelete'), noText: t('adminCancel') })) return;
      setBusy(true); setError(false); await deleteCollection(item.id);
      await client.invalidateQueries({ queryKey: ['collections'] });
    } catch { setError(true); } finally { pending.current = false; setBusy(false); }
  }
  return <main className="myVideos managementPage mediaManagementPage collectionsManagement">
    <Sidebar /><ConfirmDialog {...dialogProps} />
    <div className="content libraryContent"><div className="holder libraryShell">
      <div className="libraryHeader"><div className="libraryHeading"><h1>{t('navMyCollections')}</h1><p>{t('collectionsDescription')}</p></div></div>
      <div className="managementToolbar"><div className="filter">{SearchSVG}<input type="search" value={filter} onChange={e => setFilter(e.target.value)} aria-label={t('collectionSearch')} placeholder={t('collectionSearch')} /></div>
        {can(P.collectionsCreate) && <Link to="/edit-collection" className="playlistAddBtn" aria-label={t('collectionCreate')} title={t('collectionCreate')}>{AddSVG}</Link>}
      </div>
      {error && <p className="errorBanner" role="alert">{t('collectionSaveFailed')}</p>}
      {query.isError ? <CollectionState error={query.error} retry={() => void query.refetch()} /> : <div className="libraryTableWrap" aria-busy={query.isFetching || busy}><table>
        <thead><tr>
          <th className={`sortable ${sortBy === 'title' ? 'active' : ''}`} aria-sort={sortBy === 'title' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}><span>
            <input ref={selectAllRef} type="checkbox" className={checkboxClass} aria-label={t('collectionSelectAll')} checked={allSelected} disabled={busy || query.isFetching || !selectable.length} onChange={event => setSelectedIds(event.target.checked ? selectable.map(item => item.id) : [])} />
            <LibrarySortButton label={t('collectionLabel')} direction={sortBy === 'title' ? sortOrder : null} onClick={() => sort('title')} />
            {selected.length > 0 && <span id="selectedButtons">
              {selected.every(canDelete) && <button type="button" disabled={busy} className="button bg-(--accentRed) text-(--text1)" onClick={() => void bulkAction('delete')}>{t('adminDeleteAll')}</button>}
              {selected.every(canEdit) && selected.some(item => item.visibility !== 'private') && <button type="button" disabled={busy} className="button bg-(--background2) text-(--text1)!" onClick={() => void bulkAction('private')}>{t('adminMakePrivate')}</button>}
              {selected.every(canEdit) && selected.some(item => item.visibility !== 'public') && <button type="button" disabled={busy} className="button bg-(--background2) text-(--text1)!" onClick={() => void bulkAction('public')}>{t('adminMakePublic')}</button>}
            </span>}
          </span></th>
          <th className="notHoverable">{t('adminTableVisibility')}</th>
          <th className={`sortable ${sortBy === 'created_at' ? 'active' : ''}`} aria-sort={sortBy === 'created_at' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}><LibrarySortButton label={t('adminTableDate')} direction={sortBy === 'created_at' ? sortOrder : null} onClick={() => sort('created_at')} /></th>
          <th className={`sortable ${sortBy === 'updated_at' ? 'active' : ''}`} aria-sort={sortBy === 'updated_at' ? (sortOrder === 'asc' ? 'ascending' : 'descending') : 'none'}><LibrarySortButton label={t('collectionUpdated')} direction={sortBy === 'updated_at' ? sortOrder : null} onClick={() => sort('updated_at')} /></th>
        </tr></thead>
        <tbody>{query.data?.collections.map(item => <tr key={item.id}><td><span>
          <input type="checkbox" className={checkboxClass} aria-label={t('collectionSelect', { title: item.title })} checked={selected.some(entry => entry.id === item.id)} disabled={busy || query.isFetching || (!canEdit(item) && !canDelete(item))}
            onChange={event => setSelectedIds(previous => event.target.checked ? [...new Set([...previous, item.id])] : previous.filter(id => id !== item.id))} />
          <span className="videoInfo">
          <Link to={`/collection/${item.id}`}><img src={item.thumbnail_url || DefaultThumbnail} alt="" loading="lazy" /></Link>
          <span className="flex flex-col gap-0.5 rounded-none! collectionRowText"><h3><Link to={`/collection/${item.id}`}>{item.title}</Link></h3><h5 className="line-clamp-1 font-light!">{item.subheading || item.description || t('adminNoDescription')}</h5>
            <div className="videoActions collectionRowActions">
              <Link to={`/collection/${item.id}`} aria-label={`${t('collectionView')}: ${item.title}`} title={t('collectionView')}>{PermissionEyeSVG}</Link>
              {canOwn(P.collectionsUpdateOwn, P.collectionsUpdateAny, item.created_by) && <Link to={`/edit-collection?collection=${item.id}`} aria-label={`${t('collectionEdit')}: ${item.title}`} title={t('collectionEdit')}>{EditSVG}</Link>}
              {canOwn(P.collectionsDeleteOwn, P.collectionsDeleteAny, item.created_by) && <button type="button" disabled={busy} onClick={() => void remove(item)} aria-label={`${t('adminDelete')}: ${item.title}`} title={t('adminDelete')}>{DeleteSVG}</button>}
            </div>
            <div className="collectionMobileStatus"><CollectionVisibility collection={item} disabled={busy} /></div>
          </span></span></span></td><td><div><CollectionVisibility collection={item} disabled={busy} /></div></td><td><p>{formatDate(item.created_at)}</p></td><td><p>{formatDate(item.updated_at)}</p></td></tr>)}
          {query.isPending && <tr><td colSpan={4}><CollectionState /></td></tr>}
          {query.data && !query.data.collections.length && <tr><td colSpan={4}><p className="collectionState">{t(search ? 'noResultsTitle' : 'collectionsEmpty')}</p></td></tr>}
        </tbody>
      </table></div>}
      <Pagination page={page} limit={limit} total={query.data?.pagination.total} totalPages={totalPages} loading={query.isFetching} disabled={query.isError || !user || busy} label={t('navMyCollections')} onPageChange={setPage} onLimitChange={n => { setLimit(n); setPage(1); }} />
    </div></div>
  </main>;
}
