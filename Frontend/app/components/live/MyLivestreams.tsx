import { Link } from 'react-router';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { AddSVG, DeleteSVG, EditSVG, FilterSVG, PermissionEyeSVG, SearchSVG } from '~/constants';
import { useI18n } from '~/i18n';
import { useLocalizedPageTitle } from '~/hooks/useLocalizedPageTitle';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import Sidebar from '../myVideosPage/sidebar/sidebar';
import Pagination from '../library/pagination';
import CustomSelect from '../customSelect/customSelect';
import { liveRequest, type LiveStream } from './api';
import { ConfirmDialog } from '../confirmPopup/confirmDialog';
import { useConfirm } from '../confirmPopup/useConfirm';
import { useLivestreams } from './LiveList';
import LiveStatus from './LiveStatus';
import './myLivestreams.css';

export default function MyLivestreams() {
  useLocalizedPageTitle('liveMyStreams');
  const { t, locale } = useI18n();
  const { can, canOwn } = useAuthorization();
  const { sort, setSort, page, setPage, limit, setLimit, search, setSearch, query } = useLivestreams();
  const client = useQueryClient();
  const { confirm, dialogProps } = useConfirm();
  const pending = useRef(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [deleteError, setDeleteError] = useState('');
  const deleteStream = async (video: LiveStream) => {
    if (pending.current || !canOwn(P.liveDeleteOwn, P.liveDeleteAny, video.user_id)) return;
    pending.current = true;
    try {
      if (!await confirm({ title: `${t('liveDelete')}: ${video.title}`, message: t('liveDeleteWithRecordings'), yesText: t('adminDelete'), noText: t('adminCancel') })) return;
      setDeletingId(video.id); setDeleteError('');
      await liveRequest(`live-streams/${video.id}`, 'DELETE');
      if (query.data?.live_streams.length === 1 && page > 1) setPage(page - 1);
      await Promise.all(['livestreams', 'live-cards', 'live-details', 'live-playback', 'my-videos', 'video'].map(key => client.invalidateQueries({ queryKey: [key] })));
    } catch (error) { setDeleteError(error instanceof Error ? error.message : t('liveOperationFailed')); }
    finally { pending.current = false; setDeletingId(undefined); }
  };
  const date = (value?: string | null) => value ? new Date(value).toLocaleString(locale === 'sr' ? 'sr-Latn' : locale, { dateStyle: 'medium', timeStyle: 'short' }) : '—';

  return <main className="myVideos managementPage myLivestreams">
    <Sidebar />
    <ConfirmDialog {...dialogProps} />
    <div className="content libraryContent"><div className="holder libraryShell">
      <div className="libraryHeader"><div className="libraryHeading">
        <h1>{t('liveMyStreams')}</h1><p>{t('liveManageIntro')}</p>
      </div></div>
      <div className="managementToolbar">
        <div className="filter">
          {SearchSVG}
          <input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }}
            aria-label={t('liveSearch')} placeholder={t('liveSearch')} />
        </div>
        <div className="livestreamToolbarActions">
          <CustomSelect rootClassName="livestreamSortSelect" leadingContent={FilterSVG} value={sort} onChange={value => { setSort(value); setPage(1); }} ariaLabel={t('searchSortBy')} options={[
            { value: 'created_at:desc', label: t('channelSortNewest') }, { value: 'created_at:asc', label: t('channelSortOldest') },
            { value: 'scheduled_at:asc', label: t('liveSchedule') }, { value: 'title:asc', label: t('liveEventTitle') }, { value: 'status:asc', label: t('liveFilter') },
          ]}/>
          {can(P.liveCreate) && <Link to="/live/new" className="playlistAddBtn" title={t('liveCreate')} aria-label={t('liveCreate')}>{AddSVG}</Link>}
        </div>
      </div>
      {deleteError && <div className="errorBanner" role="alert">{deleteError}</div>}
      <div className="libraryTableWrap" aria-busy={query.isFetching}>
        <table>
          <thead><tr>
            <th className="notHoverable" scope="col">{t('liveBroadcast')}</th>
            <th className="notHoverable" scope="col">{t('liveFilter')}</th>
            <th className="notHoverable" scope="col">{t('liveSchedule')}</th>
            <th className="notHoverable" scope="col">{t('liveVisibility')}</th>
          </tr></thead>
          <tbody>
            {query.isPending ? <tr><td colSpan={4} className="livestreamTableMessage" role="status">{t('videoLoadingData')}</td></tr>
              : query.isError ? <tr><td colSpan={4} className="livestreamTableMessage" role="alert">{query.error.message}<button type="button" onClick={() => void query.refetch()}>{t('usersRetry')}</button></td></tr>
              : !query.data?.live_streams.length ? <tr><td colSpan={4} className="livestreamTableMessage">{t('liveEmpty')}</td></tr>
              : query.data.live_streams.map(video => <tr key={video.id}>
                <td><span className="videoInfo">
                  <Link to={`/live/${video.id}/studio`} className="livestreamRowThumbnail" aria-label={`${t('liveManage')}: ${video.title}`}><img src={video.thumbnail_url || DefaultThumbnail} alt="" loading="lazy" decoding="async" onError={event => { if (event.currentTarget.getAttribute('src') !== DefaultThumbnail) event.currentTarget.src = DefaultThumbnail; }} /></Link>
                  <span className="livestreamRowInfo">
                    <Link to={`/live/${video.id}/studio`}><h3>{video.title}</h3></Link>
                    <h5>{t(video.dvr_enabled ? 'liveDvr' : 'liveStandard')}</h5>
                    <span className="livestreamMobileMeta"><LiveStatus live={video}/><time dateTime={video.scheduled_at || undefined}>{date(video.scheduled_at)}</time></span>
                    <span className="videoActions">
                      <Link to={`/live/${video.id}`} title={t('liveWatch')} aria-label={t('liveWatch')}>{PermissionEyeSVG}</Link>
                      <Link to={`/live/${video.id}/studio`} title={t('liveManage')} aria-label={t('liveManage')}>{EditSVG}</Link>
                      {canOwn(P.liveDeleteOwn, P.liveDeleteAny, video.user_id) && <button type="button" onClick={() => void deleteStream(video)} disabled={!!deletingId || dialogProps.open} aria-label={t('liveDelete')} title={t('liveDelete')}>{DeleteSVG}</button>}
                    </span>
                  </span>
                </span></td>
                <td><LiveStatus live={video}/></td>
                <td><time dateTime={video.scheduled_at || undefined}>{date(video.scheduled_at)}</time></td>
                <td>{t(video.visibility === 'private' ? 'livePrivate' : video.visibility === 'unlisted' ? 'liveUnlisted' : 'livePublic')}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
      <Pagination page={page} limit={limit} total={query.data?.total} loading={query.isFetching} disabled={query.isError} pageSizes={[10, 20, 30, 40, 50]} label={t('liveMyStreams')} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
    </div></div>
  </main>;
}
