import { useQueries, useQuery } from "@tanstack/react-query";
import { ShareSVG, ArrowSVG, LikeSVG, DislikeSVG, InfoSVG, CommentSVG } from "~/constants";
import { fetchFn } from "~/API";
import { env } from "~/env";
import { formatDate, formatViews, formatDescription, getToken } from "~/functions";
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FetchCommentRepliesT, FetchVideoCommentsT, VideoT } from "~/types";
import { Link, useLocation } from "react-router";
import ChairPopup from "./chairPopup";
import InfoPopup from "./infoPopup";
import { useI18n } from "~/i18n";

async function fetchAllComments(videoId: string, headers: Headers): Promise<FetchVideoCommentsT> {
    const firstPage = await fetchFn<FetchVideoCommentsT>({
        route: `api/videos/${videoId}/comments?limit=100&page=1`,
        options: {
            method: "GET",
            headers,
        },
    });

    const totalPages = Math.max(firstPage.total_pages ?? 1, 1);

    if (totalPages === 1) {
        return firstPage;
    }

    const restPages = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, index) =>
            fetchFn<FetchVideoCommentsT>({
                route: `api/videos/${videoId}/comments?limit=100&page=${index + 2}`,
                options: {
                    method: "GET",
                    headers,
                },
            })
        )
    );

    const commentsMap = new Map<string, FetchVideoCommentsT["comments"][number]>();

    for (const comment of firstPage.comments) {
        commentsMap.set(comment.id, comment);
    }

    for (const page of restPages) {
        for (const comment of page.comments) {
            commentsMap.set(comment.id, comment);
        }
    }

    return {
        ...firstPage,
        comments: Array.from(commentsMap.values()),
    };
}

async function fetchAllReplies(parentId: string, headers: Headers): Promise<FetchCommentRepliesT> {
    const firstPage = await fetchFn<FetchCommentRepliesT>({
        route: `api/comments/${parentId}/replies?limit=100&page=1`,
        options: {
            method: "GET",
            headers,
        },
    });

    const totalPages = Math.max(firstPage.total_pages ?? 1, 1);

    if (totalPages === 1) {
        return firstPage;
    }

    const restPages = await Promise.all(
        Array.from({ length: totalPages - 1 }, (_, index) =>
            fetchFn<FetchCommentRepliesT>({
                route: `api/comments/${parentId}/replies?limit=100&page=${index + 2}`,
                options: {
                    method: "GET",
                    headers,
                },
            })
        )
    );

    const repliesMap = new Map<string, FetchCommentRepliesT["replies"][number]>();

    for (const reply of firstPage.replies) {
        repliesMap.set(reply.id, reply);
    }

    for (const page of restPages) {
        for (const reply of page.replies) {
            repliesMap.set(reply.id, reply);
        }
    }

    return {
        ...firstPage,
        replies: Array.from(repliesMap.values()),
    };
}

async function fetchReplyThread(rootParentId: string, headers: Headers): Promise<FetchCommentRepliesT> {
    const queue = [rootParentId];
    const visitedParents = new Set<string>();
    const repliesMap = new Map<string, FetchCommentRepliesT["replies"][number]>();
    let videoId = "";

    while (queue.length > 0) {
        const parentId = queue.shift();
        if (!parentId || visitedParents.has(parentId)) continue;

        visitedParents.add(parentId);
        const response = await fetchAllReplies(parentId, headers);
        videoId = response.video_id || videoId;

        for (const reply of response.replies) {
            const alreadySeen = repliesMap.has(reply.id);
            repliesMap.set(reply.id, reply);

            if (!alreadySeen && (reply.reply_count ?? 0) > 0) {
                queue.push(reply.id);
            }
        }
    }

    return {
        success: true,
        parent_id: rootParentId,
        video_id: videoId,
        page: 1,
        limit: 100,
        total: repliesMap.size,
        total_pages: 1,
        replies: Array.from(repliesMap.values()),
    };
}

const SkeletonVideoInfo = () => (
    <div className="videoInfo">
        <span className="videoTitleHolder flex items-start justify-between">
            <span className="flex-1">
                <div className="skeleton-video-title"></div>
                <div className="skeleton-video-meta"></div>
            </span>

            <span className="functional gap-3 max-[500px]:gap-2 flex items-center ml-3 max-[800px]:ml-0">
                <div className="flex bg-(--background2) rounded-full">
                    <div className="skeleton-like-button"></div>
                    <div className="skeleton-dislike-button"></div>
                </div>
                <div className="skeleton-share-button"></div>
            </span>
        </span>

        <span className="mt-3 p-3.75 bg-(--background2)! flex items-center">
            <div className="skeleton-author-label"></div>
            <span className="flex items-center gap-2">
                <div className="skeleton-author-image"></div>
                <div className="skeleton-author-name"></div>
            </span>
        </span>

        <span className="mt-3 p-3.75 bg-(--background2)! flex flex-col">
            <div className="skeleton-description-title"></div>
            <div className="skeleton-description-line"></div>
            <div className="skeleton-description-line"></div>
            <div className="skeleton-description-line short"></div>
            
            <span className="tags mt-3 flex gap-2 flex-wrap">
                <div className="skeleton-tag"></div>
                <div className="skeleton-tag"></div>
                <div className="skeleton-tag"></div>
            </span>
        </span>
    </div>
);

function VideoInfo({
    props,
    isLoading,
    onOpenChapter,
    onOpenComments,
}: {
    props?: VideoT,
    isLoading?: boolean,
    onOpenChapter: () => void,
    onOpenComments?: () => void
}) {
    const { t } = useI18n();
    const location = useLocation();

    const tagsArray = props?.tags?.map((item, index) => (
        <Link to={`/search?tag=${item}`} key={`tag${index}`} className="tag noHover">#{item}</Link>
    ))

    const stockThumbnailUrl = props?.thumbnail_url.split("?")[0];

    const [isExpanded, setIsExpanded] = useState(false);
    const [areTagsExpanded, setAreTagsExpanded] = useState(false);
    const [isHoveringTags, setIsHoveringTags] = useState(false);
    const [userReaction, setUserReaction] = useState(props?.user_reaction);
    const [likeCount, setLikeCount] = useState<number>(props?.like_count ?? 0);
    const [isReacting, setIsReacting] = useState(false);
    const [isChairPopupOpen, setIsChairPopupOpen] = useState(false);
    const [isChair, setIsChair] = useState(0);
    const [isInfoPopupOpen, setIsInfoPopupOpen] = useState(false);
    const [likeAnimation, setLikeAnimation] = useState(false);
    const [dislikeAnimation, setDislikeAnimation] = useState(false);
    const token = getToken();

    const commentHeaders = new Headers();
    commentHeaders.set("Content-Type", "application/json");
    if (token) {
        commentHeaders.set("Authorization", `Bearer ${token}`);
    }

    const { data: commentsData } = useQuery<FetchVideoCommentsT>({
        queryKey: ["video-comments-summary", props?.id],
        queryFn: () => fetchAllComments(props!.id, commentHeaders),
        enabled: !!props?.id && !!token,
        staleTime: 0,
        refetchOnMount: "always",
    });

    //REMOVE TOGGLE BUTTON FOR TAGS
    const videoTagsButton = useRef<HTMLButtonElement>(null);
    const videoTags = useRef<HTMLSpanElement>(null);

    useEffect(() => {
        const videoTagsHolder = videoTags.current;
        const videoTagsB = videoTagsButton.current;

        const handleTagsOverflow = () => {           
            if(videoTagsHolder && videoTagsB){
                if(videoTagsHolder.classList.contains("isCollapsed") && videoTagsHolder.scrollWidth <= videoTagsHolder.clientWidth)
                    videoTagsB.classList.add("displayNone");
                else
                    videoTagsB.classList.remove("displayNone");
            }
        }

        handleTagsOverflow();

        window.addEventListener("resize", handleTagsOverflow);

        return () => window.removeEventListener("resize", handleTagsOverflow);
    }, [props?.tags]);
    //

    const parentComments = commentsData?.comments.filter((comment) => !comment.parent_id) ?? [];

    const repliesQueries = useQueries({
        queries: parentComments.map((parent) => ({
            queryKey: ["video-comments-summary-replies", parent.id],
            queryFn: () => fetchReplyThread(parent.id, commentHeaders),
            enabled: !!token,
            staleTime: 0,
        })),
    });

    const resolvedCommentCount = commentsData
        ? (() => {
            const uniqueIds = new Set<string>();

            for (const parent of parentComments) {
                uniqueIds.add(parent.id);
            }

            for (const query of repliesQueries) {
                for (const reply of query.data?.replies ?? []) {
                    uniqueIds.add(reply.id);
                }
            }

            return uniqueIds.size;
        })()
        : (props?.comment_count ?? 0);

    const isClickOnTag = (target: EventTarget | null) => {
        if (!(target instanceof HTMLElement)) return false;
        return !!target.closest(".noHover");
    };

    const toggleLike = async () => {
        if (isReacting || !props) return;
        setIsReacting(true);
        setLikeAnimation(true);
        setTimeout(() => setLikeAnimation(false), 300);

        const prev = userReaction;
        const optimisticNext = prev === 1 ? 0 : 1;

        applyReactionChange(prev, optimisticNext);

        try {
            const myHeaders = new Headers();
            const token = getToken();
            if(!token) return;
            myHeaders.append("Authorization", `Bearer ${token}`);
            myHeaders.append("Content-Type", "application/json");

            const response = await fetch(
                `${env.apiBaseUrl}/api/videos/${props.id}/like`,
            { method: "POST", headers: myHeaders, redirect: "follow" }
            );

            const result = await response.json();
            const serverNext = result?.status ?? 0;
            applyReactionChange(optimisticNext, serverNext);
        } catch {
            applyReactionChange(optimisticNext, prev ?? 0);
        } finally {
            setIsReacting(false);
        }
    };

    const toggleDislike = async () => {
        if (isReacting || !props) return;
        setIsReacting(true);
        setDislikeAnimation(true);
        setTimeout(() => setDislikeAnimation(false), 300);

        const prev = userReaction;
        const optimisticNext = prev === -1 ? 0 : -1;

        applyReactionChange(prev, optimisticNext);

        try {
            const myHeaders = new Headers();
            const token = getToken();
            if(!token) return;
            myHeaders.append("Authorization", `Bearer ${token}`);
            myHeaders.append("Content-Type", "application/json");

            const response = await fetch(
                `${env.apiBaseUrl}/api/videos/${props.id}/dislike`,
            { method: "POST", headers: myHeaders, redirect: "follow" }
            );

            const result = await response.json();
            const serverNext = result?.status ?? 0;

            applyReactionChange(optimisticNext, serverNext);
        } catch {
            applyReactionChange(optimisticNext, prev ?? 0);
        } finally {
            setIsReacting(false);
        }
    };

    const applyReactionChange = (prev: number | undefined, next: number) => {
        setLikeCount((c) => {
            let delta = 0;
            if (prev === 1 && next !== 1) delta -= 1;
            if (prev !== 1 && next === 1) delta += 1;
            return c + delta;
        });

        setUserReaction(next);
    };

    useEffect(() => {
        setUserReaction(props?.user_reaction);
        setLikeCount(props?.like_count ?? 0);
    }, [props?.user_reaction, props?.like_count]);

    const shareVideoLink = useCallback(() => {
        const fullPath = env.siteUrl + location.pathname + location.hash;

        if(navigator.share)
            return navigator.share({
                title: t("shareVideo"),
                text: t("playlistShareText"),
                url: fullPath
            });
        
        if(navigator.clipboard && window.isSecureContext)
            return navigator.clipboard.writeText(fullPath);
    }, [location.pathname, location.hash, t]);

    const viewVideoCopyrights = () => {
        setIsInfoPopupOpen(true);
    }

    if (isLoading) {
        return <SkeletonVideoInfo />;
    }

    if (!props) return null;

    return <>
        <div className="videoInfo">
            <span className="videoTitleHolder flex items-start justify-between">
                <span>
                    <h2 className="text-xl font-medium max-[500px]:text-lg">{props?.title}</h2>
                    <p className="weakText text-sm max-[500px]:text-xs">{t("publishedOn")} {formatDate(props?.created_at)} • {formatViews(props?.view.counted ? props?.view_count + 1 : props?.view_count)}</p>
                </span>

                <span className="functional gap-2 flex items-center ml-3 max-[800px]:ml-0">
                    <div className="flex bg-(--background2) rounded-full">
                        <button 
                            className={`${userReaction == 1 ? "bookmarked" : ""} ${likeAnimation ? "like-animate" : ""} bg-transparent! rounded-r-none! border-r! border-r-(--border1)! hover:bg-(--background2)! pl-3.5!`} 
                            onClick={toggleLike}
                            title={t("likeVideo")}
                        >
                            {LikeSVG}
                            <p>{likeCount}</p>
                        </button>
                        <button 
                            className={`${userReaction == -1 ? "bookmarked" : ""} ${dislikeAnimation ? "dislike-animate" : ""} bg-transparent! rounded-l-none! hover:bg-(--background2)! pr-3.5!`} 
                            onClick={toggleDislike}
                            title={t("dislikeVideo")}
                        >
                            {DislikeSVG}
                        </button>
                    </div>

                    <button onClick={shareVideoLink} title={t("shareVideo")}>
                        {ShareSVG}
                        <p>{t("share")}</p>
                    </button>

                    <button className="p-1.75!" onClick={viewVideoCopyrights} title={t("viewCopyrightInfo")}>
                        {InfoSVG}
                    </button>
                </span>
            </span>

            {props?.people?.filter((person) => person?.type == 0).length > 0 ?
            <span className="mt-3 p-3.75 author rounded-2xl! flex items-center transition-all cursor-pointer bg-(--background2)! hover:bg-(--background3)! max-[500px]:flex-col max-[500px]:items-start max-[500px]:gap-3" onClick={() => {setIsChairPopupOpen(true); setIsChair(0);}} role="button" tabIndex={0}>
                <h2 className="text-lg font-semibold mr-2 max-[500px]:text-sm">{t("chairsLabel")}</h2>

                <span>
                    {props?.people
                        ?.filter((person) => person?.type == 0)
                        ?.map((person, index) => 
                        <img key={index} src={person?.image_url} alt="Profile" />
                    )}
                    <p className="weakText max-[500px]:text-sm">{`${props?.people?.filter((person) => person?.type == 0)?.map(person => person.name).join(", ") || t("noChairs")}`}</p>
                </span>
            </span> 
            : null}

            {props?.people?.filter((person) => person?.type == 1).length > 0 ?
            <span className="mt-3 p-3.75 author rounded-2xl! flex items-center transition-all cursor-pointer bg-(--background2)! hover:bg-(--background3)! max-[500px]:flex-col max-[500px]:items-start max-[500px]:gap-3" onClick={() => {setIsChairPopupOpen(true); setIsChair(1);}} role="button" tabIndex={0}>
                <h2 className="text-lg font-semibold mr-2 max-[500px]:text-sm">{t("speakersLabel")}</h2>

                <span>
                    {props?.people
                        ?.filter((person) => person?.type == 1)
                        ?.map((person, index) => 
                        <img key={index} src={person?.image_url} alt="Profile" />
                    )}
                    <p className="weakText max-[500px]:text-sm">{`${props?.people?.filter((person) => person?.type == 1)?.map(person => person.name).join(", ") || t("noSpeakers")}`}</p>
                </span>
            </span>
            : null}

            <span
                className={`mt-3 p-3.75 rounded-2xl! bg-(--background2)! other flex flex-col transition-all ${
                !isExpanded && !isHoveringTags ? "cursor-pointer hover:bg-(--background3)!" : ""
                }`}
            >
                <div className="weakText description"
                    onClick={(e) => {
                    if (isExpanded) return;
                    if (isClickOnTag(e.target)) return;
                    setIsExpanded(true);
                    }}
                >
                    <h2 className="mb-2 text-lg font-semibold max-[500px]:text-sm">{t("description")}</h2>

                    <p className={`max-[500px]:text-sm ${!isExpanded ? "line-clamp-4" : ""}`}>
                        {formatDescription(props?.description) || t("noDescription")}
                    </p>

                    {!isExpanded ? (
                        <span className="font-semibold mt-1 max-[500px]:text-sm">{t("more")}</span>
                    ) : (
                        <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setIsExpanded(false);
                        }}
                        className="showLess font-semibold mt-2 mb-5 hover:opacity-80 transition-opacity cursor-pointer bg-(--accentBlue) px-4 py-1.5 rounded-full flex gap-3 items-center"
                        >
                        {ArrowSVG}
                        <p className="text-white">{t("showLess")}</p>
                        </button>
                    )}
                </div>

                {props?.chapters?.length > 0 && (
                    <button className="viewVideoChapters noHover"
                        onMouseEnter={() => setIsHoveringTags(true)}
                        onMouseLeave={() => setIsHoveringTags(false)}
                        onPointerEnter={() => setIsHoveringTags(true)}
                        onPointerLeave={() => setIsHoveringTags(false)}
                        onClick={onOpenChapter}
                    >
                        <span>
                            <img src={`${stockThumbnailUrl}?time=${props?.duration_seconds/9}&width=50&height=30`} alt="ChapterImages" />
                            <img src={`${stockThumbnailUrl}?time=${props?.duration_seconds/6}&width=50&height=30`} alt="ChapterImages" />
                            <img src={`${stockThumbnailUrl}?time=${props?.duration_seconds/3}&width=50&height=30`} alt="ChapterImages" />
                        </span>
                        <p>{t("videoChapterCount", { count: props?.chapters?.length || 0 })} {ArrowSVG}</p>
                    </button>
                )}

                {onOpenComments && (
                    <button
                        className="viewVideoComments noHover"
                        onMouseEnter={() => setIsHoveringTags(true)}
                        onMouseLeave={() => setIsHoveringTags(false)}
                        onPointerEnter={() => setIsHoveringTags(true)}
                        onPointerLeave={() => setIsHoveringTags(false)}
                        onClick={onOpenComments}
                    >
                        <p>{CommentSVG} {t("commentCount", { count: resolvedCommentCount })} {ArrowSVG}</p>
                    </button>
                )}

                {!!props?.tags?.length && (
                    <div
                        className="videoTagsBar mt-3"
                        onMouseEnter={() => setIsHoveringTags(true)}
                        onMouseLeave={() => setIsHoveringTags(false)}
                        onPointerEnter={() => setIsHoveringTags(true)}
                        onPointerLeave={() => setIsHoveringTags(false)}
                    >
                        <span
                            ref={videoTags}
                            className={`tags ${areTagsExpanded ? "isExpanded" : "isCollapsed"}`}
                        >
                            {tagsArray}
                        </span>

                        <button
                            ref={videoTagsButton}
                            type="button"
                            className={`videoTagsToggle noHover ${areTagsExpanded ? "isExpanded" : ""}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setAreTagsExpanded((current) => !current);
                            }}
                            aria-label={areTagsExpanded ? t("showLess") : t("more")}
                            title={areTagsExpanded ? t("showLess") : t("more")}
                        >
                            {ArrowSVG}
                        </button>
                    </div>
                )}
            </span>

            <ChairPopup props={props} open={isChairPopupOpen} type={isChair} onClose={() => setIsChairPopupOpen(false)} />
            <InfoPopup text={t("videoCopyrightInfo")} open={isInfoPopupOpen} onClose={() => setIsInfoPopupOpen(false)} />
        </div>
    </>;
}

export default VideoInfo;


