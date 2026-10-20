import { useState } from 'react';
import { useI18n } from '~/i18n';
import { request } from './api';
import { Field, Save, Notice, LoadState, useAction, useAccess, useAll, useDetail, styles } from './shared';
import type { Group, Question } from './model';
export default function GroupEditor({ id, onSaved, onDirty }: { id: string; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void }) {
  const detail = useDetail<{ group: Group }>(`/question-groups/${id}`, id !== 'new');
  if (id !== 'new' && !detail.data) return <LoadState query={detail} variant="form" />;
  return <GroupForm key={id} initial={detail.data?.group} onSaved={onSaved} onDirty={onDirty} />;
}
function GroupForm({ initial, onSaved, onDirty }: { initial?: Group; onSaved: (id: string) => void; onDirty: (dirty: boolean) => void }) {
  const { t } = useI18n(), access = useAccess('groups', initial), questionAccess = useAccess('questions');
  const questions = useAll<Question>('/questions', 'questions', questionAccess.read);
  const [name, setName] = useState(initial?.name ?? ''), [description, setDescription] = useState(initial?.description ?? '');
  const [ids, setIds] = useState(initial?.questions?.map(q => q.id) ?? []), [filter, setFilter] = useState('');
  const [baseline, setBaseline] = useState(JSON.stringify([name, description, ids]));
  const action = useAction(), editable = initial ? access.update : access.create;
  // Include every original member, even when the question bank permission exposes fewer questions.
  const candidates = [...new Map([...(initial?.questions ?? []), ...(questions.data ?? [])].map(q => [q.id, q])).values()].filter(q => q.user_id === (initial?.user_id ?? access.user?.id));
  const dirty = (n = name, d = description, next = ids) => onDirty(JSON.stringify([n, d, next]) !== baseline);
  return <form className={styles.panel} onSubmit={e => { e.preventDefault(); void action.run(async () => {
    const result = await request<{ group: Group }>(initial ? `/question-groups/${initial.id}` : '/question-groups', initial ? 'PATCH' : 'POST', { name: name.trim(), description: description.trim() || null });
    // A failed membership write must not cause a retry to create a second group.
    if (!initial) { onDirty(false); onSaved(result.group.id); return; }
    if (JSON.stringify(ids) !== JSON.stringify(initial.questions?.map(q => q.id) ?? [])) await request(`/question-groups/${result.group.id}/questions`, 'PUT', { question_ids: ids });
    setBaseline(JSON.stringify([name, description, ids])); onDirty(false);
  }); }}>
    <Notice {...action} /><fieldset disabled={action.busy || !editable}>
    <Field label={t('title')}><input aria-label={t('title')} required maxLength={255} value={name} onChange={e => { setName(e.target.value); dirty(e.target.value); }} /></Field>
    <Field label={t('description')}><textarea aria-label={t('description')} value={description} onChange={e => { setDescription(e.target.value); dirty(name, e.target.value); }} /></Field>
    {initial && <><h2>{t('quizQuestions')} ({ids.length})</h2><p className={styles.note}>{t('qeMembershipHelp')}</p>
      {questionAccess.read && <LoadState query={questions} />}
      <input type="search" aria-label={t('qeFilterQuestions')} placeholder={t('qeFilterQuestions')} value={filter} onChange={e => setFilter(e.target.value)} />
      <div className={styles.picker}>{candidates.filter(q => q.content.toLowerCase().includes(filter.toLowerCase())).map(q => <label className={styles.check} key={q.id}><input type="checkbox" checked={ids.includes(q.id)} onChange={e => { const next = e.target.checked ? [...ids, q.id] : ids.filter(id => id !== q.id); setIds(next); dirty(name, description, next); }} />{q.content || t('qeUntitledQuestion')}</label>)}</div>
    </>}
    {editable && <Save busy={action.busy} disabled={!name.trim() || (!!initial && JSON.stringify([name, description, ids]) === baseline)} />}
    </fieldset>
  </form>;
}
