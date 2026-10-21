import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { UploadSVG } from '~/constants';
import { engineKey } from './api';
import { typeLabels, type Category, type QuestionType } from './model';
import { Field, FieldHelp, Select, LoadState, useAccess, useAll, styles } from './shared';
import EditorPopup, { EditorActions } from './EditorPopup';
import { downloadQuestions, exportQuestions, importQuestions, validQuestionFile, type ImportResult } from './transferApi';

export default function QuestionTransfer({ mode, selectedIds, onClose }: { mode: 'import' | 'export'; selectedIds: string[]; onClose: () => void }) {
  const { t } = useI18n(), client = useQueryClient(), access = useAccess('categories');
  const categories = useAll<Category>('/question-categories', 'categories', access.read);
  const [file, setFile] = useState<File | null>(null), [category, setCategory] = useState(''), [type, setType] = useState<QuestionType | ''>('');
  const [selection, setSelection] = useState(selectedIds.length > 0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null), [open, setOpen] = useState(true);
  const lock = useRef(false), importing = mode === 'import';
  const formatHelp = `Moodle XML (.xml) · ≤ 5 MiB · ${t('quizQuestionsCount', { count: '≤ 1000' })}`;
  const ownCategories = (categories.data ?? []).filter(row => row.user_id === access.user?.id);
  const close = () => { if (!lock.current) setOpen(false); };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (lock.current || result) return;
    if (importing && (!file || !validQuestionFile(file))) { setError(formatHelp); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      if (importing) {
        const response = await importQuestions(file!, category);
        setResult(response);
        void client.invalidateQueries({ queryKey: engineKey });
      } else {
        downloadQuestions(await exportQuestions(selection ? { questionIds: selectedIds } : { categoryId: category, type }));
        setOpen(false);
      }
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('quizError')); }
    finally { lock.current = false; setBusy(false); }
  }
  return <EditorPopup open={open} compact title={t(importing ? 'qeImportQuestions' : 'qeExportQuestions')} onClose={close} onAfterClose={onClose}>
    <form className={`quizPopupForm ${styles.settingsForm}`} onSubmit={event => void submit(event)}>
      <div className={`quizPopupBody ${styles.transferBody}`}>
        <p className={styles.transferFormat}>{formatHelp} <FieldHelp label={t(importing ? 'qeImportQuestions' : 'qeExportQuestions')} help={t(importing ? 'qeImportCreatesNew' : 'qeExportOwnBank')} /></p>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        {result ? <div role="status"><p className={styles.success}>{t('qeImportedQuestions', { count: result.imported_count })}</p>
          {!!result.warnings.length && <ul className={styles.transferWarnings}>{result.warnings.map((warning, index) => <li key={index}>{t('quizQuestionPosition', { current: warning.question, total: result.imported_count })}: {warning.message}</li>)}</ul>}
        </div> : <fieldset disabled={busy}>
          {importing ? <>
            <label className={styles.fileDropzone}>
              <input type="file" accept=".xml,application/xml,text/xml" required aria-label={t('uploadSelectFile')} onChange={event => { setFile(event.target.files?.[0] ?? null); setError(''); }} />
              <span className={styles.fileDropzoneIcon} aria-hidden="true">{UploadSVG}</span>
              <strong className={styles.fileDropzoneName}>{file ? file.name : t('uploadSelectFile')}</strong>
              <span className={styles.fileDropzoneHint}>Moodle XML (.xml) · ≤ 5 MiB</span>
            </label>
          </> : <>
            {!!selectedIds.length && <label className="quizPopupToggleRow check"><strong>{t('postSelectedCount', { count: selectedIds.length })}</strong><input type="checkbox" checked={selection} onChange={event => setSelection(event.target.checked)} /></label>}
          </>}
          {(importing || !selection) && <>
            {access.read && <><LoadState query={categories} variant="inline" /><Field label={t('qeCategory')}><Select label={t('qeCategory')} value={category} values={[{ value: '', label: t(importing ? 'qeCategoriesFromFile' : 'qeAllCategories') }, ...ownCategories.map(row => ({ value: row.id, label: row.name }))]} onChange={setCategory} /></Field></>}
            {!importing && <Field label={t('quizQuestionType')}><Select label={t('quizQuestionType')} value={type} values={[{ value: '', label: t('qeAllTypes') }, ...Object.entries(typeLabels).map(([value, key]) => ({ value, label: t(key) }))]} onChange={value => setType(value as QuestionType | '')} /></Field>}
          </>}
        </fieldset>}
      </div>
      <EditorActions><button type="button" className="cancelBtn" disabled={busy} onClick={close}>{t(result ? 'close' : 'adminCancel')}</button>
        {!result && <button type="submit" className="saveCaptionsBtn" disabled={busy || (importing && !file) || (!importing && selection && selectedIds.length > 1000)}>{t(busy ? 'saving' : importing ? 'qeImportQuestions' : 'qeExportQuestions')}</button>}
      </EditorActions>
    </form>
  </EditorPopup>;
}
