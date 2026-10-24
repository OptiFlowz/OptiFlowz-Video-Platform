import { useState } from 'react';
import { useI18n } from '~/i18n';
import { SearchSVG } from '~/constants';
import Pagination from '~/components/library/pagination';
import EditorPopup from './EditorPopup';
import { CertificateTemplateCard } from './CertificateTemplates';
import type { CertificateTemplate } from './certificateApi';
import { styles } from './shared';

export default function CertificateChooser({ templates, selected, onChoose, onClose }: {
  templates: CertificateTemplate[]; selected: string; onChoose: (id: string) => void; onClose: () => void;
}) {
  const { t } = useI18n();
  const [search, setSearch] = useState(''), [page, setPage] = useState(1), [limit, setLimit] = useState(6);
  const rows = templates.filter(template => `${template.name} ${template.description ?? ''}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const currentPage = Math.min(page, Math.max(1, Math.ceil(rows.length / limit)));
  return <EditorPopup open title={t('quizCertificateChoose')} onClose={onClose} className={styles.certificateChooser}>
    <div className={styles.certificateChooserToolbar}>
      <div className={styles.certificateFilter}>{SearchSVG}<input type="search" aria-label={t('quizCertificateSearch')} placeholder={t('quizCertificateSearch')}
        value={search} maxLength={255} onChange={event => { setSearch(event.target.value); setPage(1); }} /></div>
      <button type="button" className={styles.button} onClick={() => onChoose('')}>{t('quizCertificateNone')}</button>
    </div>
    <div className={styles.certificateChooserScroll}>
      <div className={styles.certificateGallery}>
        {rows.slice((currentPage - 1) * limit, currentPage * limit).map(template => <CertificateTemplateCard key={template.id}
          template={template} selected={selected === template.id} onOpen={() => onChoose(template.id)} />)}
      </div>
      {!rows.length && <p className={styles.panel}>{t(search ? 'adminZeroResults' : 'quizCertificateEmpty')}</p>}
    </div>
    <Pagination page={currentPage} limit={limit} total={rows.length} pageSizes={[6, 12, 24]} label={t('quizCertificateLibrary')}
      onPageChange={setPage} onLimitChange={value => { setLimit(value); setPage(1); }} />
  </EditorPopup>;
}
