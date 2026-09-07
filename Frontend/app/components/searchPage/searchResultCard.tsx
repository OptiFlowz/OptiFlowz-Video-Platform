import { useState } from "react";
import { Link } from "react-router";
import { formatDate, formatDuration, formatViews } from "~/functions";
import { translateContentTitle, useI18n } from "~/i18n";
import { SearchIcon } from "./searchIcons";
import styles from "./searchPage.module.css";

export type SearchResult = {
  id: string;
  kind: "video" | "playlist" | "people";
  title: string;
  href: string;
  thumbnail?: string | null;
  preview_url?: string | null;
  author?: string;
  description?: string;
  views?: number;
  date?: string;
  duration?: number;
  progress?: number;
  videoCount?: number;
};

export default function SearchResultCard({ result }: { result: SearchResult }) {
  const { t } = useI18n();
  const [hovered, setHovered] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const preview = result.kind === "video" && !previewFailed ? result.preview_url : undefined;
  const title = result.kind === "people" ? result.title : translateContentTitle(result.title);
  const label = t(result.kind === "video" ? "adminTableVideo" : result.kind === "playlist" ? "playlistLabel" : "contributorLabel");
  const action = t(result.kind === "video" ? "searchWatchVideo" : result.kind === "playlist" ? "searchViewPlaylist" : "searchViewVideos");
  const hasDate = result.date && Number.isFinite(new Date(result.date).getTime());

  return (
    <Link
      to={result.href}
      className={`${styles.card} ${result.kind === "people" ? styles.personCard : ""}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`${styles.thumbnail} ${result.kind === "people" ? styles.portrait : ""}`}>
        {result.thumbnail && !imageFailed ? (
          <img
            src={hovered && preview ? preview : result.thumbnail}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => { if (hovered && preview) setPreviewFailed(true); else setImageFailed(true); }}
          />
        ) : <span className={styles.thumbnailFallback}><SearchIcon name={result.kind} /></span>}
        {result.kind === "video" && result.duration != null ? <span className={styles.mediaBadge}>{formatDuration(result.duration)}</span> : null}
        {result.kind === "playlist" ? <span className={styles.mediaBadge}><SearchIcon name="playlist" />{result.videoCount ?? 0}</span> : null}
        {result.kind === "video" && (result.progress ?? 0) > 0 ? (
          <span className={styles.progress}><span style={{ width: `${Math.min(100, Math.max(0, result.progress ?? 0))}%` }} /></span>
        ) : null}
        {result.kind === "video" ? <span className={styles.playOverlay}><SearchIcon name="video" /></span> : null}
      </div>
      <div className={styles.cardBody}>
        <span className={styles.kind}>{label}</span>
        <h3 title={title}>{title}</h3>
        {result.author ? <p className={styles.author}>{result.author}</p> : null}
        {result.description ? <p className={styles.description}>{result.description}</p> : null}
        <div className={styles.metadata}>
          {result.views != null ? <span>{formatViews(result.views)}</span> : null}
          {hasDate ? <span>{formatDate(result.date!)}</span> : null}
          {result.kind !== "video" ? <span>{t("videosLabel", { count: Number(result.videoCount ?? 0) })}</span> : null}
        </div>
      </div>
      <span className={styles.cardAction} aria-hidden="true"><span>{action}</span><SearchIcon name="arrow" /></span>
    </Link>
  );
}
