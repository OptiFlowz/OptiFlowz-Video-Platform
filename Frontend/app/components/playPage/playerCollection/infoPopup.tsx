import { CloseSVG } from "~/constants";
import { useI18n } from "~/i18n";

function InfoPopup({text, open, onClose}: {text: String, open: boolean, onClose: () => void}){
    const { t } = useI18n();

    return (
        <div className={`popup ${open ? "active" : ""}`}>
            <div className="popup-content">
                <h2>{t("copyrightNotice")} <button onClick={onClose}>{CloseSVG}</button></h2>
                <p>{text}</p>
            </div>
            <button className="closePopup" onClick={onClose}></button>
        </div>
    );
}

export default InfoPopup;
