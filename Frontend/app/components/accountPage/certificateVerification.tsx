import { useEffect, useRef, useState } from 'react';
import { fetchApiResponse } from '~/API';
import { PdfGenerationStatus } from '../analytics/PdfGenerationStatus';
import { certificatePdfFilename, downloadCertificatePdf } from './certificatePdf';
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
  const requestRef = useRef<AbortController | null>(null);
  const downloadRef = useRef<string | null>(null);
  const [download, setDownload] = useState<{ id: string; url: string; filename: string } | null>(null);

  useEffect(() => {
    setDownload(null);
    setIsGeneratingPdf(false);
    setPdfFailed(false);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      if (downloadRef.current) URL.revokeObjectURL(downloadRef.current);
      downloadRef.current = null;
    };
  }, [certificateId]);

  const openPdf = async () => {
    if (!certificate || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setIsGeneratingPdf(true);
    setPdfFailed(false);
    try {
      let blob: Blob;
      try {
        const { generateCertificatePdf } = await import('./generateCertificatePdf');
        blob = await generateCertificatePdf(certificate, controller.signal);
      } catch {
        // Keep downloading available on browsers/templates that cannot be captured locally.
        controller.signal.throwIfAborted();
        const response = await fetchApiResponse(
          `${env.apiBaseUrl}/api/certificates/${encodeURIComponent(certificate.id)}/pdf`,
          { method: 'GET', signal: controller.signal },
          true,
        );
        if (!response.ok) throw new Error('Failed to fetch certificate PDF.');
        blob = await response.blob();
      }
      if (controller.signal.aborted) return;
      const filename = certificatePdfFilename(certificate.data_snapshot.quiz.title, certificate.certificate_number);
      const url = URL.createObjectURL(new File([blob], filename, { type: 'application/pdf' }));
      downloadRef.current = url;
      setDownload({ id: certificate.id, url, filename });
      // Keep a real download link available if the browser requires another user gesture.
      try { downloadCertificatePdf(url, filename); } catch { /* The link below remains usable. */ }
    } catch {
      if (!controller.signal.aborted) setPdfFailed(true);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setIsGeneratingPdf(false);
      }
    }
  };

  const readyDownload = download?.id === certificate?.id ? download : null;

  return <>
    {isGeneratingPdf && <div className={styles.generating}>
      <PdfGenerationStatus labels={{ generating: t('analyticsGeneratingPdf'), report: certificate?.data_snapshot.quiz.title ?? '', failed: t('editorGenerateFailed'), close: t('close') }} />
    </div>}
    <main className={styles.page} inert={isGeneratingPdf} aria-busy={isGeneratingPdf}>
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
        {readyDownload ? <a className={styles.pdf} href={readyDownload.url} download={readyDownload.filename}>
          {DownloadSVG}<span>{t('analyticsDownloadPdf')}</span>
        </a> : <button type="button" className={styles.pdf} onClick={() => void openPdf()} disabled={isGeneratingPdf} aria-busy={isGeneratingPdf}>
          {DownloadSVG}<span>{t(isGeneratingPdf ? 'analyticsGeneratingPdf' : 'analyticsDownloadPdf')}</span>
        </button>}
      </div>
      {pdfFailed && <p role="alert">{t('editorGenerateFailed')}</p>}
      <IssuedPreview certificate={certificate} />
    </>}
  </main></>;
}
