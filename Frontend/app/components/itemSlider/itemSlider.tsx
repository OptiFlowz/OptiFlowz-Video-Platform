import { useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { fetchVideo, ItemSliderT, fetchFeaturedPlaylist } from "~/types";
import { Link } from "react-router";
import { ArrowSVG } from "~/constants";
import { useQuery } from "@tanstack/react-query";
import { fetchFn } from "~/API";
import Item from "./item";
import { CurrentNavContext } from "~/context";
import PlaylistItem from "./playlistItem";
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

function ItemSlider({props}: {props: ItemSliderT}){
    const { t } = useI18n();
    // const { onDataStateChange } = props;
    const myHeaders = useRef(new Headers());
    const [token, setToken] = useState("");
    const collectionRef = useRef<HTMLDivElement>(null);
    const sliderTitle = useRef('');
    const [hasOverflow, setHasOverflow] = useState(false);
    const [showLeftFade, setShowLeftFade] = useState(false);
    const [showRightFade, setShowRightFade] = useState(false);
    const {setCurrentNav} = useContext(CurrentNavContext);

    let route = null;
    const isPlaylist = props.type === 5 || props.type === 6;
    switch(props.type){
        case 0: {
            route = `api/videos/user/continue?limit=${props.limit || 20}`;
            sliderTitle.current = t("continueWatching");
            break;
        }
        case 1: {
            route = `api/videos/user/recommended?limit=${props.limit || 20}`;
            sliderTitle.current = t("recommendedForYou");
            break;
        }
        case 2: {
            route = `api/videos/trending?limit=${props.limit || 20}`;
            sliderTitle.current = t("navTrending");
            break;
        }
        case 3: {
            route = `api/videos/user/liked?limit=${props.limit || 20}`;
            sliderTitle.current = t("likedVideos");
            break;
        }
        case 4: {
            route = `api/videos/user/history?limit=${props.limit || 20}`;
            sliderTitle.current = t("watchHistory");
            break;
        }
        case 5:
            route = `api/playlists/featured?limit=${props.limit || 20}`;
            sliderTitle.current = t("featuredPlaylists");
            break;
        case 6:
            route = `api/playlists/user/saved?limit=${props.limit || 20}`;
            sliderTitle.current = t("savedPlaylists");
            break;
        default:
            break;
    }

    useLayoutEffect(() => {
        const userToken = getToken();
        if(!userToken) return;
        setToken(userToken);
        myHeaders.current.set("Authorization", `Bearer ${userToken}`);
    }, [])

    type SliderData = fetchVideo | fetchFeaturedPlaylist;

    const { data } = useQuery<SliderData>({
        queryKey: [isPlaylist ? "playlist" : "video", props.type, props.limit],
        queryFn: () => {
            if (!route) throw new Error("Route is null");

            return isPlaylist
            ? fetchFn<fetchFeaturedPlaylist>({ route, options: { method: "GET", headers: myHeaders.current } })
            : fetchFn<fetchVideo>({ route, options: { method: "GET", headers: myHeaders.current } });
        },
        enabled: !!token && !!route,
        staleTime: 5 * 60 * 1000,
        gcTime: 30 * 60 * 1000,
        refetchOnMount: false,
        refetchOnWindowFocus: false,
    });

    // Provera da li postoji overflow
    useEffect(() => {
        const updateScrollState = () => {
            if (!collectionRef.current) return;

            const { scrollLeft, scrollWidth, clientWidth } = collectionRef.current;
            const maxScrollLeft = scrollWidth - clientWidth;
            const hasScrollableContent = (data !== null) && maxScrollLeft > 1;

            setHasOverflow(hasScrollableContent);
            setShowLeftFade(hasScrollableContent && scrollLeft > 1);
            setShowRightFade(hasScrollableContent && scrollLeft < maxScrollLeft - 1);
        };

        updateScrollState();

        const currentCollection = collectionRef.current;
        currentCollection?.addEventListener('scroll', updateScrollState, { passive: true });
        window.addEventListener('resize', updateScrollState);

        return () => {
            currentCollection?.removeEventListener('scroll', updateScrollState);
            window.removeEventListener('resize', updateScrollState);
        };
    }, [data]);

    if (!route) return null;

    const empty = !data || (("videos" in data) && data.videos.length === 0) || (("playlists" in data) && data.playlists.length === 0);
    if (empty && data && props.type != 1) return null;

    // Funkcije za skrolovanje
    const scrollLeft = () => {
        if (collectionRef.current) {
            collectionRef.current.scrollBy({
                left: -800,
                behavior: 'smooth'
            });
        }
    };

    const scrollRight = () => {
        if (collectionRef.current) {
            collectionRef.current.scrollBy({
                left: 800,
                behavior: 'smooth'
            });
        }
    };

    const skeletonArray = Array.from({ length: props.limit || 4 }).map((_, index) => (
        <SkeletonItem key={`skeleton-${index}`} />
    ));

    const itemsArray = data &&
    ("videos" in data)
        ? data.videos.map((item, index) => (
            <Item key={`${props.type}${index}`} props={item} />
        ))
        : data && ("playlists" in data)
        ? data.playlists.map((pl, index) => (
            <PlaylistItem key={`playlist-${index}`} props={pl} featured={true}/>
        ))
    : null;

    return (
        <div className="contentSection mt-8 max-[450px]:mt-3">
            <span className="collection-header">
                <span className="flex items-center gap-5">
                    <h2 className="subTitle p-0!">{sliderTitle.current}</h2>

                    {props.type != 1 && itemsArray && itemsArray.length >= 5 && <Link className="button flex items-center gap-2 z-1" to={`/videos/${props.type}`} onClick={() => setCurrentNav(-1)}>
                        <p className="font-semibold">{t("viewAll")}</p>
                        {ArrowSVG}
                    </Link>}
                </span>
                
                {data && props.type != 1 && hasOverflow && (
                    <div className="scroll-buttons">
                        <button 
                            className="scrollLeftBtn" 
                            onClick={scrollLeft}
                            aria-label={t("scrollLeft")}
                        >
                            {ArrowSVG}
                        </button>
                        <button 
                            className="scrollRightBtn" 
                            onClick={scrollRight}
                            aria-label={t("scrollRight")}
                        >
                            {ArrowSVG}
                        </button>
                    </div>
                )}
            </span>

            {itemsArray?.length == 0 && props.type == 1 ? 
                <div className="watchToRecommend">{t("watchSomeVideos")}</div> 
                : 
                <div
                    className={`collectionViewport ${showLeftFade ? "show-left-fade" : ""} ${showRightFade ? "show-right-fade" : ""} ${props.type == 1 ? 'notscrollable' : ''}`}
                >
                    <div ref={collectionRef} className={`collection ${props.type == 1 ? 'notscrollable' : ''} ${isPlaylist ? "featuredColl" : ""}`}>
                        {!data ? skeletonArray : itemsArray}
                    </div>
                    {/* <div ref={collectionRef} className={`collection ${props.type == 1 ? 'notscrollable' : ''} ${isPlaylist ? "featuredColl" : ""}`}>
                        
                        {skeletonArray}
                    </div> */}
                </div>
            }
        </div>
    );
}

export default ItemSlider;
