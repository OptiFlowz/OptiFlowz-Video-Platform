import { useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { fetchFn } from "~/API";
import { useAuthorization } from "~/authorization/authorization";
import { P } from "~/authorization/permissions";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import { useConfirm } from "~/components/confirmPopup/useConfirm";
import { DeleteSVG } from "~/constants";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";
import styles from "./editorHeader.module.css";

type Props = {
  kind: "video" | "playlist";
  id: string;
  resourceTitle: string;
  heading: string;
  children: ReactNode;
  disabled?: boolean;
};

export function EditorHeader({ kind, id, resourceTitle, heading, children, disabled }: Props) {
  const { t } = useI18n();
  const { canAny } = useAuthorization();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { confirm, dialogProps } = useConfirm();
  const pending = useRef(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState(false);
  const isVideo = kind === "video";
  const canDelete = canAny(isVideo
    ? [P.videosDeleteOwn, P.videosDeleteAny]
    : [P.playlistsDeleteOwn, P.playlistsDeleteAny]);
  const listKey = isVideo ? "my-videos" : "my-playlists";

  const handleDelete = async () => {
    if (!canDelete || disabled || pending.current) return;
    pending.current = true;
    try {
      const confirmed = await confirm({
        title: t(isVideo ? "adminDeleteVideoTitle" : "adminDeletePlaylistTitle", { title: resourceTitle }),
        message: t("adminActionCannotBeUndone"),
        yesText: t("adminDelete"),
        noText: t("adminCancel"),
      });
      if (!confirmed) return;

      setIsDeleting(true);
      setError(false);
      const token = getToken();
      if (!token) throw new Error("Missing authentication");
      const response = await fetchFn<{ success: boolean }>({
        route: isVideo
          ? `api/video-moderation/video/${id}`
          : `api/playlists-moderation/playlist/${id}`,
        options: {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
        },
      });
      if (!response?.success) throw new Error("Deletion failed");

      void queryClient.invalidateQueries({ queryKey: [listKey] });
      navigate(`/${listKey}`, { replace: true });
    } catch {
      setError(true);
    } finally {
      pending.current = false;
      setIsDeleting(false);
    }
  };

  return (
    <>
      <div className={styles.header}>
        <h1>{heading}</h1>
        {canDelete && (
          <button
            type="button"
            className={styles.deleteButton}
            onClick={handleDelete}
            disabled={disabled || isDeleting || dialogProps.open}
            aria-busy={isDeleting}
          >
            {DeleteSVG}
            {t(isDeleting ? "deleting" : isVideo ? "adminDeleteVideo" : "adminDeletePlaylist")}
          </button>
        )}
      </div>
      <p className="mt-1 mb-3 links">{children}</p>
      {error && <div className="errorBanner" role="alert"><p>{t("somethingWentWrong")}</p></div>}
      <ConfirmDialog {...dialogProps} />
    </>
  );
}
