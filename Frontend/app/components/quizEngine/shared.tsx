import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthorization } from '~/authorization/authorization';
import { getToken } from '~/functions';
import { useI18n } from '~/i18n';
import CustomSelect from '~/components/customSelect/customSelect';
import { engineKey, request, all } from './api';
import type { Resource, Owned } from './model';
import { resourcePermission } from './model';
import styles from './engine.module.css';
import { EditorBusyContext, EditorNoticeContext } from './EditorPopup';
export { styles };
export function useAccess(resource: Resource, record?: Owned) {
  const auth = useAuthorization();
  const permission = (action: string) => resourcePermission(resource, action);
  return {
    ...auth, create: auth.can(permission('create')),
    read: auth.canAny([permission('read_own'), permission('read_any')]),
    update: !!record && auth.canOwn(permission('update_own'), permission('update_any'), record.user_id),
    remove: !!record && auth.canOwn(permission('delete_own'), permission('delete_any'), record.user_id),
  };
}
export function useDetail<T>(path: string, enabled = true) {
  const { user } = useAuthorization(); const token = getToken();
  return useQuery({ queryKey: [...engineKey, token, user?.id, path], enabled: !!token && enabled,
    queryFn: ({ signal }) => request<T>(path, 'GET', undefined, signal), retry: false });
}
export function useAll<T>(path: string, key: string, enabled = true) {
  const { user } = useAuthorization(); const token = getToken();
  return useQuery({ queryKey: [...engineKey, token, user?.id, 'all', path, key], enabled: !!token && enabled,
    queryFn: ({ signal }) => all<T>(path, key, {}, signal), retry: false });
}
export function useAction() {
  const client = useQueryClient(), { t } = useI18n(); const lock = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [success, setSuccess] = useState('');
  const reportBusy = useContext(EditorBusyContext);
  useEffect(() => { if (busy) reportBusy?.(true); return () => { if (busy) reportBusy?.(false); }; }, [busy, reportBusy]);
  async function run(work: () => Promise<void | boolean>, announce = true) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setSuccess('');
    try { const changed = await work(); if (announce && changed !== false) setSuccess(t('qeSaved')); }
    catch (e) { setError(e instanceof Error ? e.message : t('quizError')); }
    finally { await client.invalidateQueries({ queryKey: engineKey }); lock.current = false; setBusy(false); }
  }
  return { busy, error, success, run, setError, setSuccess };
}
export function Notice({ error, success }: { error?: string; success?: string }) {
  const target = useContext(EditorNoticeContext);
  const message = error ? <p className={styles.error} role="alert">{error}</p> : success ? <p className={styles.success} role="status">{success}</p> : null;
  if (target === undefined) return <div className={styles.noticeInline}>{message}</div>;
  return target && message ? createPortal(message, target) : null;
}
export function LoadingSkeleton({ variant = 'cards' }: { variant?: 'cards' | 'form' | 'inline' }) {
  const { t } = useI18n();
  return <div role="status" aria-label={t('quizLoadingQuiz')} className={`${styles.loadingSkeleton} ${variant === 'form' ? styles.formSkeleton : ''}`}>
    <span className="sr-only">{t('quizLoadingQuiz')}</span>
    {Array.from({ length: variant === 'inline' ? 2 : 3 }, (_, index) => <div aria-hidden="true" className={styles.skeletonBlock} key={index}><div className="skeleton-title" /><div className="skeleton-text" />{variant === 'form' && <div className={styles.skeletonField} />}</div>)}
  </div>;
}
export function LoadState({ query, variant = 'cards' }: { query: { isPending: boolean; isError: boolean; error: Error | null; refetch: () => unknown }; variant?: 'cards' | 'form' | 'inline' }) {
  const { t } = useI18n();
  return query.isPending ? <LoadingSkeleton variant={variant} /> : query.isError ? <div role="alert"><p>{query.error?.message}</p><button type="button" className="saveCaptionsBtn" onClick={() => query.refetch()}>{t('usersRetry')}</button></div> : null;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <div className="formGroup"><label>{label}</label>{children}{hint && <p className="formHint">{hint}</p>}</div>;
}
export function Select({ label, value, values, onChange, disabled = false, placement = 'auto' }: { label: string; value: string | number; values: { value: string | number; label: string; disabled?: boolean }[]; onChange: (value: string) => void; disabled?: boolean; placement?: 'auto' | 'top' | 'bottom' }) {
  return <CustomSelect ariaLabel={label} value={value} options={values} onChange={onChange} disabled={disabled} placement={placement} rootClassName={styles.select} />;
}
export function Save({ busy, disabled = false }: { busy: boolean; disabled?: boolean }) {
  const { t } = useI18n(); return <div className={styles.save}><button className="saveCaptionsBtn" type="submit" disabled={busy || disabled}>{busy ? t('saving') : t('saveChanges')}</button></div>;
}
