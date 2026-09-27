import { useLocalizedPageTitle } from '~/hooks/useLocalizedPageTitle';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { ShareSVG, UploadSVG } from '~/constants';
import CustomSelect from '../customSelect/customSelect';
import { ConfirmDialog } from '../confirmPopup/confirmDialog';
import { useConfirm } from '../confirmPopup/useConfirm';
import { getVideoThumbnail } from '../shared/videoMedia';
import { liveRequest, liveDeletionBlocked, recordingReady, type LiveVideo } from './api';
import Sidebar from '../myVideosPage/sidebar/sidebar';
import { EditorHeader } from '../shared/editorHeader';
import { ThumbnailImage } from '../shared/thumbnailImage';
import LiveStudioPreview from './LiveStudioPreview';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import statusStyles from '../uploadPage/uploadStatus.module.css';
import '~/styles/editor.css';
import './live.css';
import './liveStudio.css';

type Credentials = { stream_key: string; rtmps_url: string };
const localDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export default function LiveStudio({ create = false }: { create?: boolean }) {
  useLocalizedPageTitle(create ? 'liveCreate' : 'liveEdit');
  const { videoId } = useParams();
  const { t } = useI18n();
  const token = getToken();
  const query = useQuery({ queryKey: ['live-studio', videoId, token], enabled: !create && !!videoId,
    queryFn: ({ signal }) => liveRequest<LiveVideo>(`videos/${videoId}`, 'GET', undefined, signal), refetchInterval: 15000, retry: 1 });
  if (!create && query.isPending) return <main className={`uploadMain ${statusStyles.page}`}><Sidebar/><div className="uploadSide max-w-full! w-full"><p role="status">{t('videoLoadingData')}</p></div></main>;
  if (!create && (query.isError || !query.data || query.data.kind !== 'live')) return <main className={`uploadMain ${statusStyles.page}`}><Sidebar/><div className="uploadSide max-w-full! w-full"><p role="alert">{query.error?.message || t('videoNotFound')}</p></div></main>;
  return <StudioForm key={create ? 'new' : videoId} video={create ? undefined : query.data} />;
}
function StudioForm({ video }: { video?: LiveVideo }) {
  const { t } = useI18n();
  const { can, canOwn, user } = useAuthorization();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { confirm, dialogProps } = useConfirm();
  const [title, setTitle] = useState(video?.title ?? '');
  const [description, setDescription] = useState(video?.description ?? '');
  const [visibility, setVisibility] = useState(video?.visibility ?? 'private');
  const [policy, setPolicy] = useState<'public' | 'signed'>((video as (LiveVideo & { playback_policy?: 'public' | 'signed' }) | undefined)?.playback_policy ?? 'signed');
  const [mode, setMode] = useState(video?.livestream.mode ?? 'standard');
  const [schedule, setSchedule] = useState(localDate(video?.livestream.scheduled_start_at));
  const [duration, setDuration] = useState(String(video?.livestream.max_duration_seconds ?? 43200));
  const [credentials, setCredentials] = useState<Credentials>();
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const create = !video;
  const ownerId = video?.uploader_id;
  const edit = create ? can(P.liveCreate) : canOwn(P.liveUpdateOwn, P.liveUpdateAny, ownerId);
  const broadcast = !!video && canOwn(P.liveBroadcastOwn, P.liveBroadcastAny, ownerId);
  const thumbnailInput = useRef<HTMLInputElement>(null);
  const beforeStart = create || (video.livestream.status === 'scheduled' && !video.livestream.started_at && !video.livestream.policy_sync_pending);
  const ingestAvailable = !!video && ['scheduled', 'live', 'reconnecting'].includes(video.livestream.status) && !video.livestream.policy_sync_pending;
  const analytics = !!video && canOwn(P.liveAnalyticsOwn, P.liveAnalyticsAny, ownerId);
  const viewers = useQuery({ queryKey: ['live-viewers', video?.id, user?.id], enabled: analytics,
    queryFn: ({ signal }) => liveRequest<{ concurrent_viewers: number }>(`analytics/${video!.id}/concurrent-viewers`, 'GET', undefined, signal), refetchInterval: 15000, retry: 1 });
  useEffect(() => { if (!ingestAvailable) { setCredentials(undefined); setReveal(false); } }, [ingestAvailable]);
  const refresh = async () => { await Promise.all(['live-studio', 'livestreams', 'video', 'video-playback'].map(key => client.invalidateQueries({ queryKey: [key] }))); };
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : t('liveOperationFailed')); }
    finally { setBusy(false); }
  };
  const settings = () => ({ mode, scheduled_start_at: schedule ? new Date(schedule).toISOString() : null, max_duration_seconds: Number(duration) });
  const validateSettings = () => {
    const seconds = Number(duration);
    if (!Number.isInteger(seconds) || seconds < 60 || seconds > (mode === 'dvr' ? 14399 : 43200)) throw new Error(t('liveDurationHelp'));
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void run(async () => {
    if (!title.trim()) throw new Error(t('liveTitleRequired'));
    if (create) {
      validateSettings();
      const result = await liveRequest<{ livestream: { id?: string; video_id: string } }>('livestreams', 'POST', { title: title.trim(), description, visibility, playback_policy: policy, ...settings() });
      await client.invalidateQueries({ queryKey: ['livestreams'] });
      navigate(`/live/${result.livestream.video_id || result.livestream.id}/studio`);
    } else {
      await liveRequest(`video-moderation/video-details/${video.id}`, 'PATCH', { title: title.trim(), description, visibility,
        published_at: visibility === 'public' ? video.published_at || new Date().toISOString() : null });
      setMessage(t('liveSaved')); await refresh();
    }
  }); };
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); setMessage(t('liveCopied')); };
  const settingsFields = <>
    <div className="liveFormRow"><label>{t('liveMode')}<CustomSelect value={mode} disabled={busy || !edit || !beforeStart} onChange={value => { const next = value as 'standard' | 'dvr'; setMode(next); if (next === 'dvr' && Number(duration) >= 14400) setDuration('14399'); }} ariaLabel={t('liveMode')} options={[{ value: 'standard', label: t('liveStandard') }, { value: 'dvr', label: t('liveDvr') }]} /></label>
      <label>{t('liveDuration')}<input type="number" min={60} max={mode === 'dvr' ? 14399 : 43200} step={1} required disabled={busy || !edit || !beforeStart} value={duration} onChange={e => setDuration(e.target.value)} /></label></div>
    <p className="liveHelp">{t('liveDurationHelp')}</p>
    <label>{t('liveSchedule')}<input type="datetime-local" value={schedule} disabled={busy || !edit || !beforeStart} onChange={e => setSchedule(e.target.value)} /></label>
    <p className="liveHelp">{t('liveScheduleHelp')}</p>
  </>;
  return <main className={`uploadMain liveStudio ${statusStyles.page}`}>
    <Sidebar />
    <div className="uploadSide max-w-full! w-full">
      <EditorHeader kind="live" id={video?.id || ''} ownerId={ownerId} resourceTitle={video?.title || title} heading={t(create ? 'liveCreate' : 'liveEdit')} disabled={busy || !video || liveDeletionBlocked(video.livestream)} disabledReason={t('liveDeleteBlocked')}>
        {t('liveDetails')} · {t('liveSettings')}
      </EditorHeader>
      {error && <div className="errorBanner" role="alert"><p>{error}</p></div>}
      {message && <p className="liveNotice" role="status">{message}</p>}
      <div className="stepContentWithPreview">
        <aside className="stepContentSidebar liveStack">
          <LiveStudioPreview video={video} title={title}/>
          <div className="videoDetailsForm">
            {create ? <section className="editSection liveForm"><h2 className="editSectionTitle">{t('liveHowItWorks')}</h2><p>{t('liveEncoderHelp')}</p><p className="liveHelp">{t('liveReplayHelp')}</p></section> : <>
          <section className="editSection liveForm"><h2 className="editSectionTitle">{t('liveBroadcast')}</h2>
            {analytics && <Link className="liveButton" to={`/video-analytics?video=${video.id}`}>{t('adminVideoAnalytics')}</Link>}
            {edit && recordingReady(video) && <Link className="liveButton" to={`/edit?video=${video.id}`}>{t('liveEditRecording')}</Link>}
            {analytics && <p role="status">{viewers.isError ? t('liveViewersUnavailable') : t('liveViewers', { count: viewers.data?.concurrent_viewers ?? '…' })}</p>}
            <p>{t('liveEncoderHelp')}</p>
            {broadcast && ingestAvailable && <button className="liveButton" disabled={busy} onClick={() => void run(async () => { setCredentials(undefined); setReveal(false); setCredentials(await liveRequest<Credentials>(`livestreams/${video.id}/credentials`)); })}>{t('liveGetCredentials')}</button>}
            {credentials && broadcast && ingestAvailable && <div className="liveCredentials">
              <label>{t('liveServer')}<input readOnly value={credentials.rtmps_url}/></label><button className="liveButton" disabled={busy} onClick={() => void run(() => copy(credentials.rtmps_url))}>{t('liveCopyServer')}</button>
              <label>{t('liveStreamKey')}<input type={reveal ? 'text' : 'password'} readOnly autoComplete="off" value={credentials.stream_key}/></label>
              <div className="liveActions"><button className="liveButton" onClick={() => setReveal(!reveal)}>{t(reveal ? 'liveHideKey' : 'liveShowKey')}</button><button className="liveButton" disabled={busy} onClick={() => void run(() => copy(credentials.stream_key))}>{t('liveCopyKey')}</button><button className="liveButton" onClick={() => { setCredentials(undefined); setReveal(false); }}>{t('close')}</button></div>
              <p className="liveHelp">{t('liveCredentialsHelp')}</p>
            </div>}
            {broadcast && ['scheduled','live','reconnecting','ending'].includes(video.livestream.status) && <button className="liveButton liveDanger" disabled={busy || video.livestream.policy_sync_pending || video.livestream.status === 'ending'} onClick={async () => {
              if (!await confirm({ title: t('liveEnd'), message: t('liveEndConfirm') })) return;
              void run(async () => { await liveRequest(`livestreams/${video.id}/end`, 'POST'); setCredentials(undefined); await refresh(); setMessage(t('liveEndRequested')); });
            }}>{t(video.livestream.status === 'scheduled' ? 'liveCancelEvent' : 'liveEnd')}</button>}
            <p className="liveHelp">{t(`liveMessage_${video.livestream.status}`)}</p>
            {video.livestream.stop_at && <p className="liveHelp">{t('liveStopsAt', { time: new Date(video.livestream.stop_at).toLocaleString() })}</p>}
          </section>
            </>}
          </div>
        </aside>
        <div className="stepContentMain"><div className="videoDetailsForm">
        {video && edit && <section className="editSection liveForm">
          <h2 className="editSectionTitle">{t('thumbnail')}</h2>
          <div className="thumbnailSettingsPreview"><ThumbnailImage src={getVideoThumbnail(video) || DefaultThumbnail} alt={t('thumbnail')} className="thumbnailPickerImage"/></div>
          <input ref={thumbnailInput} hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; void run(async () => { const form = new FormData(); form.append('file', file); await liveRequest(`video-moderation/${video.id}/thumbnail`, 'POST', form); await refresh(); setMessage(t('liveSaved')); }); }} />
          <div className="thumbnailSourceActions"><button type="button" className="saveCaptionsBtn thumbnailSourceButton" disabled={busy} onClick={() => thumbnailInput.current?.click()}>{UploadSVG}{t('uploadSelectFile')}</button></div>
          <p className="formHint">{t('liveUploadArtwork')}</p>
        </section>}
        <form className="editSection liveForm" onSubmit={submit}>
          <h2 className="editSectionTitle">{t('liveDetails')}</h2>
          <label>{t('liveEventTitle')}<input maxLength={255} required value={title} disabled={!edit || busy} onChange={e => setTitle(e.target.value)} /></label>
          <label>{t('description')}<textarea maxLength={10000} rows={5} value={description} disabled={!edit || busy} onChange={e => setDescription(e.target.value)} /></label>
          <label>{t('liveVisibility')}<CustomSelect value={visibility} disabled={!edit || busy} onChange={v => { setVisibility(v as 'public' | 'private'); if (create && v === 'private') setPolicy('signed'); }} ariaLabel={t('liveVisibility')} options={[{ value: 'private', label: t('livePrivate') }, { value: 'public', label: t('livePublic') }]} /></label>
          {!create && visibility === 'private' && (video as LiveVideo & { playback_policy?: string }).playback_policy === 'public' && <p className="liveHelp">{t('livePrivatePolicyHelp')}</p>}
          {create && <><label>{t('livePolicy')}<CustomSelect value={policy} disabled={busy || visibility === 'private'} onChange={v => setPolicy(v as 'public' | 'signed')} ariaLabel={t('livePolicy')} options={[{ value: 'signed', label: t('liveSigned') }, { value: 'public', label: t('livePublicPlayback') }]} /></label>{settingsFields}</>}
          {edit && <button className="saveCaptionsBtn" disabled={busy} type="submit">{t(busy ? 'liveSaving' : create ? 'liveCreate' : 'liveSaveDetails')}</button>}
        </form>
          {video && <>
          {edit && <form className="editSection liveForm" onSubmit={e => { e.preventDefault(); void run(async () => { validateSettings(); await liveRequest(`livestreams/${video.id}/settings`, 'PATCH', settings()); await refresh(); setMessage(t('liveSaved')); }); }}>
            <h2 className="editSectionTitle">{t('liveSettings')}</h2>{settingsFields}
            <button className="liveButton" disabled={busy || !beforeStart} type="submit">{t('liveSaveSettings')}</button>
          </form>}
          {edit && <section className="editSection liveForm"><h2 className="editSectionTitle">{t('livePolicy')}</h2><p className="liveHelp">{t('livePolicyHelp')}</p>
            {video.livestream.policy_sync_pending && <p role="status">{t('livePolicyPending')}</p>}
            <CustomSelect value={policy} disabled={busy} onChange={v => setPolicy(v as 'public' | 'signed')} ariaLabel={t('livePolicy')} options={[{ value: 'signed', label: t('liveSigned') }, { value: 'public', label: t('livePublicPlayback'), disabled: video.visibility === 'private' }]} />
            <button className="liveButton" disabled={busy} onClick={async () => { if (!await confirm({ title: t('livePolicy'), message: t('livePolicyHelp') })) return;
              void run(async () => { setCredentials(undefined); setReveal(false); await liveRequest(`video-moderation/${video.id}/playback-policy`, 'PATCH', { playback_policy: policy }); await refresh(); setMessage(t('liveSaved')); }); }}>{t('liveApplyPolicy')}</button>
          </section>}
          </>}
        </div></div>
      </div>
      <section className="liveStudioFooter">
        <Link className="liveButton" to="/my-livestreams">{t('liveMyStreams')}</Link>
        {video && <div className="liveActions"><Link className="liveButton livePrimary" to={`/video/${video.id}`}>{t('liveWatch')}</Link><button type="button" className="liveButton" disabled={busy} onClick={() => void run(() => copy(`${window.location.origin}/video/${video.id}`))}>{ShareSVG}{t('share')}</button></div>}
      </section>
    </div><ConfirmDialog {...dialogProps}/>
  </main>;
}
