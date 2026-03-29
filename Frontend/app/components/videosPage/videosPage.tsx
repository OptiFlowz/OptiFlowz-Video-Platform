import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { fetchFn } from "~/API";
import type { fetchVideo } from "~/types";
import Item from "../itemSlider/item";
import { getToken } from "~/functions";
import { useI18n } from "~/i18n";

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
    const title = useRef('');
    const [token, setToken] = useState(String);
    const myHeaders = useRef(new Headers());
    const loadMoreRef = useRef<HTMLDivElement>(null);

    let route = null;
    switch(type){
        case '0': {
            route = `api/videos/user/continue`;
            title.current = t("continueWatching");
            break;
        }
        case '1': {
            route = `api/videos/user/recommended`;
            title.current = t("recommendedForYou");
            break;
        }
        case '2': {
            route = `api/videos/trending`;
            title.current = t("navTrending");
            break;
        }
        case '3': {
            route = `api/videos/user/liked`;
            title.current = t("savedVideos");
            break;
        }
        case '4': {
            route = `api/videos/user/history`;
            title.current = t("watchHistory");
            break;
        }
        default:
            break;
    }

    useLayoutEffect(() => {
        const userToken = getToken();
        if(!userToken) return;
        setToken(userToken);

        if(token)
            myHeaders.current.append("Authorization", `Bearer ${userToken}`);
    }, [token])

    const {
        data,
        fetchNextPage,
        isFetchingNextPage,
        status,
    } = useInfiniteQuery<fetchVideo, Error, InfiniteData<fetchVideo, number>>({
        queryKey: ["infinite", type],
        queryFn: ({pageParam}) => fetchFn<fetchVideo>({route: `${route}?page=${pageParam}`, options: {method: "GET", headers: myHeaders.current}}),
        getNextPageParam: () => undefined,
        initialPageParam: 1,
        staleTime: 5*3600,
        enabled: !!token && !!route
    });

    useEffect(() => {
        if (isFetchingNextPage) return;

        const observer = new IntersectionObserver(entries => {
            if(entries[0].isIntersecting) fetchNextPage();
        }, { rootMargin: "400px" });

        const el = loadMoreRef.current;
        if(el) observer.observe(el);

        return () => {if(el) observer.unobserve(el)}
    }, [isFetchingNextPage, fetchNextPage]);

    if (!route) return null;

    const skeletonArray = Array.from({ length: 12 }).map((_, index) => (
        <SkeletonItem key={`skeleton-${index}`} />
    ));

    const itemsArray = data?.pages.flatMap((page) => page.videos)?.map((item, index) => (
            <Item key={`${type}${index}`} props={item} />
        ));

    return (
        <main ref={loadMoreRef} className="videos">
            <div className="heading">
                <h2 className="font-bold -mt-5 text-3xl max-[520px]:text-2xl mb-6 max-[1075px]:mb-5 max-[1075px]:mt-1 max-[450px]:mb-5">{title?.current}</h2>
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
