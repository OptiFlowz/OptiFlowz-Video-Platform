import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '~/i18n';
import { certificateQrImages } from '../quizEngine/certificateQrStyles';
import { certificateHtmlDocument, certificatePaper } from '../quizEngine/certificatePreview';
import type { CertificateDetail } from './accountQueries';
import styles from './accountCertificates.module.css';

export function issuedDate(value: string, locale: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}

export function IssuedPreview({ certificate }: { certificate: CertificateDetail }) {
  const { t } = useI18n();
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const template = certificate.template_snapshot;
  const paper = certificatePaper(template);
  // Share the complete document between the card and verification page, and wait for its
  // verification QR before mounting either iframe.
  const preview = useQuery({
    queryKey: ['issued-certificate-preview', certificate],
    enabled: width > 0,
    staleTime: Infinity,
    queryFn: async () => {
      const verificationUrl = new URL(`certificates/verify/${encodeURIComponent(certificate.id)}`, `${window.location.origin}/`).href;
      const qrImages = await certificateQrImages(template.html_template, verificationUrl);
      const data = certificate.data_snapshot;
      return certificateHtmlDocument(template, qrImages, { sampleQr: false, values: {
        'user.full_name': data.user.full_name,
        'quiz.title': data.quiz.title,
        'result.score_percentage': String(data.result.score_percentage),
        'result.earned_points': String(data.result.earned_points),
        'result.max_points': String(data.result.max_points),
        'certificate.number': certificate.certificate_number,
        'certificate.issued_at': new Date(certificate.issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }),
      } });
    },
  });
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return <div ref={container} className={styles.paper} style={{ aspectRatio: `${paper.width} / ${paper.height}` }}>
    {width > 0 && preview.data && <iframe title={t('quizViewCertificate')} tabIndex={-1} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.data}
      style={{ width: paper.width, height: paper.height, transform: `scale(${width / paper.width})` }} />}
    {preview.isPending && <span className={styles.previewState} role="status">{t('videoLoadingData')}</span>}
    {preview.isError && <span className={styles.previewState} role="alert">{t('searchLoadFailed')}</span>}
  </div>;
}

