import { useI18n } from "~/i18n";
import { useEffect, useRef, useState } from "react";

interface ThumbnailImageProps {
  src: string;
  alt: string;
  className?: string;
}

export const ThumbnailImage = (props: ThumbnailImageProps) => (
  <ThumbnailImageRequest key={props.src} {...props} />
);

// A new source gets its own request state, so late events and retry timers
// from the previous image cannot change the current preview.
const ThumbnailImageRequest = ({ src, alt, className }: ThumbnailImageProps) => {
  const { t } = useI18n();
  const [isLoading, setIsLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [hasFailed, setHasFailed] = useState(false);
  const retryTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => {
    return () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, []);

  const handleLoad = () => {
    setHasFailed(false);
    setIsLoading(false);
  };

  const handleError = () => {
    if (retryTimeoutRef.current) clearTimeout(retryTimeoutRef.current);
    if (attempt >= 3) {
      setIsLoading(false);
      setHasFailed(true);
      return;
    }

    setIsLoading(true);
    setHasFailed(false);

    const retryDelay = 400 + attempt * 450;
    retryTimeoutRef.current = setTimeout(() => {
      retryTimeoutRef.current = null;
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
      {!hasFailed ? (
        <img
          key={attempt}
          src={src}
          alt={alt}
          className={`${className ?? ""} ${isLoading ? "thumbnailImagePending" : ""}`.trim()}
          onLoad={handleLoad}
          onError={handleError}
        />
      ) : null}
    </div>
  );
};
