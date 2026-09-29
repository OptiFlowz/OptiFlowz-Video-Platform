import { useLocalizedPageTitle } from '~/hooks/useLocalizedPageTitle';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { InfoSVG, ShareSVG, UploadSVG } from '~/constants';
import CustomSelect from '../customSelect/customSelect';
import { liveRequest, liveStatusKey, type LiveDetails, type LiveStream } from './api';
import { useLiveDetails } from './useLiveStream';
import Sidebar from '../myVideosPage/sidebar/sidebar';
import { EditorHeader } from '../shared/editorHeader';
import { useConstrainedSticky } from '../shared/useConstrainedSticky';
import { ThumbnailImage } from '../shared/thumbnailImage';
import LiveStudioPreview from './LiveStudioPreview';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import statusStyles from '../uploadPage/uploadStatus.module.css';
import '~/styles/editor.css';
import './live.css';
import './liveStudio.css';

type Credentials = { stream_key: string; server: string };
const localDate = (value?: string | null) => {
  if (!value) return '';
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
export default function LiveStudio({ create = false }: { create?: boolean }) {
  useLocalizedPageTitle(create ? 'liveCreate' : 'liveEdit');
  const { videoId } = useParams();
  const { t } = useI18n();
  const query = useLiveDetails(videoId, !create);
  if (!create && query.isPending) return <main className={`uploadMain ${statusStyles.page}`}><Sidebar/><div className="uploadSide"><p role="status">{t('videoLoadingData')}</p></div></main>;
  if (!create && (!query.data || [401, 403, 404].includes(Number((query.error as { status?: number } | null)?.status)))) return <main className={`uploadMain ${statusStyles.page}`}><Sidebar/><div className="uploadSide"><p role="alert">{query.error?.message || t('videoNotFound')}</p></div></main>;
  return <StudioForm key={`${create ? 'new' : videoId}:${getToken()}`} live={create ? undefined : query.data}/>;
}
function StudioForm({ live }: { live?: LiveDetails }) {
  const previewAsideRef = useRef<HTMLElement | null>(null);
  const previewStickyRef = useRef<HTMLDivElement | null>(null);
  const previewBoundaryRef = useRef<HTMLElement | null>(null);
  const previewStickyStyle = useConstrainedSticky({
    containerRef: previewAsideRef,
    stickyRef: previewStickyRef,
    boundaryRef: previewBoundaryRef,
    disabledBelow: 1420,
    topOffset: 89,
    bottomGap: 24,
  });
  const { t, locale } = useI18n();
  const { can, canOwn } = useAuthorization();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [title, setTitle] = useState(live?.title ?? '');
  const [description, setDescription] = useState(live?.description ?? '');
  const [visibility, setVisibility] = useState<LiveStream['visibility']>(live?.visibility ?? 'private');
  const [policy, setPolicy] = useState<LiveStream['playback_policy']>(live?.playback_policy ?? 'signed');
  const [dvr, setDvr] = useState(live?.dvr_enabled ?? false);
  const durationLocale = locale === 'sr' ? 'sr-Latn' : locale;
  const durationParts: [number, string][] = dvr
    ? [[3, 'hour'], [59, 'minute'], [59, 'second']]
    : [[12, 'hour']];
  const maxDuration = new Intl.ListFormat(durationLocale, { style: 'long', type: 'unit' }).format(
    durationParts.map(([value, unit]) => new Intl.NumberFormat(durationLocale, {
      style: 'unit', unit, unitDisplay: 'long',
    }).format(value)),
  );
  const [schedule, setSchedule] = useState(localDate(live?.scheduled_at));
  const [credentials, setCredentials] = useState<Credentials>();
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const thumbnailInput = useRef<HTMLInputElement>(null);
  const create = !live;
  const ownerId = live?.uploader_id;
  const edit = create ? can(P.liveCreate) : canOwn(P.liveUpdateOwn, P.liveUpdateAny, ownerId);
  const broadcast = !!live && canOwn(P.liveBroadcastOwn, P.liveBroadcastAny, ownerId);
  const ingestAvailable = !!live && !['ended', 'cancelled'].includes(live.status) && live.mux_status !== 'disabled';
  useEffect(() => { if (!ingestAvailable || !broadcast) { setCredentials(undefined); setReveal(false); } }, [ingestAvailable, broadcast]);
  const refresh = async () => { await Promise.all(['live-details', 'live-cards', 'livestreams', 'live-playback', 'my-videos'].map(key => client.invalidateQueries({ queryKey: [key] }))); };
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try { await action(); } catch (e) { setError(e instanceof Error ? e.message : t('liveOperationFailed')); }
    finally { pending.current = false; setBusy(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); if (!edit) return; void run(async () => {
    if (!title.trim()) throw new Error(t('liveTitleRequired'));
    const details = { title: title.trim(), description: description.trim() || null, visibility, playback_policy: policy,
      scheduled_at: schedule ? new Date(schedule).toISOString() : null };
    if (create) {
      // Never put the creation response (which contains an encoder key) in the query cache.
      const result = await liveRequest<{ live_stream: LiveStream }>('live-streams', 'POST', { ...details, dvr_enabled: dvr });
      await client.invalidateQueries({ queryKey: ['livestreams'] });
      navigate(`/live/${result.live_stream.id}/studio`, { replace: true });
    } else {
      try { await liveRequest(`live-streams/${live.id}`, 'PATCH', details); }
      finally { await refresh(); } // A policy cleanup error may occur after settings were saved.
      setMessage(t('liveSaved'));
    }
  }); };
  const copy = async (value: string) => { await navigator.clipboard.writeText(value); setMessage(t('liveCopied')); };
  return <main className={`uploadMain liveStudio ${statusStyles.page}`}>
    <Sidebar />
    <div className="uploadSide max-w-full! w-full">
      <EditorHeader kind="live" id={live?.id || ''} ownerId={ownerId} resourceTitle={live?.title || title} heading={t(create ? 'liveCreate' : 'liveEdit')} disabled={busy || create}>
        {t('liveDetails')} · {t('liveSettings')}
      </EditorHeader>
      {error && <div className="errorBanner" role="alert"><p>{error}</p></div>}
      {message && <p className="liveNotice" role="status">{message}</p>}
      <div className="stepContentWithPreview">
        <aside ref={previewAsideRef} className="stepContentSidebar">
          <div ref={previewStickyRef} style={previewStickyStyle} className="liveStack liveStudioSticky">
          <LiveStudioPreview live={live} title={title}/>
          <div className="videoDetailsForm"><section className="editSection liveForm">
            <h2 className="editSectionTitle">{t(create ? 'liveHowItWorks' : 'liveBroadcast')}</h2>
            <p>{t('liveEncoderHelp')}</p>
            {live && <>
              {broadcast && ingestAvailable && <button type="button" className="liveButton" disabled={busy} onClick={() => void run(async () => {
                setCredentials(undefined); setReveal(false);
                setCredentials(await liveRequest<Credentials>(`live-streams/${live.id}/streaming-details`));
              })}>{t('liveGetCredentials')}</button>}
              {credentials && broadcast && ingestAvailable && <div className="liveCredentials">
                <label>{t('liveServer')}<input readOnly value={credentials.server}/></label>
                <button className="liveButton" disabled={busy} onClick={() => void run(() => copy(credentials.server))}>{t('liveCopyServer')}</button>
                <label>{t('liveStreamKey')}<input type={reveal ? 'text' : 'password'} readOnly autoComplete="off" value={credentials.stream_key}/></label>
                <div className="liveActions"><button className="liveButton" onClick={() => setReveal(!reveal)}>{t(reveal ? 'liveHideKey' : 'liveShowKey')}</button><button className="liveButton" disabled={busy} onClick={() => void run(() => copy(credentials.stream_key))}>{t('liveCopyKey')}</button><button className="liveButton" onClick={() => { setCredentials(undefined); setReveal(false); }}>{t('close')}</button></div>
                <p className="liveHelp">{t('liveCredentialsHelp')}</p>
              </div>}
              <p className="liveHelp">{t(`liveMessage_${liveStatusKey(live.status)}`)}</p>
              {ingestAvailable && <p className="liveHelp">{t('liveStopEncoderHelp')}</p>}
              {can(P.videosUpdateOwn) && <Link className="liveButton" to="/my-videos">{t('liveEditRecording')}</Link>}
            </>}
          </section></div>
          </div>
        </aside>
        <div className="stepContentMain"><div className="videoDetailsForm">
          {live && edit && <section className="editSection liveForm">
            <h2 className="editSectionTitle">{t('thumbnail')}</h2>
            <div className="thumbnailSettingsPreview"><ThumbnailImage src={live.thumbnail_url || DefaultThumbnail} alt={t('thumbnail')} className="thumbnailPickerImage"/></div>
            <input ref={thumbnailInput} hidden type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e => {
              const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
              void run(async () => {
                if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5242880) throw new Error(t('liveThumbnailRequirements'));
                const form = new FormData(); form.append('file', file);
                await liveRequest(`live-streams/${live.id}/thumbnail`, 'POST', form); await refresh(); setMessage(t('liveSaved'));
              });
            }}/>
            <div className="thumbnailSourceActions">
              <button type="button" className="saveCaptionsBtn thumbnailSourceButton" disabled={busy} onClick={() => thumbnailInput.current?.click()}>{UploadSVG}{t('uploadSelectFile')}</button>
              {live.thumbnail_url && <button type="button" className="liveButton" disabled={busy} onClick={() => void run(async () => { await liveRequest(`live-streams/${live.id}/thumbnail`, 'POST'); await refresh(); setMessage(t('liveSaved')); })}>{t('removeThumbnail')}</button>}
            </div><p className="formHint">{t('liveThumbnailRequirements')}</p>
          </section>}
          <form className="editSection liveForm" onSubmit={submit}>
            <h2 className="editSectionTitle">{t('liveDetails')}</h2>
            <label>{t('liveEventTitle')}<input maxLength={512} required value={title} disabled={!edit || busy} onChange={e => setTitle(e.target.value)}/></label>
            <label>{t('description')}<textarea rows={5} value={description} disabled={!edit || busy} onChange={e => setDescription(e.target.value)}/></label>
            <label>{t('liveVisibility')}<CustomSelect value={visibility} disabled={!edit || busy} onChange={v => setVisibility(v as LiveStream['visibility'])} ariaLabel={t('liveVisibility')} options={[{ value: 'private', label: t('livePrivate') }, { value: 'unlisted', label: t('liveUnlisted') }, { value: 'public', label: t('livePublic') }]}/></label>
            <label>{t('livePolicy')}<CustomSelect value={policy} disabled={!edit || busy} onChange={v => setPolicy(v as LiveStream['playback_policy'])} ariaLabel={t('livePolicy')} options={[{ value: 'signed', label: t('liveSigned') }, { value: 'public', label: t('livePublicPlayback') }]}/></label>
            <label>{t('liveSchedule')}<input type="datetime-local" value={schedule} disabled={!edit || busy} onChange={e => setSchedule(e.target.value)}/></label>
            <p className="liveHelp">{t('liveScheduleHelp')}</p>
            <div className="liveFormRow">
              <label>{t('liveMode')}<CustomSelect value={dvr ? 'dvr' : 'standard'} disabled={!create || !edit || busy} onChange={v => setDvr(v === 'dvr')} ariaLabel={t('liveMode')} options={[{ value: 'standard', label: t('liveStandard') }, { value: 'dvr', label: t('liveDvr') }]}/></label>
            </div>
            <aside className="liveDurationNotice"><span aria-hidden="true">{InfoSVG}</span><p>{t('liveDuration')}: <strong>{maxDuration}</strong></p></aside>
            <p className="liveHelp">{t('liveDvrLockedHelp')}</p>
            {!create && <p className="liveHelp">{t('liveRecordingSettingsHelp')}</p>}
            {edit && <button className="saveCaptionsBtn" disabled={busy} type="submit">{t(busy ? 'liveSaving' : create ? 'liveCreate' : 'liveSaveDetails')}</button>}
          </form>
        </div></div>
      </div>
      <section ref={previewBoundaryRef} className="liveStudioFooter">
        {can(P.liveUpdateOwn) && <Link className="liveButton" to="/my-livestreams">{t('liveMyStreams')}</Link>}
        {live && <div className="liveActions"><Link className="liveButton livePrimary" to={`/live/${live.id}`}>{t('liveWatch')}</Link><button type="button" className="liveButton" disabled={busy} onClick={() => void run(() => copy(`${window.location.origin}/live/${live.id}`))}>{ShareSVG}{t('share')}</button></div>}
      </section>
    </div>
  </main>;
}
