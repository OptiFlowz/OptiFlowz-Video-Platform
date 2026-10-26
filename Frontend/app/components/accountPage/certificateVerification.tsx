import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { useI18n } from '~/i18n';
import { env } from '~/env';
import { DownloadSVG, CheckSVG } from '~/constants';
import { publicCertificateQuery } from './accountQueries';
import { IssuedPreview, issuedDate } from './issuedCertificatePreview';
import styles from './certificateVerification.module.css';

export default function CertificateVerification() {
  const { certificateId } = useParams<{ certificateId: string }>();
  const { t, locale } = useI18n();
  const detail = useQuery(publicCertificateQuery(certificateId));
  const certificate = detail.data?.certificate;
  const status = (detail.error as (Error & { status?: number }) | null)?.status;
  const notFound = !certificateId || status === 400 || status === 404;

  return <main className={styles.page}>
    <p className={styles.eyebrow}>{t('quizViewCertificate')}</p>
    {notFound ? <p role="alert">{t('errorNotFound')}</p> : detail.isPending ? <p role="status">{t('videoLoadingData')}</p> : detail.isError ? <div role="alert">
      <p>{t('searchLoadFailed')}</p>
      <button type="button" className="button" onClick={() => void detail.refetch()}>{t('usersRetry')}</button>
    </div> : certificate && <>
      <div className={styles.heading}>
        <div className={styles.title}>
          <h1>{certificate.data_snapshot.quiz.title}</h1>
          <div className={styles.metadata}>
            <span>{certificate.certificate_number}</span>
            <time dateTime={certificate.issued_at}>{issuedDate(certificate.issued_at, locale)}</time>
            <span role="status" className={certificate.status === 'revoked' ? styles.revoked : styles.issued}>
              {certificate.status !== 'revoked' && CheckSVG}
              {t(certificate.status === 'revoked' ? 'certificateRevoked' : 'certificateIssued')}
              {certificate.revoked_at && <> · {issuedDate(certificate.revoked_at, locale)}</>}
            </span>
          </div>
        </div>
        <a className={styles.pdf} href={`${env.apiBaseUrl}/api/certificates/${encodeURIComponent(certificate.id)}/pdf`} target="_blank" rel="noopener noreferrer">
          {DownloadSVG}<span>{t('analyticsDownloadPdf')}</span>
        </a>
      </div>
      <IssuedPreview certificate={certificate} />
    </>}
  </main>;
}
