import { EditSVG, LogOutSVG, SettingsSVG } from "~/constants";
import AccountInfo from "./accountInfo";
import { useNavigate } from "react-router";
import ItemSlider from "../itemSlider/itemSlider";
import { useState } from "react";
import EditAccountPopup from "./editAccountPopup";
import SettingsPopup from "./settingsPopup";
import { useI18n } from "~/i18n";
import backgroundImage from "../../../assets/LoginBackground.webp";

const accountSliderTypes = [3, 4, 6] as const;
type SliderStatus = "loading" | "empty" | "has-data";

function AccountPage(){
    const { t } = useI18n();
    const navigate = useNavigate();
    const [isEditPopupOpen, setIsEditPopupOpen] = useState(false);
    const [isSettingsPopupOpen, setIsSettingsPopupOpen] = useState(false);
    const [sliderStates, setSliderStates] = useState<Record<number, SliderStatus>>({
        3: "loading",
        4: "loading",
        6: "loading",
    });

    const setSliderState = (type: number, state: SliderStatus) => {
        setSliderStates((prev) => {
            if (prev[type] === state) return prev;
            return { ...prev, [type]: state };
        });
    };

    const allAccountSlidersEmpty = accountSliderTypes.every((type) => sliderStates[type] === "empty");

    const logoutHandle = () => {
        localStorage.removeItem("user");
        sessionStorage.removeItem("user");
        navigate("/login");
    }

    return (
        <main className="account py-10">
            <div className="info flex gap-4 max-[350px]:gap-3 items-center">
                <div className="background">
                    <img className="w-full h-full" src={backgroundImage} alt="Background" />
                </div>

                <AccountInfo />
                <EditAccountPopup open={isEditPopupOpen} onClose={() => setIsEditPopupOpen(false)}/>
                <SettingsPopup open={isSettingsPopupOpen} onClose={() => setIsSettingsPopupOpen(false)} />

                <div className="accountActions z-2">
                    <span>
                        <button className="edit button" onClick={() => setIsEditPopupOpen(true)}>
                            {EditSVG}
                            <p>{t("accountEdit")}</p>
                        </button>
                        <button className="settings button" onClick={() => setIsSettingsPopupOpen(true)}>
                            {SettingsSVG}
                            <p>{t("settings")}</p>
                        </button>
                    </span>
                    <button className="logOut button" onClick={logoutHandle}>
                        {LogOutSVG}
                        <p className="text-white">{t("accountLogout")}</p>
                    </button>
                </div>
            </div>

            <ItemSlider props={{type: 3, onDataStateChange: (state) => setSliderState(3, state)}} />
            <ItemSlider props={{type: 4, onDataStateChange: (state) => setSliderState(4, state)}} />
            <ItemSlider props={{type: 6, onDataStateChange: (state) => setSliderState(6, state)}} />

            {allAccountSlidersEmpty && (
                <p className="watchToRecommend mt-5">{t("likeWatchSaveVideos")}</p>
            )}
        </main>
    );
}

export default AccountPage;
