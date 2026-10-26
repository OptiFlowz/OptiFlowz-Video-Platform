import { useRef, useState } from 'react';
import { fetchApiResponse } from '~/API';
import PageLoader from '../loaders/pageLoader';
import { createAnalyticsReportPreview } from '../analytics/analyticsReportPreview';
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

  const [isGeneratingPdf, setIsGeneratingPdf] = useState(false);
  const [pdfFailed, setPdfFailed] = useState(false);
  const generatingRef = useRef(false);

  const openPdf = async () => {
    if (!certificate || generatingRef.current) return;
    generatingRef.current = true;
    setIsGeneratingPdf(true);
    setPdfFailed(false);
    let preview: ReturnType<typeof createAnalyticsReportPreview> | undefined;
    try {
      const target = window.open('', '_blank');
      if (target) preview = createAnalyticsReportPreview(target, {
        generating: t('analyticsGeneratingPdf'),
        report: certificate.data_snapshot.quiz.title,
        failed: t('editorGenerateFailed'),
        close: t('close'),
      });
      const response = await fetchApiResponse(
        `${env.apiBaseUrl}/api/certificates/${encodeURIComponent(certificate.id)}/pdf`,
        { method: 'GET' },
        true,
      );
      if (!response.ok) throw new Error('Failed to fetch certificate PDF.');
      const blob = await response.blob();
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      const filename = `${certificate.certificate_number}.pdf`;
      if (preview) preview.showPdf(url, filename);
      else {
        // Popup blockers must not prevent the certificate from downloading.
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    } catch {
      preview?.showError();
      setPdfFailed(true);
    } finally {
      generatingRef.current = false;
      setIsGeneratingPdf(false);
    }
  };

  return <main className={styles.page}>
    <PageLoader active={isGeneratingPdf} />
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
        <button type="button" className={styles.pdf} onClick={() => void openPdf()} disabled={isGeneratingPdf} aria-busy={isGeneratingPdf}>
          {DownloadSVG}<span>{t(isGeneratingPdf ? 'analyticsGeneratingPdf' : 'analyticsDownloadPdf')}</span>
        </button>
      </div>
      {pdfFailed && <p role="alert">{t('editorGenerateFailed')}</p>}
      <IssuedPreview certificate={certificate} />
    </>}
  </main>;
}
