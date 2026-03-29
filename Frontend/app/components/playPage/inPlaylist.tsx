import type { VideoPlaylistT } from "~/types";
import PlaylistItem from "../itemSlider/playlistItem";
import Loader from "../loaders/loader";
import { useEffect, useRef, useState } from "react";
import { ArrowSVG } from "~/constants";
import { useI18n } from "~/i18n";

function InPlaylist({props}: {props: VideoPlaylistT[]}){
    const { t } = useI18n();
    const loaderRef = useRef<HTMLDivElement>(null);
    const [hasOverflow, setHasOverflow] = useState(false);
    const collectionRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const checkOverflow = () => {
            if (collectionRef.current) {
                const hasScrollableContent = collectionRef.current.scrollWidth > collectionRef.current.clientWidth;
                setHasOverflow(hasScrollableContent);
            }
        };

        checkOverflow();
        window.addEventListener("resize", checkOverflow);

        return () => window.removeEventListener("resize", checkOverflow);
    }, [props]);

    const itemsArray = props?.map(item =>
        <PlaylistItem key={item.id} props={item} />
    );

    const scrollLeft = () => {
        if (collectionRef.current) {
            collectionRef.current.scrollBy({
                left: -400,
                behavior: "smooth"
            });
        }
    };

    const scrollRight = () => {
        if (collectionRef.current) {
            collectionRef.current.scrollBy({
                left: 400,
                behavior: "smooth"
            });
        }
    };

    if(itemsArray.length <= 0) return;

    return (
        <div className="p-3.75 bg-(--background2)! other flex flex-col rounded-2xl">
            <span className="collection-header px-0! mx-0! h-auto!">
                <h2 className="mb-2 text-lg font-semibold max-[500px]:text-sm">{t("featuredInPlaylists")}</h2>

                {hasOverflow && (
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

            <div ref={collectionRef} className="collection px-0! mx-0! overflow-x-auto! w-full!">
                {itemsArray ? itemsArray : <Loader ref={loaderRef} classes="elementLoader show" />}
            </div>
        </div>
    );
}

export default InPlaylist;
