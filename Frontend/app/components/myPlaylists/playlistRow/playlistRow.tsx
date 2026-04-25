import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { createPortal } from "react-dom";
import DefaultThumbnail from "../../../../assets/DefaultThumbnail.webp";
import {
  DeleteSVG,
  EditSVG,
  PlaySVG,
  PrivateSVG,
  PublicSVG,
} from "~/constants";
import {
  formatDate,
  formatDescription,
  formatViews,
  getToken,
} from "~/functions";
import type { FetchMyPlaylistsT, MyPlaylistT } from "~/types";
import { fetchFn } from "~/API";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import { useConfirm } from "~/components/confirmPopup/useConfirm";

function PlaylistRow({
  props,
  isSelected,
  setSelectedPlaylists,
}: {
  props: MyPlaylistT;
  isSelected: boolean;
  setSelectedPlaylists: Dispatch<SetStateAction<MyPlaylistT[]>>;
}) {
  const [isHidden, setIsHidden] = useState(false);
  const [visOpen, setVisOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [draftVisibility, setDraftVisibility] = useState<"public" | "private">(
    props?.status === "public" ? "public" : "private"
  );
  const visRef = useRef<HTMLDivElement | null>(null);
  const visPopupRef = useRef<HTMLDivElement | null>(null);
  const [visPopupStyle, setVisPopupStyle] = useState<React.CSSProperties>({});
  const myHeaders = useRef(new Headers());
  const queryClient = useQueryClient();
  const { confirm, dialogProps } = useConfirm();

  const positionVisibilityPopup = () => {
    const trigger = visRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const popupWidth = 224;
    const gap = 8;
    const viewportPadding = 12;

    let left = rect.left;
    if (left + popupWidth > window.innerWidth - viewportPadding) {
      left = window.innerWidth - popupWidth - viewportPadding;
    }
    if (left < viewportPadding) {
      left = viewportPadding;
    }

    let top = rect.bottom + gap;
    const estimatedPopupHeight = visPopupRef.current?.offsetHeight ?? 170;
    if (top + estimatedPopupHeight > window.innerHeight - viewportPadding) {
      top = Math.max(viewportPadding, rect.top - estimatedPopupHeight - gap);
    }

    setVisPopupStyle({
      position: "fixed",
      top,
      left,
      width: popupWidth,
    });
  };

  useEffect(() => {
    setDraftVisibility(props?.status === "public" ? "public" : "private");
  }, [props?.status]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(max-width: 768px)");
    const updateViewport = () => setIsMobileViewport(mediaQuery.matches);

    updateViewport();
    mediaQuery.addEventListener("change", updateViewport);

    return () => mediaQuery.removeEventListener("change", updateViewport);
  }, []);

  useEffect(() => {
    if (!visOpen) return;

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!visRef.current) return;
      if (
        !visRef.current.contains(target) &&
        !visPopupRef.current?.contains(target)
      ) {
        setVisOpen(false);
        setDraftVisibility(props?.status === "public" ? "public" : "private");
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [visOpen, props?.status]);

  useLayoutEffect(() => {
    if (!visOpen) return;

    positionVisibilityPopup();

    const onReposition = () => positionVisibilityPopup();
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);

    return () => {
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [visOpen]);

  useLayoutEffect(() => {
    const userToken = getToken();
    if (!userToken || myHeaders.current.has("Authorization")) return;

    myHeaders.current.append("Content-Type", "application/json");
    myHeaders.current.append("Authorization", `Bearer ${userToken}`);
  }, []);

  const openVisibilityPopup = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftVisibility(props?.status === "public" ? "public" : "private");
    setVisOpen(true);
  };

  const cancelVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVisOpen(false);
    setDraftVisibility(props?.status === "public" ? "public" : "private");
  };

  const saveVisibility = async (e: React.MouseEvent) => {
    e.stopPropagation();

    await fetchFn<{ success: boolean }>({
      route: `api/playlists-moderation/playlist-details/${props.id}`,
      options: {
        method: "PATCH",
        headers: myHeaders.current,
        body: JSON.stringify({
          status: draftVisibility,
        }),
      },
    });

    queryClient.setQueriesData<FetchMyPlaylistsT>(
      { queryKey: ["my-playlists"] },
      (old) => {
        if (!old) return old;

        return {
          ...old,
          playlists: old.playlists.map((playlist) =>
            playlist.id === props.id
              ? { ...playlist, status: draftVisibility }
              : playlist
          ),
        };
      }
    );

    setVisOpen(false);
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete playlist "${props?.title}"?`,
      message: "This action cannot be undone.",
      yesText: "Delete",
      noText: "Cancel",
    });

    if (!ok) return;

    const response = await fetchFn<{ success: boolean }>({
      route: `api/playlists-moderation/playlist/${props.id}`,
      options: {
        method: "DELETE",
        headers: myHeaders.current,
      },
    });

    if (!response?.success) return;

    setSelectedPlaylists((prev) =>
      prev.filter((playlist) => playlist.id !== props.id)
    );

    queryClient.setQueriesData<FetchMyPlaylistsT>(
      { queryKey: ["my-playlists"] },
      (old) => {
        if (!old) return old;

        return {
          ...old,
          playlists: old.playlists.filter((playlist) => playlist.id !== props.id),
          total: Math.max(0, old.total - 1),
          total_pages: Math.max(1, Math.ceil(Math.max(0, old.total - 1) / old.limit)),
        };
      }
    );

    setIsHidden(true);
  };

  if (isHidden) return null;

  return (
    <tr key={props?.id}>
      <td>
        <span>
          <input
            checked={isSelected}
            onChange={(e) => {
              if (e.target.checked) {
                setSelectedPlaylists((prev) => [props, ...prev]);
                return;
              }

              setSelectedPlaylists((prev) =>
                prev.filter((playlist) => playlist.id !== props.id)
              );
            }}
            className="appearance-none rounded-lg! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative
                        checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
            type="checkbox"
          />
          <span className="videoInfo">
            <div className="relative">
              <img src={props?.thumbnail_url || DefaultThumbnail} alt="Thumbnail" loading="lazy" decoding="async" />
            </div>
            <span className="flex flex-col gap-0.5 rounded-none!">
              <h3>{props?.title}</h3>
              <h5 className="line-clamp-2 font-light!">
                {formatDescription(props?.description || "No description")}
              </h5>
              <div className="videoActions">
                <Link to={`/playlist/${props?.id}`} title="Open Playlist">
                  {PlaySVG}
                </Link>
                <Link
                  to={`/edit-playlist?playlist=${props?.id}&status=${props?.status}`}
                  title="Edit Playlist"
                >
                  {EditSVG}
                </Link>
                <button onClick={handleDelete} title="Delete Playlist">
                  {DeleteSVG}
                </button>
              </div>
            </span>
          </span>
        </span>
        <ConfirmDialog {...dialogProps} />
      </td>

      <td>
        <div className="relative inline-block" ref={visRef}>
          <button
            type="button"
            onClick={openVisibilityPopup}
            className={`visibility ${
              props?.status == "public" ? "public" : "private"
            }`}
            aria-haspopup="dialog"
            aria-expanded={visOpen}
          >
            {props?.status == "public" ? PublicSVG : PrivateSVG}
            &nbsp;{capitalizeFirstLetter(props?.status)}
          </button>

          {visOpen &&
            typeof document !== "undefined" &&
            createPortal(
              isMobileViewport ? (
                <div
                  className="fixed inset-0 z-100 flex items-end justify-center"
                  onClick={() => setVisOpen(false)}
                >
                  <div className="absolute inset-0 bg-black/50" />
                  <div
                    className="rowVisibilitySheet relative w-full max-w-lg animate-slide-up rounded-t-3xl bg-(--background1) pb-safe"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="flex justify-center py-3">
                      <div className="h-1 w-10 rounded-full bg-(--border1)" />
                    </div>
                    <div className="px-4 pb-2">
                      <h3 className="text-base font-semibold">Change visibility</h3>
                    </div>

                    <div className="flex flex-col gap-2 px-4 py-2">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`visibility-${props?.id}`}
                          value="public"
                          checked={draftVisibility === "public"}
                          onChange={() => setDraftVisibility("public")}
                          className="appearance-none rounded-full! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative
                              checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                        />
                        Public
                      </label>

                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="radio"
                          name={`visibility-${props?.id}`}
                          value="private"
                          checked={draftVisibility === "private"}
                          onChange={() => setDraftVisibility("private")}
                          className="appearance-none rounded-full! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative
                              checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                        />
                        Private
                      </label>
                    </div>

                    <div className="px-4 pb-4 pt-2 flex gap-2">
                      <button
                        type="button"
                        onClick={cancelVisibility}
                        className="flex-1 rounded-full border border-(--border1) bg-(--background2) py-3 font-medium hover:bg-(--background3) transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>

                      <button
                        type="button"
                        onClick={saveVisibility}
                        className="flex-1 rounded-full text-white bg-(--accentBlue) hover:bg-(--accentBlue2) py-3 font-medium transition-colors cursor-pointer"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div
                  ref={visPopupRef}
                  role="dialog"
                  aria-label="Change visibility"
                  style={visPopupStyle}
                  className="rowVisibilityPopup z-50 rounded-2xl border! border-(--border1)! bg-(--background1) p-3 shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex flex-col gap-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`visibility-${props?.id}`}
                        value="public"
                        checked={draftVisibility === "public"}
                        onChange={() => setDraftVisibility("public")}
                        className="appearance-none rounded-full! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative
                            checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                      />
                      Public
                    </label>

                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name={`visibility-${props?.id}`}
                        value="private"
                        checked={draftVisibility === "private"}
                        onChange={() => setDraftVisibility("private")}
                        className="appearance-none rounded-full! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative
                            checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
                      />
                      Private
                    </label>
                  </div>

                  <div className="mt-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={cancelVisibility}
                      className="rounded-full border border-(--border1) duration-200 bg-(--background2) hover:bg-(--background3) px-4 py-1.5 text-sm cursor-pointer"
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      onClick={saveVisibility}
                      className="rounded-full text-white bg-(--accentBlue) duration-200 hover:bg-(--accentBlue2) px-4 py-1.5 text-sm cursor-pointer"
                    >
                      Save
                    </button>
                  </div>
                </div>
              ),
              document.body
            )}
        </div>
      </td>

      <td>
        <p>{formatDate(props?.created_at)}</p>
      </td>

      <td>
        <p>{formatViews(props?.view_count)}</p>
      </td>

      <td>
        <p>{props?.video_count}</p>
      </td>

      <td>
        <p>{props?.save_count}</p>
      </td>
    </tr>
  );
}

export default memo(PlaylistRow);

function capitalizeFirstLetter(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
