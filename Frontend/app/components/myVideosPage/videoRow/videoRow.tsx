import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { createPortal } from "react-dom";
import {
  DeleteSVG,
  EditSVG,
  PlaySVG,
  PrivateSVG,
  PublicSVG,
  ThreeDotMenuSVG,
} from "~/constants";
import {
  formatDate,
  formatDescription,
  formatDuration,
  formatViews,
  getToken,
} from "~/functions";
import type { fetchVideo, VideoT } from "~/types";
import { ConfirmDialog } from "~/components/confirmPopup/confirmDialog";
import { useConfirm } from "~/components/confirmPopup/useConfirm";
import { fetchFn } from "~/API";

function VideoRow({ props }: { props: VideoT & {setSelectedVideos: React.Dispatch<React.SetStateAction<VideoT[]>>}}) {
  const [isHidden, setIsHidden] = useState(false);
  const { confirm, dialogProps } = useConfirm();
  const queryClient = useQueryClient();

  const myHeaders = useRef(new Headers());

  const [visOpen, setVisOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [draftVisibility, setDraftVisibility] = useState<"public" | "private">(
    props?.visibility === "public" ? "public" : "private"
  );
  const visRef = useRef<HTMLDivElement | null>(null);
  const visPopupRef = useRef<HTMLDivElement | null>(null);
  const [visPopupStyle, setVisPopupStyle] = useState<React.CSSProperties>({});

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
    setDraftVisibility(props?.visibility === "public" ? "public" : "private");
  }, [props?.visibility]);

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
        setDraftVisibility(
          props?.visibility === "public" ? "public" : "private"
        );
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [visOpen, props?.visibility]);

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

  // Prevent body scroll when mobile menu is open
  useEffect(() => {
    if (mobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileMenuOpen]);

  useLayoutEffect(() => {
    const userToken = getToken();
    if (!userToken || myHeaders.current.has("Authorization")) return;

    myHeaders.current.append("Content-Type", "application/json");
    myHeaders.current.append("Authorization", `Bearer ${userToken}`);
  }, []);

  const openVisibilityPopup = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraftVisibility(props?.visibility === "public" ? "public" : "private");
    setVisOpen(true);
  };

  const cancelVisibility = (e: React.MouseEvent) => {
    e.stopPropagation();
    setVisOpen(false);
    setDraftVisibility(props?.visibility === "public" ? "public" : "private");
  };

  const saveVisibility = async (e: React.MouseEvent) => {
    e.stopPropagation();

    await fetchFn<fetchVideo>({
      route: `api/video-moderation/video-details/${props.id}`,
      options: {
        method: "PATCH",
        headers: myHeaders.current,
        body: JSON.stringify({
          visibility: draftVisibility,
        })
      },
    });

    queryClient.setQueriesData<fetchVideo>(
      { queryKey: ["my-videos"] },
      (old) => {
        if (!old) return old;

        return {
          ...old,
          videos: old.videos.map((video) =>
            video.id === props.id
              ? { ...video, visibility: draftVisibility }
              : video
          ),
        };
      }
    );
    
    setVisOpen(false);
  };

  const handleDelete = async () => {
    setMobileMenuOpen(false);

    const ok = await confirm({
      title: `Delete video "${props?.title}"?`,
      message: "This action cannot be undone.",
      yesText: "Delete",
      noText: "Cancel",
    });

    if (!ok) return;
    const res = await fetchFn<any>({
      route: `api/video-moderation/video/${props.id}`,
      options: {
        method: "DELETE",
        headers: myHeaders.current
      },
    });
    if(res?.success){
      setIsHidden(true);
    }
  };

  const handleWatch = () => {
    setMobileMenuOpen(false);
    window.location.href = `/video/${props?.id}`;
  };

  const handleEdit = () => {
    setMobileMenuOpen(false);
    window.location.href = `/edit?video=${props?.id}`;
  };

  if (isHidden) return null;

  return (
    <tr key={props?.id}>
      <td>
        <span>
          <input
            onChange={e => {
              const {setSelectedVideos, ...other} = props;

              if(e.target.checked)
                props.setSelectedVideos(prev => [other, ...prev]);
              else
                props.setSelectedVideos(prev => prev.filter(video => video.id != other.id));
            }}
            className="appearance-none rounded-lg! p-3! border! border-(--border1)! cursor-pointer bg-(--background2) checked:bg-(--accentOrange)! transition-colors relative
                        checked:after:content-['✓'] checked:after:absolute checked:after:text-white checked:after:text-sm checked:after:left-1/2 checked:after:top-1/2 checked:after:-translate-x-1/2 checked:after:-translate-y-1/2"
            type="checkbox"
          />
          <span className="videoInfo">
            <div className="relative">
              <img src={props?.thumbnail_url} alt="Thumbnail" loading="lazy" decoding="async" />
              <p className="duration">
                {formatDuration(props?.duration_seconds)}
              </p>
            </div>
            <span className="flex flex-col gap-0.5 rounded-none!">
              <h3>{props?.title}</h3>
              <h5 className="line-clamp-2 font-light!">
                {formatDescription(props?.description || "No description")}
              </h5>
              <div className="videoActions">
                <Link
                  to={`/video/${props?.id}`}
                  title="Play Video"
                >
                  {PlaySVG}
                </Link>
                <Link to={`/edit?video=${props?.id}`}  title="Edit Video">{EditSVG}</Link>
                <button onClick={handleDelete} title="Delete Video">
                  {DeleteSVG}
                </button>
              </div>
            </span>
            <button
              className="mobileOptionsButton"
              onClick={() => setMobileMenuOpen(true)}
            >
              {ThreeDotMenuSVG}
            </button>
          </span>
        </span>
        <ConfirmDialog {...dialogProps} />

        {/* Mobile Options Bottom Sheet */}
        {mobileMenuOpen &&
          typeof document !== "undefined" &&
          createPortal(
            <div
              className="fixed inset-0 z-100 flex items-end justify-center"
              onClick={() => setMobileMenuOpen(false)}
            >
              <div className="absolute inset-0 bg-black/50" />

              <div
                className="rowActionSheet relative w-full max-w-lg animate-slide-up rounded-t-3xl bg-(--background1) pb-safe"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex justify-center py-3">
                  <div className="h-1 w-10 rounded-full bg-(--border1)" />
                </div>

                <div className="flex items-center gap-3 px-4 pb-3 border-b border-(--border1)">
                  <img
                    src={props?.thumbnail_url}
                    alt="Thumbnail"
                    className="h-12 w-20 rounded-lg object-cover"
                  />
                  <p className="text-sm font-medium line-clamp-2 flex-1">
                    {props?.title}
                  </p>
                </div>

                <div className="flex flex-col py-2">
                  <button
                    onClick={handleWatch}
                    className="flex items-center gap-4 px-4 py-3 text-left hover:bg-(--background2) active:bg-(--background3) transition-colors cursor-pointer"
                  >
                    <span className="w-6 h-6 flex items-center justify-center playSvg">
                      {PlaySVG}
                    </span>
                    <span>Watch Video</span>
                  </button>

                  <button
                    onClick={handleEdit}
                    className="flex items-center gap-4 px-4 py-3 text-left hover:bg-(--background2) active:bg-(--background3) transition-colors cursor-pointer"
                  >
                    <span className="w-6 h-6 flex items-center justify-center">
                      {EditSVG}
                    </span>
                    <span>Edit Video</span>
                  </button>

                  <button
                    onClick={handleDelete}
                    className="flex items-center gap-4 px-4 py-3 text-left hover:bg-(--background2) active:bg-(--background3) transition-colors cursor-pointer"
                  >
                    <span className="w-6 h-6 flex items-center justify-center">
                      {DeleteSVG}
                    </span>
                    <span>Delete Video</span>
                  </button>
                </div>

                <div className="px-4 pb-4 pt-2">
                  <button
                    onClick={() => setMobileMenuOpen(false)}
                    className="w-full rounded-full border border-(--border1) bg-(--background2) py-3 font-medium hover:bg-(--background3) transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>,
            document.body
          )}
      </td>

      <td>
        <div className="relative inline-block" ref={visRef}>
          <button
            type="button"
            onClick={openVisibilityPopup}
            className={`visibility ${
              props?.visibility == "public" ? "public" : "private"
            }`}
            aria-haspopup="dialog"
            aria-expanded={visOpen}
          >
            {props?.visibility == "public" ? PublicSVG : PrivateSVG}
            &nbsp;{capitalizeFirstLetter(props?.visibility)}
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
                  className="rowVisibilityPopup z-50 border! border-(--border1)! rounded-2xl bg-(--background1) p-3 shadow-2xl"
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
        <p>{props?.comment_count || 0}</p>
      </td>

      <td>
        <p>{props?.like_count}</p>
        <p>
          {`${
            props?.like_count > 0
              ? (
                  (props?.like_count /
                    (props?.like_count + props?.dislike_count)) *
                  100
                ).toFixed(0)
              : 0
          }%`}
        </p>
      </td>
    </tr>
  );
}

export default memo(VideoRow);

function capitalizeFirstLetter(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}
