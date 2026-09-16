import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { Link } from "react-router";
import { NotesSVG, AddSVG, CloseSVG, DeleteSVG, EditSVG } from "~/constants";
import { useI18n } from "~/i18n";
import { noteColor, noteColors, noteTime, parseNoteTime, useVideoNotes, type NoteInput, type OpenNotesDetail, type VideoNote } from "./videoNotes";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import styles from "./notes.module.css";

export default function NotesPanel({ videoId, duration, request }: { videoId: string; duration: number; request?: OpenNotesDetail }) {
  const { t } = useI18n();
  const notes = useVideoNotes(videoId);
  const [time, setTime] = useState(0);
  const [draft, setDraft] = useState<{ note?: VideoNote; time: number } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState("");
  const appliedRequest = useRef<OpenNotesDetail | undefined>(undefined);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ videoId?: string; seconds: number }>).detail;
      if (detail?.videoId === videoId && Number.isFinite(detail.seconds)) setTime(detail.seconds);
    };
    window.addEventListener("player:time", receive);
    window.dispatchEvent(new CustomEvent("player:time-request", { detail: { videoId } }));
    return () => window.removeEventListener("player:time", receive);
  }, [videoId]);
  useEffect(() => {
    if (!request?.noteId || request.videoId !== videoId || appliedRequest.current === request) return;
    const note = notes.notes.find(item => item.id === request.noteId);
    if (!note) return;
    appliedRequest.current = request;
    if (request.action === "edit" && notes.canEdit) { setDeleting(null); setDraft({ note, time: note.timestamp }); }
    if (request.action === "delete" && notes.canDelete) setDeleting(note.id);
    // Apply each request once after the shared query has loaded.
  }, [request, videoId, notes.data, notes.canEdit, notes.canDelete]);
  const remove = async (id: string) => {
    setError("");
    try { await notes.mutation.mutateAsync({ type: "delete", id }); setDeleting(null); if (draft?.note?.id === id) setDraft(null); }
    catch { setError(t("notesDeleteError")); }
  };
  if (!notes.signedIn) return <div className={styles.message}><span className={styles.emptyIcon}>{NotesSVG}</span><h3>{t("myNotes")}</h3><p>{t("notesSignIn")}</p><Link className={styles.primary} to={`/login?redirect=${encodeURIComponent(`/video/${videoId}`)}`}>{t("login")}</Link></div>;
  if (notes.authLoading || (notes.canRead && notes.isPending)) return <p className={styles.message} role="status">{t("notesLoading")}</p>;
  if (!notes.canRead) return <p className={styles.message} role="status">{t(notes.authError ? "notesLoadError" : "notesNoAccess")}</p>;
  return <section className={styles.panel} aria-label={t("myNotes")}>
    <ConfirmDialog open={deleting !== null} title={t("notesDelete")} message={t("notesDeleteConfirm")} yesText={t("delete")} noText={t("cancel")} onYes={() => { if (deleting && !notes.mutation.isPending) { const id = deleting; setDeleting(null); void remove(id); } }} onNo={() => { if (!notes.mutation.isPending) setDeleting(null); }} />
    <div className={styles.toolbar}><p>{t("notesPrivate")}</p>{notes.canCreate && !draft && <button className={styles.addNote} disabled={notes.notes.length >= 100 || notes.mutation.isPending} onClick={() => { setError(""); setDeleting(null); setDraft({ time }); }}><span className={styles.addIcon}>{AddSVG}</span><span>{t("notesAdd")}</span><span className={styles.addTime}>{noteTime(time)}</span></button>}</div>
    {notes.notes.length >= 100 && <p className={styles.muted}>{t("notesLimit")}</p>}
    {notes.isError && <div className={styles.error} role="alert">{t("notesLoadError")} <button onClick={() => void notes.refetch()}>{t("notesRetry")}</button></div>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.list}>
      {draft && !draft.note && <NoteForm time={draft.time} duration={duration} pending={notes.mutation.isPending} onCancel={() => setDraft(null)} onSave={async input => {
        await notes.mutation.mutateAsync({ type: "create", input });
        setDraft(null);
      }} />}
      {notes.notes.map(note => draft?.note?.id === note.id ? <NoteForm key={note.id} note={draft.note} time={draft.time} duration={duration} pending={notes.mutation.isPending} onCancel={() => { setDraft(null); setDeleting(null); }} onDelete={notes.canDelete ? () => setDeleting(note.id) : undefined} onSave={async input => {
        await notes.mutation.mutateAsync({ type: "edit", id: note.id, input });
        setDraft(null);
        setDeleting(null);
      }} /> : <article key={note.id} className={styles.card} style={{ "--note-color": noteColor(note.color) } as CSSProperties}>
      <div className={styles.meta}><button className={styles.timestamp} aria-label={t("notesSeek", { time: noteTime(note.timestamp) })} onClick={() => window.dispatchEvent(new CustomEvent("player:seek", { detail: { videoId, seconds: note.timestamp } }))}>{noteTime(note.timestamp)}</button>
        <div className={styles.actions}>{notes.canEdit && <button disabled={notes.mutation.isPending || !!draft} aria-label={t("notesEdit")} title={t("notesEdit")} onClick={() => { setError(""); setDeleting(null); setDraft({ note, time: note.timestamp }); }}>{EditSVG}</button>}{notes.canDelete && <button className={styles.danger} disabled={notes.mutation.isPending} aria-label={t("notesDelete")} title={t("notesDelete")} onClick={() => { setError(""); setDeleting(note.id); }}>{DeleteSVG}</button>}</div>
      </div><div className={styles.content}><h3 dir="auto">{note.title}</h3><p dir="auto">{note.text}</p></div>
    </article>)}</div>
  </section>;
}

function NoteForm({ note, time, duration, pending, onSave, onCancel, onDelete }: { note?: VideoNote; time: number; duration: number; pending: boolean; onSave: (input: NoteInput) => Promise<void>; onCancel: () => void; onDelete?: () => void }) {
  const { t } = useI18n();
  const [title, setTitle] = useState(note?.title ?? "");
  const [text, setText] = useState(note?.text ?? "");
  const [timestamp, setTimestamp] = useState(() => noteTime(time));
  const [color, setColor] = useState(noteColors.some(option => option.key === note?.color) ? note!.color! : "blue");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending) return;
    const seconds = timestamp === noteTime(time) ? time : parseNoteTime(timestamp);
    if (seconds === null || (duration > 0 && seconds > duration)) { setError(t("notesInvalidTime")); return; }
    if (!title.trim() || !text.trim()) { setError(t("notesRequired")); return; }
    setError("");
    try { await onSave({ title: title.trim(), text: text.trim(), timestamp: seconds, color }); }
    catch { setError(t("notesSaveError")); }
  };
  return <form className={`${styles.card} ${styles.editing}`} style={{ "--note-color": noteColor(color) } as CSSProperties} onSubmit={submit} aria-label={t(note ? "notesEdit" : "notesAdd")} onKeyDown={event => {
    if (event.key === "Escape" && !pending) { event.stopPropagation(); onCancel(); }
  }}>
    <div className={styles.meta}>
      <input className={styles.timestamp} disabled={pending} required aria-label={t("notesTimestamp")} title={t("notesTimestamp")} size={Math.max(4, timestamp.length)} value={timestamp} onChange={event => setTimestamp(event.target.value)} placeholder="0:00" />
      <div className={styles.actions}>
        <button type="button" disabled={pending} aria-label={t("cancel")} title={t("cancel")} onClick={onCancel}>{CloseSVG}</button>
        {onDelete && <button type="button" className={styles.danger} disabled={pending} aria-label={t("notesDelete")} title={t("notesDelete")} onClick={onDelete}>{DeleteSVG}</button>}
      </div>
    </div>
    <div className={styles.content}>
      <input className={styles.titleInput} autoFocus disabled={pending} required maxLength={200} aria-label={t("title")} dir="auto" value={title} onChange={event => setTitle(event.target.value)} placeholder={t("notesTitlePlaceholder")} />
      <textarea className={styles.textInput} disabled={pending} required maxLength={10000} rows={3} aria-label={t("notesText")} dir="auto" value={text} onChange={event => setText(event.target.value)} placeholder={t("notesTextPlaceholder")} />
    </div>
    <div className={styles.editorFooter}>
      <div className={styles.colors} role="group" aria-label={t("notesColor")}>{noteColors.map(option => <button key={option.key} type="button" disabled={pending} aria-label={t(`notesColor.${option.key}`)} aria-pressed={color === option.key} style={{ "--note-color": `var(${option.variable})` } as CSSProperties} onClick={() => setColor(option.key)}><span /></button>)}</div>
      <div className={styles.editorButtons}>
        <button type="button" disabled={pending} className={styles.cancel} onClick={onCancel}>{t("cancel")}</button>
        <button type="submit" disabled={pending} className={styles.primary}>{t(pending ? "notesSaving" : "save")}</button>
      </div>
    </div>
    {error && <p className={`${styles.error} ${styles.editorError}`} role="alert">{error}</p>}
  </form>;
}
