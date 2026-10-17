import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import { UploadSVG } from '~/constants';
import { EditorHeader } from '~/components/shared/editorHeader';
import Sidebar from '~/components/myVideosPage/sidebar/sidebar';
import { ThumbnailDropZone } from '~/components/shared/thumbnailDropZone';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import DefaultThumbnail from '../../../assets/DefaultThumbnail.webp';
import CollectionFields from './CollectionFields';
import CollectionState from './CollectionState';
import CollectionPlaylistList from './CollectionPlaylistList';
import PlaylistPicker from './PlaylistPicker';
import { addPlaylists, createCollection, getCollection, removePlaylist, savePlaylistOrder, updateCollection, uploadThumbnail } from './api';
import { collectionFields, emptyCollection, reorderPlaylists, validCollectionThumbnail, type CollectionDetails, type CollectionFields as Fields } from './model';
import editor from '../editPlaylistPage/editPlaylistPage.module.css';
import status from '../uploadPage/uploadStatus.module.css';
import '~/styles/editor.css';
import './collections.css';

function CollectionNavigation({ id }: { id?: string | null }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  return <section className="bottomBtns">
    <button type="button" className="cancelBtn" onClick={() => navigate('/my-collections')}>{t('navMyCollections')}</button>
    {id && <Link to={`/collection/${id}`} className="uploadBtn">{t('collectionView')}</Link>}
  </section>;
}

function NewCollection() {
  const { t } = useI18n(); const { can } = useAuthorization(); const navigate = useNavigate(); const client = useQueryClient();
  const [fields, setFields] = useState<Fields>(emptyCollection), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [thumbnail, setThumbnail] = useState<File | null>(null), [preview, setPreview] = useState('');
  const [createdId, setCreatedId] = useState<string | null>(null);
  const pending = useRef(false), input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!thumbnail) { setPreview(''); return; }
    const url = URL.createObjectURL(thumbnail); setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [thumbnail]);
  function selectThumbnail(file: File) {
    if (pending.current) return;
    if (!validCollectionThumbnail(file)) { setError(t('collectionThumbnailHelp')); return; }
    setThumbnail(file); setError('');
  }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (pending.current || !fields.title.trim() || !can(P.collectionsCreate)) return;
    pending.current = true; setBusy(true); setError('');
    let id = createdId;
    try {
      if (!id) {
        const { collection } = await createCollection(collectionFields(fields, can(P.collectionsFeature)));
        id = collection.id; setCreatedId(id);
      }
      // The thumbnail endpoint needs an existing collection ID. Keep it on failure
      // so retrying the upload never creates a second collection.
      if (thumbnail) await uploadThumbnail(id, thumbnail);
      navigate(`/edit-collection?collection=${id}`, { replace: true });
    } catch {
      setError(t(id ? 'collectionCoverUploadFailed' : 'collectionSaveFailed'));
    } finally {
      void client.invalidateQueries({ queryKey: ['collections'] });
      pending.current = false; setBusy(false);
    }
  }
  if (!can(P.collectionsCreate)) return <CollectionState error={{ status: 403 }} />;
  return <><h1>{t('collectionCreate')}</h1>
    <form className="editSection collectionCreateForm" onSubmit={submit}>
      <p className="formHint">{t('collectionCreateHelp')}</p>
      <ThumbnailDropZone onFileSelect={selectThumbnail} disabled={busy}>
        <h2>{t('thumbnail')}</h2><p className="formHint">{t('collectionThumbnailHelp')}</p>
        <img className="collectionThumbnail" src={preview || DefaultThumbnail} alt={t('thumbnail')} />
        <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) selectThumbnail(file); }} />
        <div className="collectionFormActions">
          <button type="button" className="saveCaptionsBtn thumbnailSourceButton" disabled={busy} onClick={() => input.current?.click()}>{UploadSVG}{t('collectionUploadThumbnail')}</button>
          {thumbnail && <button type="button" className="deleteCaptionsBtn" disabled={busy} onClick={() => { setThumbnail(null); setError(''); }}>{t('collectionRemoveThumbnail')}</button>}
        </div>
      </ThumbnailDropZone>
      <CollectionFields value={fields} onChange={setFields} disabled={busy || !!createdId} />
      {error && <p className="errorBanner" role="alert">{error}</p>}
      <div className="collectionFormActions"><Link className="cancelBtn thumbnailCancelBtn" to={createdId ? `/edit-collection?collection=${createdId}` : '/my-collections'}>{t(createdId ? 'collectionEdit' : 'adminCancel')}</Link><button className="saveCaptionsBtn" type="submit" disabled={busy || !fields.title.trim()}>{t(busy ? (createdId ? 'saving' : 'creating') : (createdId ? 'adminSave' : 'collectionCreate'))}</button></div>
    </form>
    <CollectionNavigation id={createdId} />
  </>;
}

function ExistingCollection({ data }: { data: CollectionDetails }) {
  const { t } = useI18n(); const { can, canOwn } = useAuthorization(); const client = useQueryClient();
  const { collection, playlists } = data; const id = collection.id;
  const canEdit = canOwn(P.collectionsUpdateOwn, P.collectionsUpdateAny, collection.created_by);
  const [fields, setFields] = useState<Fields>(() => collectionFields(collection));
  const [savedFields, setSavedFields] = useState(() => collectionFields(collection));
  const [isSavingDetails, setIsSavingDetails] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
  const pending = useRef(false), input = useRef<HTMLInputElement>(null); const { confirm, dialogProps } = useConfirm();
  const dirty = JSON.stringify(collectionFields(fields)) !== JSON.stringify(savedFields);
  async function mutate(action: () => Promise<unknown>, success: string) {
    if (pending.current || !canEdit) return;
    pending.current = true; setBusy(true); setError(''); setMessage('');
    try {
      await action(); setMessage(success);
      await client.invalidateQueries({ queryKey: ['collections'] });
    } catch (err) {
      const conflict = typeof err === 'object' && err && 'status' in err && err.status === 409;
      setError(t(conflict ? 'collectionConflict' : 'collectionSaveFailed'));
      // A failed response can follow a committed write. Re-read before another edit.
      await client.invalidateQueries({ queryKey: ['collections'] });
    } finally { pending.current = false; setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault(); if (pending.current || !dirty || !fields.title.trim()) return;
    setIsSavingDetails(true);
    try {
      await mutate(async () => {
        const result = await updateCollection(id, collectionFields(fields, can(P.collectionsFeature)));
        const saved = collectionFields(result.collection);
        setFields(saved);
        setSavedFields(saved);
      }, t('collectionSaved'));
    } finally { setIsSavingDetails(false); }
  }
  function selectThumbnail(file: File) {
    if (!validCollectionThumbnail(file)) { setError(t('collectionThumbnailHelp')); return; }
    void mutate(() => uploadThumbnail(id, file), t('collectionThumbnailSaved'));
  }
  async function removeMembership(playlistId: string) {
    const playlist = playlists.find(item => item.id === playlistId);
    if (busy || !playlist) return;
    if (await confirm({ title: t('collectionRemoveTitle', { title: playlist.title }), message: t('collectionRemoveHelp'), yesText: t('collectionRemovePlaylist'), noText: t('adminCancel') })) {
      void mutate(() => removePlaylist(id, playlistId), t('collectionSaved'));
    }
  }
  if (!canEdit) return <CollectionState error={{ status: 403 }} />;
  return <><ConfirmDialog {...dialogProps} />
    <div className="collectionEditorHeading"><EditorHeader kind="collection" id={id} ownerId={collection.created_by} resourceTitle={collection.title} heading={t('collectionEdit')} disabled={busy || dialogProps.open}>
      {t('collectionEditHelp')}
    </EditorHeader></div>
    {error && <p className="errorBanner" role="alert">{error}</p>}{message && <p className="collectionNotice" role="status">{message}</p>}
    <div className={editor.layout}>
      <div>
        <ThumbnailDropZone className="editSection" onFileSelect={selectThumbnail} disabled={busy}>
          <h2>{t('thumbnail')}</h2><p className="formHint">{t('collectionThumbnailHelp')}</p>
          <img className="collectionThumbnail" src={collection.thumbnail_url || DefaultThumbnail} alt={t('thumbnail')} />
          <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={busy} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; if (file) selectThumbnail(file); }} />
          <div className="collectionFormActions"><button type="button" className="saveCaptionsBtn thumbnailSourceButton" disabled={busy} onClick={() => input.current?.click()}>{UploadSVG}{t('collectionUploadThumbnail')}</button>
            {collection.thumbnail_url && <button type="button" className="deleteCaptionsBtn" disabled={busy} onClick={() => void mutate(() => uploadThumbnail(id), t('collectionThumbnailSaved'))}>{t('collectionRemoveThumbnail')}</button>}
          </div>
        </ThumbnailDropZone>
        <form className="editSection" onSubmit={save}><h2>{t('collectionDetails')}</h2>
          <CollectionFields value={fields} onChange={value => { setFields(value); setMessage(''); }} disabled={busy} />
          <div className="captionsActions">
            <p className="formHint">
              {dirty && <span className="unsavedIndicator">• {t('editorUnsavedChanges')}</span>}
            </p>
            <div className="captionsButtonGroup">
              <button type="submit" className="saveCaptionsBtn" disabled={busy || !dirty || !fields.title.trim()}>
                {isSavingDetails ? <><div className="uploadSpinner tiny" />{t('saving')}</> : t('saveChanges')}
              </button>
            </div>
          </div>
        </form>
      </div>
      <div className={editor.videosColumn}>
        <section className="editSection"><h2>{t('collectionPlaylists', { count: playlists.length })}</h2><p className="formHint">{t('collectionReorderHelp')}</p>
          {!playlists.length ? <p className="collectionState">{t('collectionNoPlaylists')}</p> : <CollectionPlaylistList videos={playlists} disabled={busy || dialogProps.open}
            onMove={(from, to) => { const next = reorderPlaylists(playlists, from, to); if (next !== playlists) void mutate(() => savePlaylistOrder(id, next.map(item => item.id)), t('collectionSaved')); }} onDelete={playlistId => void removeMembership(playlistId)} />}
        </section>
        <section className="editSection"><h2>{t('collectionAddPlaylists')}</h2><p className="formHint">{t('collectionMembershipHelp')}</p>
          <PlaylistPicker included={playlists.map(item => item.id)} busy={busy || dialogProps.open} onAdd={playlistId => void mutate(() => addPlaylists(id, [playlistId]), t('collectionSaved'))} />
        </section>
      </div>
    </div>
    <CollectionNavigation id={id} />
  </>;
}

export default function CollectionEditor() {
  const [params] = useSearchParams(); const id = params.get('collection');
  const query = useQuery({ queryKey: ['collections', 'detail', getToken(), id],
    queryFn: ({ signal }) => getCollection(id!, signal), enabled: !!id, retry: false, refetchOnWindowFocus: false });
  return <main className={`uploadMain ${status.page} ${editor.page} collectionEditor`}><Sidebar /><div className="uploadSide videoDetailsForm">
    {!id ? <NewCollection /> : query.isPending ? <CollectionState /> : query.isError ? <CollectionState error={query.error} retry={() => void query.refetch()} /> : <ExistingCollection key={id} data={query.data} />}
  </div></main>;
}
