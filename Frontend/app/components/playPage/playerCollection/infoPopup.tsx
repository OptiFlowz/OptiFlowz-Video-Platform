import { CloseSVG } from "~/constants";
import { useI18n } from "~/i18n";
import PopupPortal from "~/components/popupPortal/popupPortal";

function InfoPopup({text, open, onClose}: {text: String, open: boolean, onClose: () => void}){
    const { t } = useI18n();

    return <PopupPortal>
        <div className={`popup ${open ? "active" : ""}`}>
            <div className="popup-content">
                <h2>{t("copyrightNotice")} <button onClick={onClose}>{CloseSVG}</button></h2>
                <p>{text}</p>
            </div>
            <button className="closePopup" onClick={onClose}></button>
        </div>
    </PopupPortal>;
}

export default InfoPopup;
