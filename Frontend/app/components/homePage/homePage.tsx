import ItemSlider from "../itemSlider/itemSlider";
import HomeBanner from "./HomeBanner";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "~/i18n";
import MessagePopup from "../messagePopup/messagePopup";

function HomePage(){
    const { t } = useI18n();
    const hasHandledRegisteredPopup = useRef(false);
    const [popupState, setPopupState] = useState({
        open: false,
        message: "",
        autoCloseMs: 2000,
    });

    useEffect(() => {
        const searchParams = new URLSearchParams(window.location.search);
        const registeredStatus = searchParams.get("registered");
        if (registeredStatus !== "success" || hasHandledRegisteredPopup.current) return;

        hasHandledRegisteredPopup.current = true;

        setPopupState({
            open: true,
            message: t("registeredSuccessfully"),
            autoCloseMs: 2000,
        });

        const nextParams = new URLSearchParams(searchParams);
        nextParams.delete("registered");
        const nextSearch = nextParams.toString();
        const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;

        window.history.replaceState(null, "", nextUrl);
    }, [t]);

    return <>
        <main className="homePage pb-10">
            <HomeBanner />

            <ItemSlider props={{type: 5}} />
            <ItemSlider props={{type: 2, limit: 6}} />
            <ItemSlider props={{type: 1}} showLatestPosts />
        </main>
        <MessagePopup
            open={popupState.open}
            message={popupState.message}
            autoCloseMs={popupState.autoCloseMs}
            onClose={() => setPopupState((prev) => ({ ...prev, open: false }))}
        />
    </>;
}

export default HomePage;
