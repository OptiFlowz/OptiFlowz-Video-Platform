import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router";
import { fetchFn } from "~/API";
import type { fetchVideo } from "~/types";
import Item from "../itemSlider/item";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";
import { useRouter } from "next/navigation";

const SkeletonItem = () => (
    <div className="skeleton-item">
        <div className="skeleton-thumbnail"></div>
        <div className="skeleton-content">
            <div className="skeleton-title"></div>
            <div className="skeleton-text"></div>
            <div className="skeleton-text short"></div>
        </div>
    </div>
);

function VideosPage(){
    const { t } = useI18n();
    const {type} = useParams();
    const token = getToken();
    const router = useRouter();
    const loadMoreRef = useRef<HTMLDivElement>(null);
    const requiresAuth = type === '0' || type === '1' || type === '3' || type === '4';

    const {route, title} = useMemo<{route: string, title: string}>(() => {
        switch(type){
            case '0': {
                return {
                    route: `api/videos/user/continue`,
                    title: t("continueWatching")
                }
            }
            case '1': {
                return {
                    route: `api/videos/user/recommended`,
                    title: t("recommendedForYou")
                }
            }
            case '2': {
                return {
                    route: `api/videos/trending`,
                    title: t("navTrending")
                }
            }
            case '3': {
                return {
                    route: `api/videos/user/liked`,
                    title: t("savedVideos")
                }
            }
            case '4': {
                return {
                    route: `api/videos/user/history`,
                    title: t("watchHistory")
                }
            }
            default:
                return {
                    route: '',
                    title: ''
                }
        }
    }, [type]);

    const {
        data,
        fetchNextPage,
        isFetchingNextPage,
        status,
        refetch
    } = useInfiniteQuery<fetchVideo, Error, InfiniteData<fetchVideo, number>>({
        queryKey: ["infinite", type],
        queryFn: ({pageParam}) => fetchFn<fetchVideo>({
            route: `${route}?page=${pageParam}`,
            options: {
                method: "GET",
                headers: token ? {Authorization: `Bearer ${token}`} : {}
            }
        }),
        getNextPageParam: () => undefined,
        initialPageParam: 1,
        staleTime: 5 * 60 * 1000,
        enabled: !!route && (!requiresAuth || !!token)
    });

    useEffect(() => {
        if (!route || !requiresAuth || token) return;

        const redirectTarget = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        router.replace(`/login?redirect=${encodeURIComponent(redirectTarget)}`);
    }, [requiresAuth, route, router, token]);

    useEffect(() => {
        if(type === '1' && token) refetch();
    }, [type, token, refetch]);

    useEffect(() => {
        if (isFetchingNextPage) return;

        const observer = new IntersectionObserver(entries => {
            if(entries[0].isIntersecting) fetchNextPage();
        }, { rootMargin: "400px" });

        const el = loadMoreRef.current;
        if(el) observer.observe(el);

        return () => {if(el) observer.unobserve(el)}
    }, [isFetchingNextPage, fetchNextPage]);

    if (!route || (requiresAuth && !token)) return null;

    const skeletonArray = Array.from({ length: 12 }).map((_, index) => (
        <SkeletonItem key={`skeleton-${index}`} />
    ));

    const itemsArray = data?.pages.flatMap((page) => page.videos)?.map((item, index) => (
            <Item key={`${type}${index}`} props={item} />
        ));

    return (
        <main ref={loadMoreRef} className="videos">
            <div className="heading">
                <h2 className="font-bold -mt-5 text-3xl max-[520px]:text-2xl mb-6 max-[1075px]:mb-5 max-[1075px]:mt-1 max-[450px]:mb-5">{title}</h2>
            </div>

            {itemsArray?.length == 0 && type == '1' ? 
            <div className="watchToRecommend">{t("watchSomeVideos")}</div> 
            : 
            <div className="holder collection mb-15 max-[1075px]:mb-8 max-[450px]:mb-5">
                {status === 'pending' ? skeletonArray : itemsArray}
                {isFetchingNextPage && skeletonArray}
            </div>}
        </main>
    );
}

export default VideosPage;
