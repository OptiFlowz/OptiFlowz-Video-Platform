import { useI18n } from '~/i18n';
export default function CollectionState({ error, retry }: { error?: unknown; retry?: () => void }) {
  const { t } = useI18n();
  const unavailable = !!error && typeof error === 'object' && 'status' in error && [403, 404].includes(Number(error.status));
  return <div className={error ? 'errorBanner' : 'collectionState'} role={error ? 'alert' : 'status'}>
    <p>{t(unavailable ? 'collectionUnavailable' : error ? 'collectionLoadFailed' : 'collectionsLoading')}</p>
    {!!error && retry && <button type="button" className="cancelBtn" onClick={retry}>{t('usersRetry')}</button>}
  </div>;
}
