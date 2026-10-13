import { useId } from 'react';
import { useI18n } from '~/i18n';
import CustomSelect from '~/components/customSelect/customSelect';
import type { CollectionFields as Fields } from './model';

export default function CollectionFields({ value, onChange, disabled }: {
  value: Fields; onChange: (fields: Fields) => void; disabled?: boolean;
}) {
  const { t } = useI18n(); const id = useId();
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
        onChange={visibility => onChange({ ...value, visibility: visibility as Fields['visibility'] })} ariaLabel={t('visibility')} triggerClassName="visibilitySelect" />
      <p className="formHint">{t(value.visibility === 'public' ? 'collectionPublicHelp' : 'collectionPrivateHelp')}</p>
    </div>
  </>;
}
