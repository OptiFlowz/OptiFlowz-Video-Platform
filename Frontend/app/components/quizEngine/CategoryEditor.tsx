import { useEffect, useRef, useState } from 'react';
import { useI18n } from '~/i18n';
import { AddSVG, DeleteSVG, EditSVG, MatchingQuestionSVG, MultipleChoiceQuestionSVG, SearchSVG, SingleChoiceQuestionSVG } from '~/constants';
import Pagination from '~/components/library/pagination';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { request } from './api';
import { Field, Notice, LoadState, useAction, useAccess, useAll, useDetail, styles } from './shared';
import { typeLabels, type Category, type Question } from './model';
import { reconcileCategoryMembers, sameCategoryMembers } from './categoryMembership';
import QuestionEditor from './QuestionEditor';
import EditorPopup, { EditorActions } from './EditorPopup';

type CategoryCallbacks = { onSaved: (id: string) => void; onDirty: (dirty: boolean) => void; onCreated?: (category: Category) => void; onClose?: () => void; presentation?: 'page' | 'popup' };
const questionIcons = { single_choice: SingleChoiceQuestionSVG, multiple_choice: MultipleChoiceQuestionSVG, matching: MatchingQuestionSVG };
export default function CategoryEditor({ id, presentation = 'popup', ...callbacks }: CategoryCallbacks & { id: string }) {
  const { t } = useI18n();
  const detail = useDetail<{ category: Category }>(`/question-categories/${id}`, id !== 'new');
  const content = id !== 'new' && !detail.data ? <LoadState query={detail} variant="form" /> : <CategoryForm key={id} initial={detail.data?.category} presentation={presentation} {...callbacks} />;
  if (presentation === 'popup') return content;
  return <div className={`${styles.page} ${styles.editorPage}`}>
    <div className="libraryHeader"><div className="libraryHeading"><h1>{detail.data?.category.name || t(id === 'new' ? 'qeCreateCategory' : 'qeEditCategory')}</h1><p>{t('qeCategoryPageHelp')}</p></div></div>
    {content}
  </div>;
}
function CategoryForm({ initial, onSaved, onDirty, onCreated, onClose, presentation }: CategoryCallbacks & { initial?: Category }) {
  const { t } = useI18n(), access = useAccess('categories', initial), questionAccess = useAccess('questions');
  const questions = useAll<Question>('/questions', 'questions', !!initial && questionAccess.read);
  const [name, setName] = useState(initial?.name ?? ''), [description, setDescription] = useState(initial?.description ?? '');
  const [ids, setIds] = useState(initial?.questions?.map(q => q.id) ?? []), [filter, setFilter] = useState('');
  const [baseline, setBaseline] = useState(JSON.stringify([name, description]));
  const [memberBaseline, setMemberBaseline] = useState(ids);
  const previousMembers = useRef(initial?.questions);
  const [page, setPage] = useState(1), [limit, setLimit] = useState(20);
  const [addingQuestions, setAddingQuestions] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<string | null>(null), [questionDirty, setQuestionDirty] = useState(false);
  const { confirm, dialogProps } = useConfirm();
  const action = useAction(), editable = initial ? access.update : access.create;
  const dirty = JSON.stringify([name, description]) !== baseline || !sameCategoryMembers(ids, memberBaseline);
  useEffect(() => { onDirty(dirty || questionDirty); }, [dirty, questionDirty, onDirty]);
  // Question edits can change category membership. Preserve any unsaved selections
  // while incorporating the refreshed server list instead of putting removed questions back.
  useEffect(() => {
    if (previousMembers.current === initial?.questions) return;
    previousMembers.current = initial?.questions;
    const refreshed = initial?.questions?.map(q => q.id) ?? [];
    setIds(current => reconcileCategoryMembers(memberBaseline, current, refreshed));
    setMemberBaseline(refreshed);
  }, [initial?.questions, memberBaseline]);
  const candidates = [...new Map([...(initial?.questions ?? []), ...(questions.data ?? [])].map(q => [q.id, q])).values()].filter(q => q.user_id === (initial?.user_id ?? access.user?.id));
  const filtered = candidates.filter(q => ids.includes(q.id) && q.content.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / limit)));
  const closeQuestion = async () => {
    if (questionDirty && !await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) return;
    setQuestionDirty(false); setEditingQuestion(null);
  };
  return <><form className={`quizPopupForm ${styles.settingsForm}`} onSubmit={e => { e.preventDefault(); e.stopPropagation(); void action.run(async () => {
    const result = await request<{ category: Category }>(initial ? `/question-categories/${initial.id}` : '/question-categories', initial ? 'PATCH' : 'POST', { name: name.trim(), description: description.trim() || null });
    if (!initial) { onDirty(false); onCreated?.(result.category); onSaved(result.category.id); return; }
    if (!sameCategoryMembers(ids, memberBaseline)) await request(`/question-categories/${result.category.id}/questions`, 'PUT', { question_ids: ids });
    setBaseline(JSON.stringify([name, description])); setMemberBaseline(ids); onDirty(false);
  }); }}>
    <div className="quizPopupBody"><Notice {...action} />
      <fieldset className={presentation === 'page' ? `${styles.settingsSection} ${styles.categoryDetails}` : styles.panel} disabled={action.busy || !editable}>
        <Field label={t('title')}><input aria-label={t('title')} required maxLength={255} value={name} onChange={e => setName(e.target.value)} /></Field>
        <Field label={t('description')}><textarea aria-label={t('description')} rows={3} value={description} onChange={e => setDescription(e.target.value)} /></Field>
      </fieldset>
      {initial && <section className={styles.categoryQuestions}>
        <div className={styles.categoryQuestionsHeading}><h2>{t('quizQuestions')} <span>{ids.length}</span></h2></div>
        <div className={`managementToolbar ${styles.listToolbar}`}>
          <div className="filter">{SearchSVG}<input type="search" aria-label={t('qeFilterQuestions')} placeholder={t('qeFilterQuestions')} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} /></div>
          {editable && questionAccess.read && <button type="button" className={styles.button} disabled={action.busy} onClick={() => setAddingQuestions(true)}>{AddSVG}{t('qeCategoryAllQuestions')}</button>}
        </div>
        {questionAccess.read && <LoadState query={questions} />}
        <div className={`libraryTableWrap ${styles.listTableWrap}`}><table className={`${styles.listTable} ${styles.categoryQuestionsTable}`}><thead><tr><th>{t('quizQuestionText')}</th><th>{t('quizQuestionType')}</th><th><span className={styles.srOnly}>{t('qeQuestionActions')}</span></th></tr></thead><tbody>
          {filtered.slice((currentPage - 1) * limit, currentPage * limit).map(q => {
            const canEdit = questionAccess.read && questionAccess.canOwn('questions.update_own', 'questions.update_any', q.user_id);
            return <tr key={q.id} data-question-type={q.type}><td><div className={styles.listIdentity}>
              <span className={styles.quizThumbnail} aria-hidden="true">{questionIcons[q.type]}</span><span className={styles.categoryQuestionText}>{q.content || t('qeUntitledQuestion')}</span>
            </div></td><td data-label={t('quizQuestionType')}><span className={`managementStatus ${styles.questionTypeBadge}`}>{t(typeLabels[q.type])}</span></td><td><div className="managementRowActions">{canEdit && <button type="button" disabled={action.busy} title={t('adminEdit')} aria-label={`${t('adminEdit')}: ${q.content}`} onClick={() => setEditingQuestion(q.id)}>{EditSVG}</button>}{editable && <button type="button" className={styles.categoryRemove} disabled={action.busy} title={t('qeRemoveFromCategory')} aria-label={`${t('qeRemoveFromCategory')}: ${q.content}`} onClick={() => setIds(current => current.filter(id => id !== q.id))}>{DeleteSVG}</button>}</div></td></tr>;
          })}
          {!filtered.length && <tr><td colSpan={3} className={styles.empty}>{t('adminZeroResults')}</td></tr>}
        </tbody></table></div>
        <Pagination page={currentPage} limit={limit} total={filtered.length} disabled={action.busy} label={t('quizQuestions')} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
      </section>}
    </div>
    <EditorActions>{onClose && presentation !== 'page' && <button type="button" className="cancelBtn" disabled={action.busy} onClick={onClose}>{t('adminCancel')}</button>}{editable && <button type="submit" className="saveCaptionsBtn" disabled={action.busy || !name.trim() || (!!initial && !dirty)}>{t(action.busy ? 'saving' : 'saveChanges')}</button>}</EditorActions>
  </form>
    <EditorPopup wide open={addingQuestions} title={t('qeCategoryAllQuestions')} description={t('qeCategoryAddHelp')} onClose={() => setAddingQuestions(false)}>
      {addingQuestions && <CategoryQuestionPicker questions={candidates.filter(q => !ids.includes(q.id))} onAdd={id => setIds(current => current.includes(id) ? current : [...current, id])} onClose={() => setAddingQuestions(false)} />}
    </EditorPopup>
    <EditorPopup wide open={!!editingQuestion} title={t('quizEditQuestion')} onClose={() => void closeQuestion()}>
      {editingQuestion && <QuestionEditor key={editingQuestion} id={editingQuestion} onDirty={setQuestionDirty} onClose={() => void closeQuestion()} onSaved={() => { setQuestionDirty(false); setEditingQuestion(null); }} />}
    </EditorPopup><ConfirmDialog {...dialogProps} />
  </>;
}

function CategoryQuestionPicker({ questions, onAdd, onClose }: { questions: Question[]; onAdd: (id: string) => void; onClose: () => void }) {
  const { t } = useI18n();
  const [filter, setFilter] = useState(''), [page, setPage] = useState(1), [limit, setLimit] = useState(10);
  const filtered = questions.filter(q => q.content.toLocaleLowerCase().includes(filter.trim().toLocaleLowerCase()));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(filtered.length / limit)));
  return <div className="quizPopupForm">
    <div className={`quizPopupBody ${styles.categoryBank}`}>
      <input type="search" aria-label={t('qeFilterQuestions')} placeholder={t('qeFilterQuestions')} value={filter} onChange={e => { setFilter(e.target.value); setPage(1); }} />
      <div className={`${styles.listTable} ${styles.categoryBankList}`}>
        {filtered.slice((currentPage - 1) * limit, currentPage * limit).map(q => <div key={q.id} data-question-type={q.type} className={styles.categoryBankRow}>
          <span className={styles.quizThumbnail} aria-hidden="true">{questionIcons[q.type]}</span>
          <div className={styles.categoryBankText}><p>{q.content || t('qeUntitledQuestion')}</p><span>{t(typeLabels[q.type])} · {q.category?.name || t('qeUncategorized')}</span></div>
          <button type="button" className={`${styles.icon} ${styles.addIcon}`} title={t('qeAddToCategory')} aria-label={`${t('qeAddToCategory')}: ${q.content}`} onClick={() => onAdd(q.id)}>{AddSVG}</button>
        </div>)}
        {!filtered.length && <p className={styles.empty}>{t('adminZeroResults')}</p>}
      </div>
      <Pagination page={currentPage} limit={limit} total={filtered.length} label={t('quizQuestions')} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
    </div>
    <EditorActions><button type="button" className="cancelBtn" onClick={onClose}>{t('close')}</button></EditorActions>
  </div>;
}
