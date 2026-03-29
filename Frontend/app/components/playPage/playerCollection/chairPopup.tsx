import type { VideoT } from "~/types";
import { Link } from "react-router";
import { CloseSVG } from "~/constants";
import { useI18n } from "~/i18n";

function ChairPopup({props, open, type, onClose}: {props: VideoT, open: boolean, type: number, onClose: () => void}){
    const { t } = useI18n();

    const personArray = props?.people?.filter((person) => person?.type == type)?.map((item, index) => (
        <Link to={`/search?person=${item.id}&name=${item.name}`} key={`person${index}`} className="chairItem">
            <img src={item?.image_url} alt="Profile" />
            <span>
                <h3>{item?.name}</h3>
                <p className="weakText text-sm">{t("appearsOnVideos", { count: item?.total_video_count ?? 0 })}</p>
            </span>
        </Link>
    ))

    return (
        <div className={`popup ${open ? "active" : ""}`}>
            <div className="popup-content">
                <h2>{type == 0 ? t("chairsTitle") : t("speakersTitle")} <button onClick={onClose}>{CloseSVG}</button></h2>
                {personArray}
            </div>
            <button className="closePopup" onClick={onClose}></button>
        </div>
    );
}

export default ChairPopup;
