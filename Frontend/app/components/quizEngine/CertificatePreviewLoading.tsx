import Loader from '../loaders/loader';
import styles from './engine.module.css';

export default function CertificatePreviewLoading({ width, height, label }: { width: number; height: number; label: string }) {
  return <div className={styles.certificatePdfLoading} style={{ aspectRatio: `${width} / ${height}` }} role="status" aria-label={label} aria-busy="true">
    <div className={styles.certificateSkeletonPaper} aria-hidden="true">
      <span className={styles.certificateSkeletonTitle} />
      <span className={styles.certificateSkeletonSubtitle} />
      <span className={styles.certificateSkeletonName} />
      <span className={styles.certificateSkeletonLine} />
      <span className={styles.certificateSkeletonFooter} />
    </div>
    <div aria-hidden="true"><Loader classes={styles.certificatePdfSpinner} /></div>
  </div>;
}
