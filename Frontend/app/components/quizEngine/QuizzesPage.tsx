'use client';
import '~/styles/editor.css';
import '~/styles/quiz.css';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useI18n } from '~/i18n';
import { getToken } from '~/functions';
import { AddSVG, CollectionsSVG, DeleteSVG, EditSVG, MatchingQuestionSVG, MultipleChoiceQuestionSVG, QuestionSVG, QuizSVG, SearchSVG, SingleChoiceQuestionSVG } from '~/constants';
import Sidebar from '~/components/myVideosPage/sidebar/sidebar';
import Pagination from '~/components/library/pagination';
import ProfileTabs from '~/components/library/ProfileTabs';
import LibrarySortButton from '~/components/library/librarySortButton';
import { ConfirmDialog } from '~/components/confirmPopup/confirmDialog';
import { useConfirm } from '~/components/confirmPopup/useConfirm';
import { all, engineKey, list, request } from './api';
import { filterQuestionPage } from './questionFilter';
import { resourcePaths, resourcePermission, typeLabels, type Resource, type Quiz, type Category, type Question } from './model';
import { Select, Notice, LoadState, useAction, useAccess, useAll, styles } from './shared';
import QuestionEditor from './QuestionEditor';
import CategoryEditor from './CategoryEditor';
import QuizEditor from './QuizEditor';
import QuizStatus from './QuizStatus';
import EditorPopup, { EditorBusyContext, EditorBusyStatusContext } from './EditorPopup';
const questionIcons = { single_choice: SingleChoiceQuestionSVG, multiple_choice: MultipleChoiceQuestionSVG, matching: MatchingQuestionSVG };
const names = { quizzes: 'navQuizzes', questions: 'qeBank', categories: 'qeCategories' };
type Row = Partial<Quiz & Category & Question> & { id: string; user_id: string };
export default function QuizzesPage() {
  const { t } = useI18n(), [params] = useSearchParams(), navigateTo = useNavigate();
  const setParams = (values: Record<string, string>) => navigateTo(`/quizzes?${new URLSearchParams(values)}`, { preventScrollReset: values.tab === 'questions' || !!params.get('edit') && values.edit === params.get('edit') });
  const requested = (params.get('tab') === 'groups' ? 'categories' : params.get('tab')) as Resource | null;
  const auth = useAccess('quizzes');
  const allowed = (Object.keys(names) as Resource[]).filter(resource => ['create', 'read_own', 'read_any'].some(action => auth.can(resourcePermission(resource, action))));
  const resource: Resource = requested && allowed.includes(requested) ? requested : allowed[0] ?? 'quizzes';
  const access = useAccess(resource); const editor = params.get('edit');
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false), { confirm, dialogProps } = useConfirm();
  useEffect(() => {
    if (!dirty) return;
    const handler = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', handler); return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);
  const navigate = async (tab: Resource, id?: string, section?: string, category?: string) => {
    if (busy) return;
    if (dirty && !await confirm({ title: t('qeUnsaved'), message: t('qeDiscard'), yesText: t('qeDiscardAction'), noText: t('adminCancel') })) return;
    setDirty(false); setParams({ tab, ...(id ? { edit: id } : {}), ...(section ? { section } : {}), ...(category ? { category } : {}) });
  };
  const saved = (id: string) => {
    setDirty(false);
    if (editor === 'new') setParams({ tab: resource, ...(access.read ? { edit: id } : {}) });
  };
  const editorPage = (resource === 'quizzes' || resource === 'categories') && !!editor;
  const popupTitle = resource === 'quizzes' ? t(editor === 'new' ? 'quizCreateTitle' : 'quizEditTitle') : resource === 'questions' ? t(editor === 'new' ? 'quizAddQuestion' : 'quizEditQuestion') : t(editor === 'new' ? 'qeCreateCategory' : 'qeEditCategory');
  return <main className={`myVideos managementPage ${styles.page} ${styles.management}`}><Sidebar /><div className="content libraryContent"><div className="holder libraryShell">
    {editorPage ? <EditorBusyContext.Provider value={setBusy}><EditorBusyStatusContext.Provider value={busy}>
      <div className={styles.editorBreadcrumb}><button type="button" disabled={busy} onClick={() => void navigate(resource)}>{t(names[resource])}</button><span aria-hidden="true">/</span><span>{popupTitle}</span></div>
      {resource === 'categories' ? <CategoryEditor key={editor} id={editor!} presentation="page" onSaved={saved} onDirty={setDirty} onClose={() => void navigate('categories')} /> : <QuizEditor key={editor} id={editor!} section={params.get('section') ?? 'settings'} onSectionChange={section => void navigate('quizzes', editor!, section)} onSaved={saved} onDirty={setDirty} onClose={() => void navigate('quizzes')} />}
    </EditorBusyStatusContext.Provider></EditorBusyContext.Provider> : <>
      <div className="libraryHeader"><div className="libraryHeading"><h1>{t(names[resource])}</h1><p>{t('qeIntro')}</p></div></div>
      <ProfileTabs className={styles.resourceTabs} label={t('navQuizzes')}>{allowed.map(tab => <button type="button" role="tab" key={tab} aria-selected={resource === tab} onClick={() => void navigate(tab)}>{t(names[tab])}</button>)}</ProfileTabs>
      <ResourceList key={`${resource}:${params.get('category') ?? ''}`} resource={resource} initialCategory={params.get('category') ?? ''} onBrowseCategory={category => void navigate('questions', undefined, undefined, category)} onEdit={id => void navigate(resource, id)} />
      <EditorPopup wide={resource === 'questions'} open={!!editor} title={popupTitle} onClose={() => void navigate(resource)}>
        {editor && (resource === 'questions' ? <QuestionEditor key={editor} id={editor} onSaved={saved} onDirty={setDirty} onClose={() => void navigate(resource)} /> : <CategoryEditor key={editor} id={editor} onSaved={saved} onDirty={setDirty} />)}
      </EditorPopup>
    </>}
    <ConfirmDialog {...dialogProps} />
  </div></div></main>;

}

function ResourceList({ resource, onEdit, initialCategory, onBrowseCategory }: { resource: Resource; onEdit: (id: string) => void; initialCategory: string; onBrowseCategory: (id: string) => void }) {
  const { t, locale } = useI18n(), access = useAccess(resource), categoryAccess = useAccess('categories');
  const [search, setSearch] = useState(''), [filter, setFilter] = useState(''), [status, setStatus] = useState(''), [type, setType] = useState(''), [category, setCategory] = useState(initialCategory);
  const [page, setPage] = useState(1), [limit, setLimit] = useState(20), [sort, setSort] = useState(resource === 'categories' ? 'name' : 'created_at'), [order, setOrder] = useState('desc');
  const [selected, setSelected] = useState<string[]>([]), selectAll = useRef<HTMLInputElement>(null);
  const action = useAction(), { confirm, dialogProps } = useConfirm(); const token = getToken();
  useEffect(() => { const timer = setTimeout(() => { setSearch(filter.trim()); setPage(1); }, 300); return () => clearTimeout(timer); }, [filter]);
  useEffect(() => setSelected([]), [page, limit, search, status, type, category, sort, order]);
  const params: Record<string, string | number> = { page, limit, sortBy: sort, sortOrder: order };
  if (resource === 'quizzes') { if (search) params.title = search; if (status) params.status = status; }
  if (resource === 'categories' && search) params.name = search;
  if (resource === 'questions') { if (type) params.type = type; if (category) params.category_id = category; }
  const searchingQuestions = resource === 'questions' && !!search;
  const pagedQuery = useQuery({ queryKey: [...engineKey, token, access.user?.id, resource, params], enabled: !!token && access.read && !searchingQuestions, retry: false,
    queryFn: ({ signal }) => list<Row>(resourcePaths[resource], resource, params, signal) });
  // The API has no text-search parameter. Fetch every matching page once, then
  // filter before paginating so questions beyond the current page remain searchable.
  const questionFilters = { ...(type ? { type } : {}), ...(category ? { category_id: category } : {}), sortBy: sort, sortOrder: order };
  const questionSearch = useQuery({ queryKey: [...engineKey, token, access.user?.id, 'question-search', questionFilters], enabled: !!token && access.read && searchingQuestions, retry: false,
    queryFn: ({ signal }) => all<Row>('/questions', 'questions', questionFilters, signal) });
  const query = searchingQuestions ? { ...questionSearch, data: questionSearch.data ? filterQuestionPage(questionSearch.data, search, page, limit) : undefined } : pagedQuery;
  const categories = useAll<Category>('/question-categories', 'categories', resource === 'questions' && categoryAccess.read);
  const rows = query.data?.items ?? [];
  const deletable = rows.filter(row => access.canOwn(resourcePermission(resource, 'delete_own'), resourcePermission(resource, 'delete_any'), row.user_id));
  const checked = deletable.length > 0 && deletable.every(row => selected.includes(row.id));
  useEffect(() => { if (selectAll.current) selectAll.current.indeterminate = selected.length > 0 && !checked; }, [selected, checked]);
  const remove = async (ids: string[]) => {
    if (!await confirm({ title: t('adminDelete'), message: t(resource === 'quizzes' ? 'qeDeleteQuiz' : resource === 'questions' ? 'qeDeleteQuestion' : 'qeDeleteCategory'), yesText: t('adminDelete'), noText: t('adminCancel') })) return;
    await action.run(async () => { for (const id of ids) { await request(`${resourcePaths[resource]}/${id}`, 'DELETE'); setSelected(current => current.filter(value => value !== id)); } });
  };
  const createLabel = t(resource === 'quizzes' ? 'createQuiz' : resource === 'questions' ? 'quizAddQuestion' : 'qeCreateCategory');
  const sortHeading = (column: string, label: string) => <th className={`sortable ${sort === column ? 'active' : ''}`} aria-sort={sort === column ? order === 'asc' ? 'ascending' : 'descending' : 'none'}><LibrarySortButton label={t(label)} direction={sort === column ? order as 'asc' | 'desc' : null} onClick={() => { setSort(column); setOrder(sort === column && order === 'asc' ? 'desc' : 'asc'); setPage(1); }} /></th>;
  const date = (value?: string) => value ? new Date(value).toLocaleDateString(locale === 'sr' ? 'sr-Latn' : locale, { dateStyle: 'medium' }) : '—';
  const checkbox = styles.checkbox;
  return <>
    <Notice {...action} /><div className={`managementToolbar ${styles.listToolbar}`}>
      {access.read && <div className="filter">{SearchSVG}<input type="search" value={filter} aria-label={t(resource === 'quizzes' ? 'filterQuizzes' : resource === 'questions' ? 'qeFilterQuestions' : 'qeFilterCategories')} placeholder={t(resource === 'quizzes' ? 'filterQuizzes' : resource === 'questions' ? 'qeFilterQuestions' : 'qeFilterCategories')} onChange={e => setFilter(e.target.value)} /></div>}
      <div className={styles.listFilters}>
        {access.read && resource === 'quizzes' && <Select label={t('adminTableStatus')} value={status} values={[{ value: '', label: t('qeAllStatuses') }, ...['draft', 'published', 'archived'].map(value => ({ value, label: t(`qe${value[0].toUpperCase()}${value.slice(1)}`) }))]} onChange={value => { setStatus(value); setPage(1); }} />}
        {access.read && resource === 'questions' && <><Select label={t('quizQuestionType')} value={type} values={[{ value: '', label: t('qeAllTypes') }, ...Object.entries(typeLabels).map(([value, key]) => ({ value, label: t(key) }))]} onChange={value => { setType(value); setPage(1); }} />{categoryAccess.read && <Select label={t('qeCategories')} value={category} values={[{ value: '', label: t('qeAllCategories') }, ...(categories.data ?? []).map(g => ({ value: g.id, label: g.name }))]} onChange={value => { setCategory(value); setPage(1); }} />}</>}
        {access.create && <button type="button" className="playlistAddBtn" title={createLabel} aria-label={createLabel} onClick={() => onEdit('new')}>{AddSVG}</button>}
      </div>
    </div>
    {!access.read ? <p className={styles.note}>{t('qeNoRead')}</p> : <>
    <LoadState query={query} />
    {query.data && <div className={`libraryTableWrap ${styles.listTableWrap}`} aria-busy={query.isFetching}><table className={styles.listTable} data-resource={resource}><thead><tr>
      <th className="notHoverable"><span><input className={checkbox} ref={selectAll} type="checkbox" aria-label={t('qeSelectAll')} checked={checked} disabled={action.busy || !deletable.length} onChange={e => setSelected(e.target.checked ? deletable.map(row => row.id) : [])} /><LibrarySortButton label={t(resource === 'questions' ? 'quizQuestionText' : 'title')} direction={sort === (resource === 'questions' ? 'content' : resource === 'categories' ? 'name' : 'title') ? order as 'asc' | 'desc' : null} onClick={() => { const column = resource === 'questions' ? 'content' : resource === 'categories' ? 'name' : 'title'; setOrder(sort === column && order === 'asc' ? 'desc' : 'asc'); setSort(column); setPage(1); }} />
        {selected.length > 0 && <span id="selectedButtons" role="group" aria-label={t('postSelectedCount', { count: selected.length })}>
          <button type="button" className="button bg-(--accentRed) text-(--text1)" disabled={action.busy} onClick={() => void remove(selected)}>{t('adminDeleteAll')}</button>
        </span>}
      </span></th>
      {resource === 'categories' ? <th className="notHoverable">{t('description')}</th> : sortHeading(resource === 'quizzes' ? 'status' : 'type', resource === 'quizzes' ? 'adminTableStatus' : 'quizQuestionType')}
      {resource === 'questions' && <th className="notHoverable">{t('qeCategory')}</th>}
      {resource !== 'categories' && <>{sortHeading('created_at', 'adminTableDate')}{resource === 'quizzes' && sortHeading('question_count', 'quizQuestionCount')}{sortHeading('updated_at', 'usersUpdated')}</>}
    </tr></thead><tbody>
      {rows.map(row => <tr key={row.id} data-question-type={resource === 'questions' ? row.type : undefined}><td><div className={styles.listIdentity}>
        <input className={checkbox} type="checkbox" aria-label={`${t('quizSelect')}: ${row.title || row.name || row.content || row.id}`} disabled={action.busy || !deletable.some(item => item.id === row.id)} checked={selected.includes(row.id)} onChange={e => setSelected(e.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))} />
        <span className={styles.quizThumbnail} aria-hidden="true">{resource === 'quizzes' ? QuizSVG : resource === 'questions' ? (row.type ? questionIcons[row.type] : QuestionSVG) : CollectionsSVG}</span>
        <div className={styles.listInfo}><button type="button" className={styles.rowTitle} onClick={() => onEdit(row.id)}>{row.title || row.name || row.content || t('qeUntitledQuestion')}</button>
          <div className="managementRowActions">{resource === 'categories' && access.canAny(['questions.read_own', 'questions.read_any']) && <button type="button" title={t('qeBank')} aria-label={`${t('qeBank')}: ${row.name}`} onClick={() => onBrowseCategory(row.id)}>{SearchSVG}</button>}<button type="button" aria-label={`${t('adminOpen')}: ${row.title || row.name || row.content}`} title={t('adminOpen')} onClick={() => onEdit(row.id)}>{EditSVG}</button>{deletable.some(item => item.id === row.id) && <button type="button" className="danger" disabled={action.busy} aria-label={`${t('adminDelete')}: ${row.title || row.name || row.content}`} title={t('adminDelete')} onClick={() => void remove([row.id])}>{DeleteSVG}</button>}</div>
        </div></div></td>
        <td>{resource === 'questions' ? <span className={`managementStatus ${styles.questionTypeBadge}`}>{t(typeLabels[row.type!])}</span> : resource === 'categories' ? row.description : <QuizStatus quiz={{ id: row.id, user_id: row.user_id, title: row.title ?? '', status: row.status! }} disabled={action.busy} />}</td>
        {resource === 'questions' && <td className={styles.categoryCell}>{row.category?.name || t('qeUncategorized')}</td>}
        {resource !== 'categories' && <><td><time dateTime={row.created_at}>{date(row.created_at)}</time></td>{resource === 'quizzes' && <td className={styles.questionCount}>{(row.question_count ?? 0).toLocaleString(locale)}</td>}<td><time dateTime={row.updated_at}>{date(row.updated_at)}</time></td></>}
      </tr>)}
      {!rows.length && <tr><td colSpan={resource === 'categories' ? 2 : 5} className={styles.empty}>{t('adminZeroResults')}</td></tr>}
    </tbody></table></div>}
    <Pagination page={page} limit={limit} total={query.data?.pagination.total} totalPages={query.data?.pagination.totalPages} loading={query.isFetching} disabled={action.busy} label={t(names[resource])} onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
    </>}
    <ConfirmDialog {...dialogProps} />
  </>;
}
