import { memo } from "react";
import PlayCard from "./playCard";
import type { SimilarT } from "~/types";
import { useI18n } from "~/i18n";

const SkeletonPlayCard = () => (
    <div className="skeleton-playcard">
        <div className="skeleton-playcard-thumbnail"></div>
        <div className="skeleton-playcard-content">
            <div className="skeleton-playcard-title"></div>
            <div className="skeleton-playcard-text"></div>
            <div className="skeleton-playcard-text short"></div>
        </div>
    </div>
);

function Similar({props, isLoading}: {props?: SimilarT, isLoading?: boolean}){
    const { t } = useI18n();

    const skeletonArray = Array.from({ length: 8 }).map((_, index) => (
        <SkeletonPlayCard key={`skeleton-similar-${index}`} />
    ));

    const similarArray = props?.videos?.map((item, index) => (
        <PlayCard key={`similar${index}`} props={item} playedVideoId="" playlistId="" />
    ));

    return (
        <div className="similar">
            <h2 className="subTitle">{t("similarVideos")}</h2>

            <div className="holder">
                {isLoading ? skeletonArray : similarArray}
            </div>
        </div>
    );
}

export default memo(Similar);
