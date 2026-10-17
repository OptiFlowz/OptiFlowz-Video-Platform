import { useId } from 'react';
import { useI18n } from '~/i18n';
import { useAuthorization } from '~/authorization/authorization';
import { P } from '~/authorization/permissions';
import statusStyles from '../uploadPage/uploadStatus.module.css';
import CustomSelect from '~/components/customSelect/customSelect';
import type { CollectionFields as Fields } from './model';

export default function CollectionFields({ value, onChange, disabled }: {
  value: Fields; onChange: (fields: Fields) => void; disabled?: boolean;
}) {
  const { t } = useI18n(); const id = useId(); const { can } = useAuthorization();
  return <>
    <div className="formGroup"><label htmlFor={`${id}-title`}>{t('title')}</label>
      <input type="text" id={`${id}-title`} required maxLength={255} value={value.title} disabled={disabled} onChange={e => onChange({ ...value, title: e.target.value })} />
    </div>
    <div className="formGroup"><label htmlFor={`${id}-subheading`}>{t('collectionSubheading')}</label>
      <input type="text" id={`${id}-subheading`} maxLength={255} value={value.subheading || ''} disabled={disabled} onChange={e => onChange({ ...value, subheading: e.target.value })} />
    </div>
    <div className="formGroup"><label htmlFor={`${id}-description`}>{t('description')}</label>
      <textarea id={`${id}-description`} rows={5} value={value.description || ''} disabled={disabled} onChange={e => onChange({ ...value, description: e.target.value })} />
    </div>
    <div className="formGroup"><label htmlFor={`${id}-visibility`}>{t('visibility')}</label>
      <CustomSelect id={`${id}-visibility`} value={value.visibility} disabled={disabled}
        options={[{ value: 'private', label: t('adminPrivate') }, { value: 'public', label: t('adminPublic') }]}
        onChange={visibility => onChange({ ...value, visibility: visibility as Fields['visibility'] })} ariaLabel={t('visibility')} rootClassName={statusStyles.compactSelect} triggerClassName="visibilitySelect" />
      <p className="formHint">{t(value.visibility === 'public' ? 'collectionPublicHelp' : 'collectionPrivateHelp')}</p>
    </div>
    {can(P.collectionsFeature) && <div className="formGroup mt-7.5 mb-5">
      <label htmlFor={`${id}-featured`}>{t('featured')}</label>
      <CustomSelect id={`${id}-featured`} value={value.is_featured ? 'true' : 'false'} disabled={disabled}
        options={[{ value: 'false', label: t('adminNo') }, { value: 'true', label: t('adminYes') }]}
        onChange={featured => onChange({ ...value, is_featured: featured === 'true' })}
        ariaLabel={t('featured')} rootClassName={statusStyles.compactSelect} triggerClassName="visibilitySelect" />
    </div>}
  </>;
}
