import { useEffect, useRef, type ReactNode } from "react";
import { useI18n } from "~/i18n";
import styles from "./infiniteScroll.module.css";

type Props = {
  hasMore: boolean;
  fetching: boolean;
  error: boolean;
  onLoadMore: () => void;
  loadingLabel: string;
  loadingContent?: ReactNode;
};

export default function InfiniteScroll({ hasMore, fetching, error, onLoadMore, loadingLabel, loadingContent }: Props) {
  const { t } = useI18n();
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || fetching || error || !sentinel.current || typeof IntersectionObserver === "undefined") return;
    let requested = false;
    const observer = new IntersectionObserver(entries => {
      if (requested || !entries.some(entry => entry.isIntersecting)) return;
      requested = true;
      onLoadMore();
    }, { rootMargin: "300px 0px" });
    observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [hasMore, fetching, error, onLoadMore]);

  if (!hasMore && !error) return null;
  return <div ref={sentinel} className={styles.container} aria-busy={fetching}>
    {error ? <p role="alert">{t("searchLoadFailed")}</p> : null}
    {fetching ? loadingContent ?? <p role="status">{loadingLabel}</p> : (
      <button type="button" onClick={onLoadMore}>{t(error ? "usersRetry" : "more")}</button>
    )}
  </div>;
}
