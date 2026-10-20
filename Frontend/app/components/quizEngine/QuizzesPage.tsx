'use client';
import '~/styles/editor.css';
import '~/styles/quiz.css';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import { AddSVG, DeleteSVG, EditSVG, SearchSVG } from '~/constants';
import Sidebar from '~/components/myVideosPage/sidebar/sidebar';
import Pagination from '~/components/library/pagination';
import ProfileTabs from '~/components/library/ProfileTabs';
import LibrarySortButton from '~/components/library/librarySortButton';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { engineKey, list, request } from './api';
import { resourcePaths, resourcePermission, typeLabels, type Resource, type Quiz, type Group, type Question } from './model';
import { Select, Notice, LoadState, useAction, useAccess, useAll, styles } from './shared';
import QuestionEditor from './QuestionEditor';
import GroupEditor from './GroupEditor';
import QuizEditor from './QuizEditor';
import EditorPopup from './EditorPopup';
const names = { quizzes: 'navQuizzes', questions: 'qeBank', groups: 'qeGroups' };
type Row = Partial<Quiz & Group & Question> & { id: string; user_id: string };
export default function QuizzesPage() {
  const { t } = useI18n(), [params] = useSearchParams(), navigateTo = useNavigate();
  const setParams = (values: Record<string, string>) => navigateTo(`/quizzes?${new URLSearchParams(values)}`, { preventScrollReset: true });
  const requested = params.get('tab') as Resource | null;
  const auth = useAccess('quizzes');
  const allowed = (Object.keys(names) as Resource[]).filter(resource => ['create', 'read_own', 'read_any'].some(action => auth.can(resourcePermission(resource, action))));
  const resource: Resource = requested && allowed.includes(requested) ? requested : allowed[0] ?? 'quizzes';
  const access = useAccess(resource); const editor = params.get('edit');
  const [dirty, setDirty] = useState(false), { confirm, dialogProps } = useConfirm();
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const navigate = async (tab: Resource, id?: string) => {
    if (dirty && !await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) return;
    setDirty(false); setParams({ tab, ...(id ? { edit: id } : {}) });
  };
  const saved = (id: string) => { if (resource === 'quizzes') { setDirty(false); setParams({ tab: resource }); return; } if (editor === 'new') { setDirty(false); setParams({ tab: resource, ...(access.read ? { edit: id } : {}) }); } };
  const popupTitle = resource === 'quizzes' ? t(editor === 'new' ? 'quizCreateTitle' : 'quizEditTitle') : resource === 'questions' ? t(editor === 'new' ? 'quizAddQuestion' : 'quizEditQuestion') : t(editor === 'new' ? 'qeCreateGroup' : 'qeGroups');
  return <main className={`myVideos managementPage ${styles.page} ${styles.management}`}><Sidebar /><div className="content libraryContent"><div className="holder libraryShell">
    <div className="libraryHeader"><div className="libraryHeading"><h1>{t(names[resource])}</h1><p>{t('qeIntro')}</p></div></div>
    <ProfileTabs className={styles.resourceTabs} label={t('navQuizzes')}>{allowed.map(tab => <button type="button" role="tab" key={tab} aria-selected={resource === tab} onClick={() => void navigate(tab)}>{t(names[tab])}</button>)}</ProfileTabs>
    <ResourceList key={resource} resource={resource} onEdit={id => void navigate(resource, id)} />
    <EditorPopup wide={resource === 'questions'} open={!!editor} title={popupTitle} description={resource === 'quizzes' ? t('qeIntro') : undefined} onClose={() => void navigate(resource)}>
      {editor && (resource === 'quizzes' ? <QuizEditor key={editor} id={editor} onSaved={saved} onDirty={setDirty} onClose={() => void navigate(resource)} /> : resource === 'questions' ? <QuestionEditor key={editor} id={editor} onSaved={saved} onDirty={setDirty} onClose={() => void navigate(resource)} /> : <GroupEditor key={editor} id={editor} onSaved={saved} onDirty={setDirty} />)}
    </EditorPopup>
    <ConfirmDialog {...dialogProps} />
  </div></div></main>;

}

function ResourceList({ resource, onEdit }: { resource: Resource; onEdit: (id: string) => void }) {
  const { t, locale } = useI18n(), access = useAccess(resource), groupAccess = useAccess('groups');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState(''), [status, setStatus] = useState(''), [type, setType] = useState(''), [group, setGroup] = useState('');
  const [page, setPage] = useState(1), [limit, setLimit] = useState(20), [sort, setSort] = useState(resource === 'groups' ? 'name' : 'created_at'), [order, setOrder] = useState('desc');
  const [selected, setSelected] = useState<string[]>([]), selectAll = useRef<HTMLInputElement>(null);
  const action = useAction(), { confirm, dialogProps } = useConfirm(); const token = getToken();
  useEffect(() => { const timer = setTimeout(() => { setSearch(filter.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [filter]);
  useEffect(() => setSelected([]), [page, limit, search, status, type, group, sort, order]);
  const params: Record<string, string | number> = { page, limit, sortBy: sort, sortOrder: order };
  if (resource === 'quizzes') { if (search) params.title = search; if (status) params.status = status; }
  if (resource === 'groups' && search) params.name = search;
  if (resource === 'questions') { if (type) params.type = type; if (group) params.group_id = group; }
  const query = useQuery({ queryKey: [...engineKey, token, access.user?.id, resource, params], enabled: !!token && access.read, retry: false,
    queryFn: ({ signal }) => list<Row>(resourcePaths[resource], resource, params, signal) });
  const groups = useAll<Group>('/question-groups', 'groups', resource === 'questions' && groupAccess.read);
  const rows = query.data?.items ?? [];
  const deletable = rows.filter(row => access.canOwn(resourcePermission(resource, 'delete_own'), resourcePermission(resource, 'delete_any'), row.user_id));
  const checked = deletable.length > 0 && deletable.every(row => selected.includes(row.id));
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selected.length > 0 && !checked; }, [selected, checked]);
  const remove = async (ids: string[]) => {
    if (!await confirm({ title: t('adminDelete'), message: t(resource === 'quizzes' ? 'qeDeleteQuiz' : resource === 'questions' ? 'qeDeleteQuestion' : 'qeDeleteGroup'), yesText: t('adminDelete'), noText: t('adminCancel') })) return;
    await action.run(async () => { for (const id of ids) { await request(`${resourcePaths[resource]}/${id}`, 'DELETE'); setSelected(current => current.filter(value => value !== id)); } });
  };
  const createLabel = t(resource === 'quizzes' ? 'createQuiz' : resource === 'questions' ? 'quizAddQuestion' : 'qeCreateGroup');
  const sortHeading = (column: string, label: string) => <th className={`sortable ${sort === column ? 'active' : ''}`} aria-sort={sort === column ? order === 'asc' ? 'ascending' : 'descending' : 'none'}><LibrarySortButton label={t(label)} direction={sort === column ? order as 'asc' | 'desc' : null} onClick={() => { setSort(column); setOrder(sort === column && order === 'asc' ? 'desc' : 'asc'); setPage(1); }} /></th>;
  const date = (value?: string) => value ? new Date(value).toLocaleDateString(locale === 'sr' ? 'sr-Latn' : locale, { dateStyle: 'medium' }) : '—';
  const checkbox = styles.checkbox;
  return <>
    <Notice {...action} /><div className={`managementToolbar ${styles.listToolbar}`}>
      {resource !== 'questions' && access.read && <div className="filter">{SearchSVG}<input type="search" value={filter} aria-label={t(resource === 'quizzes' ? 'filterQuizzes' : 'qeFilterGroups')} placeholder={t(resource === 'quizzes' ? 'filterQuizzes' : 'qeFilterGroups')} onChange={e => setFilter(e.target.value)} /></div>}
      <div className={styles.listFilters}>
        {access.read && resource === 'quizzes' && <Select label={t('adminTableStatus')} value={status} values={[{ value: '', label: t('qeAllStatuses') }, ...['draft', 'published', 'archived'].map(value => ({ value, label: t(`qe${value[0].toUpperCase()}${value.slice(1)}`) }))]} onChange={value => { setStatus(value); setPage(1); }} />}
        {access.read && resource === 'questions' && <><Select label={t('quizQuestionType')} value={type} values={[{ value: '', label: t('qeAllTypes') }, ...Object.entries(typeLabels).map(([value, key]) => ({ value, label: t(key) }))]} onChange={value => { setType(value); setPage(1); }} />{groupAccess.read && <Select label={t('qeGroups')} value={group} values={[{ value: '', label: t('qeAllGroups') }, ...(groups.data ?? []).map(g => ({ value: g.id, label: g.name }))]} onChange={value => { setGroup(value); setPage(1); }} />}</>}
        {access.create && <button type="button" className="playlistAddBtn" title={createLabel} aria-label={createLabel} onClick={() => onEdit('new')}>{AddSVG}</button>}
      </div>
    </div>
    {!access.read ? <p className={styles.note}>{t('qeNoRead')}</p> : <>
    {selected.length > 0 && <div className={styles.bulkActions}><span>{t('postSelectedCount', { count: selected.length })}</span><button type="button" className={`${styles.button} ${styles.danger}`} disabled={action.busy} onClick={() => void remove(selected)}>{DeleteSVG}{t('adminDelete')}</button></div>}
    <LoadState query={query} />
    {query.data && <div className={`libraryTableWrap ${styles.listTableWrap}`} aria-busy={query.isFetching}><table className={styles.listTable}><thead><tr>
      <th className="notHoverable"><span><input className={checkbox} ref={selectAll} type="checkbox" aria-label={t('qeSelectAll')} checked={checked} disabled={action.busy || !deletable.length} onChange={e => setSelected(e.target.checked ? deletable.map(row => row.id) : [])} /><LibrarySortButton label={t(resource === 'questions' ? 'quizQuestionText' : 'title')} direction={sort === (resource === 'questions' ? 'content' : resource === 'groups' ? 'name' : 'title') ? order as 'asc' | 'desc' : null} onClick={() => { const column = resource === 'questions' ? 'content' : resource === 'groups' ? 'name' : 'title'; setOrder(sort === column && order === 'asc' ? 'desc' : 'asc'); setSort(column); setPage(1); }} /></span></th>
      {resource === 'groups' ? <th className="notHoverable">{t('description')}</th> : sortHeading(resource === 'quizzes' ? 'status' : 'type', resource === 'quizzes' ? 'adminTableStatus' : 'quizQuestionType')}
      {resource !== 'groups' && <>{sortHeading('created_at', 'adminTableDate')}{sortHeading('updated_at', 'usersUpdated')}</>}
    </tr></thead><tbody>
      {rows.map(row => <tr key={row.id}><td><div className={styles.listIdentity}>
        <input className={checkbox} type="checkbox" aria-label={`${t('quizSelect')}: ${row.title || row.name || row.content || row.id}`} disabled={action.busy || !deletable.some(item => item.id === row.id)} checked={selected.includes(row.id)} onChange={e => setSelected(e.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} />
        <div className={styles.listInfo}><button type="button" className={styles.rowTitle} onClick={() => onEdit(row.id)}>{row.title || row.name || row.content || t('qeUntitledQuestion')}</button>
          {resource === 'questions' ? <p className="quizRowDescription">{row.groups?.map(g => g.name).join(', ')}</p> : resource === 'quizzes' && <p className="quizRowDescription">{t('quizQuestionsCount', { count: row.question_count ?? 0 })}</p>}
          <div className="managementRowActions"><button type="button" aria-label={`${t('adminOpen')}: ${row.title || row.name || row.content}`} title={t('adminOpen')} onClick={() => onEdit(row.id)}>{EditSVG}</button>{deletable.some(item => item.id === row.id) && <button type="button" className="danger" disabled={action.busy} aria-label={`${t('adminDelete')}: ${row.title || row.name || row.content}`} title={t('adminDelete')} onClick={() => void remove([row.id])}>{DeleteSVG}</button>}</div>
        </div></div></td>
        <td>{resource === 'questions' ? <span className="managementStatus">{t(typeLabels[row.type!])}</span> : resource === 'groups' ? row.description : <span className={`managementStatus ${row.status === 'published' ? 'active' : ''}`}>{t(`qe${row.status![0].toUpperCase()}${row.status!.slice(1)}`)}</span>}</td>
        {resource !== 'groups' && <><td><time dateTime={row.created_at}>{date(row.created_at)}</time></td><td><time dateTime={row.updated_at}>{date(row.updated_at)}</time></td></>}
      </tr>)}
      {!rows.length && <tr><td colSpan={resource === 'groups' ? 2 : 4} className={styles.empty}>{t('adminZeroResults')}</td></tr>}
    </tbody></table></div>}
    <Pagination page={page} limit={limit} total={query.data?.pagination.total} totalPages={query.data?.pagination.totalPages} loading={query.isFetching} disabled={action.busy} label={t(names[resource])} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
    </>}
    <ConfirmDialog {...dialogProps} />
  </>;
}
