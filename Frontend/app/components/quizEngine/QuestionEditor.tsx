import { useEffect, useId, useState } from 'react';
import { useI18n } from '~/i18n';
import { AddSVG, ArrowSVG, DeleteSVG } from '~/constants';
import { request } from './api';
import { Field, Select, Notice, LoadState, useAction, useAccess, useAll, useDetail, styles } from './shared';
import { typeLabels, type Question, type QuestionInput, type Category, type QuestionType } from './model';
import { questionReady } from './readiness';
import CategoryEditor from './CategoryEditor';
import EditorPopup from './EditorPopup';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';

function CreateCategoryPopup({ onCreated, onClose }: { onCreated: (category: Category) => void; onClose: () => void }) {
  const { t } = useI18n(), { confirm, dialogProps } = useConfirm();
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const guard = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);
  const close = async () => {
    if (dirty && !await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) return;
    onClose();
  };
  return <><EditorPopup open compact title={t('qeCreateCategory')} onClose={() => void close()}>
    <CategoryEditor id="new" onDirty={setDirty} onCreated={onCreated} onSaved={onClose} onClose={() => void close()} />
  </EditorPopup><ConfirmDialog {...dialogProps} /></>;
}

function move<T extends { position: number }>(rows: T[], index: number, direction: number): T[] {
  const next = [...rows], target = index + direction;
  if (target < 0 || target >= next.length) return rows;
  [next[index], next[target]] = [next[target], next[index]];
  return next.map((row, i) => ({ ...row, position: i + 1 }));
}
function OrderButtons({ index, count, onMove }: { index: number; count: number; onMove: (direction: number) => void }) {
  const { t } = useI18n();
  return <div className={styles.answerOrder}><button type="button" disabled={index === 0} aria-label={t('postMoveUp')} title={t('postMoveUp')} onClick={() => onMove(-1)}>{ArrowSVG}</button><button type="button" disabled={index === count - 1} aria-label={t('postMoveDown')} title={t('postMoveDown')} onClick={() => onMove(1)}>{ArrowSVG}</button></div>;
}
const emptyOptions = () => [1, 2].map(option_no => ({ option_no, content: '', position: option_no, is_correct: false }));
export default function QuestionEditor({ id, onSaved, onDirty, onClose }: { id: string; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void; onClose: () => void }) {
  const detail = useDetail<{ question: Question }>(`/questions/${id}`, id !== 'new');
  if (id !== 'new' && !detail.data) return <LoadState query={detail} variant="form" />;
  return <QuestionForm key={id} initial={detail.data?.question} onSaved={onSaved} onDirty={onDirty} onClose={onClose} />;
}
function QuestionForm({ initial, onSaved, onDirty, onClose }: { initial?: Question; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void; onClose: () => void }) {
  const { t } = useI18n(), access = useAccess('questions', initial), categoryAccess = useAccess('categories'), answerName = useId();
  const categories = useAll<Category>('/question-categories', 'categories', categoryAccess.read);
  const [creatingCategory, setCreatingCategory] = useState(false), [createdCategories, setCreatedCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<QuestionInput>(() => ({
    type: initial?.type ?? 'single_choice', content: initial?.content ?? '', explanation: initial?.explanation ?? null,
    options: [...(initial?.options ?? (initial ? [] : emptyOptions()))].sort((a, b) => a.position - b.position || a.option_no - b.option_no),
    matching_options: [...(initial?.matching_options ?? [])].sort((a, b) => a.position - b.position || a.option_no - b.option_no),
    matching_items: [...(initial?.matching_items ?? [])].sort((a, b) => a.position - b.position || a.item_no - b.item_no),
    category_id: initial?.category?.id ?? null,
  }));
  const [baseline, setBaseline] = useState(JSON.stringify(form));
  const action = useAction(), editable = initial ? access.update : access.create;
  const change = (patch: Partial<QuestionInput>) => { const next = { ...form, ...patch }; setForm(next); onDirty(JSON.stringify(next) !== baseline); };
  const matching = form.type === 'matching', options = matching ? form.matching_options : form.options;
  const setOptions = (next: typeof options) => change(matching ? { matching_options: next } : { options: next });
  const ownedCategories = [...new Map([...(initial?.category ? [initial.category] : []), ...createdCategories, ...(categories.data ?? []).filter(category => category.user_id === (initial?.user_id ?? access.user?.id))].map(category => [category.id, category])).values()];
  const [categoryHintDismissed, setCategoryHintDismissed] = useState(false);
  const categoryCreationHint = !categoryAccess.create ? 'qeCategoryCreatePermission' : initial && initial.user_id !== access.user?.id ? 'qeCategoryCreateOwnerOnly' : null;
  const ready = questionReady({ ...form, id: '', user_id: '', category: null });
  const optionRows = <div className="videoQuizOptions">{options.map((option, index) => <div className={`videoQuizOption ${option.is_correct && !matching ? 'selected' : ''} ${styles.answerRow}`} key={option.option_no}>
    {!matching && <input className={styles.answerMarker} type={form.type === 'single_choice' ? 'radio' : 'checkbox'} name={answerName} checked={!!option.is_correct} aria-label={`${t('quizCorrectAnswer')} ${index + 1}`} onChange={e => setOptions(options.map(o => ({ ...o, is_correct: o.option_no === option.option_no ? e.target.checked : form.type === 'single_choice' ? false : o.is_correct })))} />}
    <span className={styles.answerLetter}>{String.fromCharCode(65 + index % 26)}</span>
    <textarea className={styles.answerText} rows={1} placeholder={t('quizOptionNumber', { number: index + 1 })} aria-label={t('quizOptionNumber', { number: index + 1 })} value={option.content} onChange={e => setOptions(options.map(o => o.option_no === option.option_no ? { ...o, content: e.target.value } : o))} />
    <div className={styles.answerTools}><OrderButtons index={index} count={options.length} onMove={direction => setOptions(move(options, index, direction))} /><button type="button" className={`${styles.icon} ${styles.danger}`} aria-label={`${t('quizRemove')} ${index + 1}`} disabled={matching && form.matching_items.some(item => item.correct_option_no === option.option_no)} onClick={() => setOptions(options.filter(o => o.option_no !== option.option_no))}>{DeleteSVG}</button></div>
  </div>)}</div>;
  return <><form className={`quizPopupForm ${styles.settingsForm}`} onSubmit={event => { event.preventDefault(); void action.run(async () => {
    const { category_id, ...body } = form;
    const result = await request<{ question: Question }>(initial ? `/questions/${initial.id}` : '/questions', initial ? 'PATCH' : 'POST', { ...body, ...(categories.isSuccess || createdCategories.length > 0 ? { category_id } : {}) });
    setBaseline(JSON.stringify(form)); onDirty(false); onSaved(result.question.id);
  }); }}>
    <div className="quizPopupBody"><Notice {...action} /><fieldset disabled={action.busy || !editable}>
      <Field label={t('quizQuestionType')}><Select label={t('quizQuestionType')} placement="bottom" value={form.type} values={Object.entries(typeLabels).map(([value, key]) => ({ value, label: t(key) }))} onChange={value => change({ type: value as QuestionType, options: value === 'matching' ? [] : emptyOptions(), matching_options: value === 'matching' ? emptyOptions().map(({ is_correct, ...option }) => option) : [], matching_items: value === 'matching' ? [1, 2].map(item_no => ({ item_no, content: '', position: item_no, correct_option_no: item_no })) : [] })} /></Field>
      <section className={`videoQuizPage ${styles.questionCanvas}`} aria-label={t('quizQuestionText')}>
        <div className="videoQuizQuestionHeader"><textarea className={styles.questionPrompt} aria-label={t('quizQuestionText')} placeholder={t('quizQuestionTextPlaceholder')} rows={2} value={form.content} onChange={e => change({ content: e.target.value })} /></div>
        <p className={styles.answerHint}>{t(matching ? 'qeMatchingHelp' : form.type === 'single_choice' ? 'quizSingleCorrectHelp' : 'quizMultipleCorrectHelp')}</p>
        {matching ? <>
          <div className="videoQuizOptions">{form.matching_items.map((item, index) => <div className={`videoQuizMatchRow ${styles.matchRow}`} key={item.item_no}>
            <span className={styles.answerLetter}>{index + 1}</span><textarea className={styles.answerText} rows={1} placeholder={t('quizLeftTextNumber', { number: index + 1 })} aria-label={t('quizLeftTextNumber', { number: index + 1 })} value={item.content} onChange={e => change({ matching_items: form.matching_items.map(i => i.item_no === item.item_no ? { ...i, content: e.target.value } : i) })} />
            <Select label={t('quizCorrectAnswer')} value={item.correct_option_no} values={options.map(o => ({ value: o.option_no, label: o.content || t('quizOptionNumber', { number: o.option_no }) }))} onChange={value => change({ matching_items: form.matching_items.map(i => i.item_no === item.item_no ? { ...i, correct_option_no: Number(value) } : i) })} />
            <div className={styles.answerTools}><OrderButtons index={index} count={form.matching_items.length} onMove={direction => change({ matching_items: move(form.matching_items, index, direction) })} /><button type="button" className={`${styles.icon} ${styles.danger}`} aria-label={`${t('quizRemove')} ${index + 1}`} onClick={() => change({ matching_items: form.matching_items.filter(i => i.item_no !== item.item_no) })}>{DeleteSVG}</button></div>
          </div>)}</div>
          <button type="button" className={styles.partAdd} disabled={!options.length || Math.max(0, ...form.matching_items.map(i => i.item_no)) >= 32767} onClick={() => change({ matching_items: [...form.matching_items, { item_no: Math.max(0, ...form.matching_items.map(i => i.item_no)) + 1, position: Math.max(0, ...form.matching_items.map(i => i.position)) + 1, content: '', correct_option_no: options[0].option_no }] })}>{AddSVG}{t('quizAddPair')}</button>
          <h4 className={styles.sectionTitle}>{t('quizOptions')}</h4>{optionRows}
        </> : optionRows}
        <button type="button" className={styles.partAdd} disabled={Math.max(0, ...options.map(o => o.option_no)) >= 32767} onClick={() => setOptions([...options, { option_no: Math.max(0, ...options.map(o => o.option_no)) + 1, content: '', position: Math.max(0, ...options.map(o => o.position)) + 1, ...(!matching ? { is_correct: false } : {}) }])}>{AddSVG}{t('quizAddOption')}</button>
      </section>
      <Field label={t('quizExplanation')}><textarea className={styles.explanationText} aria-label={t('quizExplanation')} placeholder={t('quizExplanationPlaceholder')} rows={2} value={form.explanation ?? ''} onChange={e => change({ explanation: e.target.value || null })} /></Field>
      <Field label={t('qeCategory')}>
        {categoryAccess.read ? <><LoadState query={categories} variant="inline" />{(categories.isSuccess || createdCategories.length > 0) && <Select label={t('qeCategory')} value={form.category_id ?? ''} values={[{ value: '', label: t('qeUncategorized') }, ...ownedCategories.map(category => ({ value: category.id, label: category.name }))]} onChange={value => change({ category_id: value || null })} />}</> : <p className={styles.muted}>{initial?.category?.name || t('qeUncategorized')}</p>}
        {editable && <span className={styles.categoryCreateAction} tabIndex={categoryCreationHint ? 0 : undefined} aria-label={categoryCreationHint ? t('qeCreateCategory') : undefined} aria-describedby={categoryCreationHint ? `${answerName}-category-help` : undefined} data-hint-dismissed={categoryHintDismissed || undefined} onMouseEnter={() => setCategoryHintDismissed(false)} onFocus={() => setCategoryHintDismissed(false)} onKeyDown={event => { if (event.key === 'Escape' && categoryCreationHint) { event.preventDefault(); event.stopPropagation(); setCategoryHintDismissed(true); } }}>
          <button type="button" className={styles.partAdd} disabled={!!categoryCreationHint} onClick={() => setCreatingCategory(true)}>{AddSVG}{t('qeCreateCategory')}</button>
          {categoryCreationHint && <span role="tooltip" className={styles.categoryCreateTooltip} id={`${answerName}-category-help`}>{t(categoryCreationHint)}</span>}
        </span>}
      </Field>
      <p className={styles.answerHint}>{t(ready ? 'qeQuestionReady' : 'qeDraftQuestion')}</p>
    </fieldset></div>
    <div className="quizPopupActions"><button type="button" className="cancelBtn" disabled={action.busy} onClick={onClose}>{t('adminCancel')}</button>{editable && <button type="submit" className="saveCaptionsBtn" disabled={action.busy || (!!initial && JSON.stringify(form) === baseline)}>{t(action.busy ? 'saving' : 'quizSaveQuestion')}</button>}</div>
  </form>
    {creatingCategory && <CreateCategoryPopup onClose={() => setCreatingCategory(false)} onCreated={category => { setCreatedCategories(previous => [...previous, category]); change({ category_id: category.id }); }} />}
  </>;
}
