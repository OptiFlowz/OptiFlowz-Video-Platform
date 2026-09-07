import { useI18n } from "~/i18n";
import { useEffect, useRef, useState } from "react";

interface ThumbnailImageProps {
  src: string;
  alt: string;
  className?: string;
}

export const ThumbnailImage = ({ src, alt, className }: ThumbnailImageProps) => {
  const { t } = useI18n();
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [hasFailed, setHasFailed] = useState(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const revealTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    setDisplaySrc(null);
    setIsLoading(true);
    setAttempt(0);
    setHasFailed(false);
  }, [src]);

  useEffect(() => {
    if (retryTimeoutRef.current) {
      clearTimeout(retryTimeoutRef.current);
      retryTimeoutRef.current = null;
    }
    if (revealTimeoutRef.current) {
      clearTimeout(revealTimeoutRef.current);
      revealTimeoutRef.current = null;
    }

    const nextSrc = src;
    const revealDelay = attempt === 0 ? 180 : Math.min(350 * attempt, 900);

    revealTimeoutRef.current = setTimeout(() => {
      setDisplaySrc(nextSrc);
    }, revealDelay);

    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
      if (revealTimeoutRef.current) {
        clearTimeout(revealTimeoutRef.current);
      }
    };
  }, [src, attempt]);

  const handleLoad = () => {
    setHasFailed(false);
    setIsLoading(false);
  };

  const handleError = () => {
    if (attempt >= 3) {
      setIsLoading(false);
      setHasFailed(true);
      return;
    }

    setIsLoading(true);
    setHasFailed(false);

    const retryDelay = 400 + attempt * 450;
    retryTimeoutRef.current = setTimeout(() => {
      setAttempt((currentAttempt) => currentAttempt + 1);
    }, retryDelay);
  };

  return (
    <div className="thumbnailImageShell">
      {isLoading && (
        <div className="thumbnailImageLoader">
          <div className="uploadSpinner tiny" />
          <span>{t(attempt === 0 ? "loadingVideoPreview" : "editorRetryingFrame")}</span>
        </div>
      )}
      {hasFailed && !isLoading ? (
        <div className="thumbnailImageFallback">
          <span>{t("editorPreviewUnavailable")}</span>
          <button
            type="button"
            className="thumbnailImageRetryBtn"
            onClick={() => {
              setHasFailed(false);
              setIsLoading(true);
              setAttempt(0);
            }}
          >
            {t("usersRetry")}
          </button>
        </div>
      ) : null}
      {displaySrc ? (
        <img
          src={displaySrc}
          alt={alt}
          className={`${className ?? ""} ${isLoading ? "thumbnailImagePending" : ""}`.trim()}
          onLoad={handleLoad}
          onError={handleError}
        />
      ) : null}
    </div>
  );
};

