import { Link } from 'react-router';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { AddSVG, AnalyticsSVG, DeleteSVG, EditSVG, PermissionEyeSVG, SearchSVG } from '~/constants';
import { formatViews } from '~/functions';
import { useI18n } from '~/i18n';
import { useLocalizedPageTitle } from '~/hooks/useLocalizedPageTitle';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import Sidebar from '../myVideosPage/sidebar/sidebar';
import Pagination from '../library/pagination';
import CustomSelect from '../customSelect/customSelect';
import { getVideoThumbnail } from '../shared/videoMedia';
import { liveStatuses, liveRequest, liveDeletionBlocked, type LiveVideo } from './api';
import { ConfirmDialog } from '../confirmPopup/confirmDialog';
import { useConfirm } from '../confirmPopup/useConfirm';
import { useLivestreams } from './LiveList';
import LiveStatus from './LiveStatus';
import './myLivestreams.css';

export default function MyLivestreams() {
  useLocalizedPageTitle('liveMyStreams');
  const { t, locale } = useI18n();
  const { can, canOwn } = useAuthorization();
  const { search, setSearch, status, setStatus, page, setPage, limit, setLimit, query } = useLivestreams({ mine: true });
  const client = useQueryClient();
  const { confirm, dialogProps } = useConfirm();
  const pending = useRef(false);
  const [deletingId, setDeletingId] = useState<string>();
  const [deleteError, setDeleteError] = useState('');
  const deleteStream = async (video: LiveVideo) => {
    if (pending.current || liveDeletionBlocked(video.livestream) || !canOwn(P.liveDeleteOwn, P.liveDeleteAny, video.uploader_id)) return;
    pending.current = true;
    try {
      if (!await confirm({ title: `${t('liveDelete')}: ${video.title}`, message: t('adminActionCannotBeUndone'), yesText: t('adminDelete'), noText: t('adminCancel') })) return;
      setDeletingId(video.id); setDeleteError('');
      await liveRequest(`video-moderation/video/${video.id}`, 'DELETE');
      if (query.data?.livestreams.length === 1 && page > 1) setPage(page - 1);
      await client.invalidateQueries({ queryKey: ['livestreams'] });
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
        <div className="filter">{SearchSVG}<input type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} aria-label={t('liveSearch')} placeholder={t('liveSearch')} /></div>
        <div className="livestreamToolbarActions">
          <CustomSelect value={status} onChange={value => { setStatus(value); setPage(1); }} ariaLabel={t('liveFilter')} options={[{ value: '', label: t('liveAllStatuses') }, ...liveStatuses.map(value => ({ value, label: t(`liveStatus_${value}`) }))]} />
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
            <th className="notHoverable" scope="col">{t('adminTableViews')}</th>
          </tr></thead>
          <tbody>
            {query.isPending ? <tr><td colSpan={4} className="livestreamTableMessage" role="status">{t('videoLoadingData')}</td></tr>
              : query.isError ? <tr><td colSpan={4} className="livestreamTableMessage" role="alert">{query.error.message}<button type="button" onClick={() => void query.refetch()}>{t('usersRetry')}</button></td></tr>
              : !query.data?.livestreams.length ? <tr><td colSpan={4} className="livestreamTableMessage">{t('liveEmpty')}</td></tr>
              : query.data.livestreams.map(video => <tr key={video.id}>
                <td><span className="videoInfo">
                  <Link to={`/live/${video.id}/studio`} className="livestreamRowThumbnail" aria-label={`${t('liveManage')}: ${video.title}`}><img src={getVideoThumbnail(video) || DefaultThumbnail} alt="" loading="lazy" decoding="async" onError={event => { if (event.currentTarget.getAttribute('src') !== DefaultThumbnail) event.currentTarget.src = DefaultThumbnail; }} /></Link>
                  <span className="livestreamRowInfo">
                    <Link to={`/live/${video.id}/studio`}><h3>{video.title}</h3></Link>
                    <h5>{t(video.livestream.mode === 'dvr' ? 'liveDvr' : 'liveStandard')}</h5>
                    <span className="livestreamMobileMeta"><LiveStatus live={video.livestream}/><time dateTime={video.livestream.scheduled_start_at || undefined}>{date(video.livestream.scheduled_start_at)}</time></span>
                    <span className="videoActions">
                      <Link to={`/video/${video.id}`} title={t('liveWatch')} aria-label={t('liveWatch')}>{PermissionEyeSVG}</Link>
                      <Link to={`/live/${video.id}/studio`} title={t('liveManage')} aria-label={t('liveManage')}>{EditSVG}</Link>
                      {canOwn(P.liveAnalyticsOwn, P.liveAnalyticsAny, video.uploader_id) && <Link to={`/video-analytics?video=${video.id}`} title={t('adminVideoAnalytics')} aria-label={t('adminVideoAnalytics')}>{AnalyticsSVG}</Link>}
                      {canOwn(P.liveDeleteOwn, P.liveDeleteAny, video.uploader_id) && <button type="button" onClick={() => void deleteStream(video)} disabled={!!deletingId || dialogProps.open || liveDeletionBlocked(video.livestream)} aria-label={t('liveDelete')} title={t(liveDeletionBlocked(video.livestream) ? 'liveDeleteBlocked' : 'liveDelete')}>{DeleteSVG}</button>}
                    </span>
                  </span>
                </span></td>
                <td><LiveStatus live={video.livestream}/></td>
                <td><time dateTime={video.livestream.scheduled_start_at || undefined}>{date(video.livestream.scheduled_start_at)}</time></td>
                <td>{formatViews(video.view_count)}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
      <Pagination page={page} limit={limit} total={query.data?.pagination.total} loading={query.isFetching} disabled={query.isError} pageSizes={[10, 20, 30, 40, 50]} label={t('liveMyStreams')} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
    </div></div>
  </main>;
}
