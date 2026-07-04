import ItemSlider from "../itemSlider/itemSlider";
import HeroLarge from "../../../assets/Slider1.webp";
import HeroMedium from "../../../assets/Slider2.webp";
import HeroSmall from "../../../assets/Slider3.webp";
import Slider from "./slider/slider";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "~/i18n";
import { useSearchParams } from "react-router";
import MessagePopup from "../messagePopup/messagePopup";

function HomePage(){
    const { t } = useI18n();
    const heroTitleSentences = t("heroTitle")
        .split(". ")
        .map((sentence, index, sentences) => index < sentences.length - 1 && !sentence.endsWith(".") ? `${sentence}.` : sentence);
    const [searchParams] = useSearchParams();
    const registeredStatus = searchParams.get("registered");
    const hasHandledRegisteredPopup = useRef(false);
    const [popupState, setPopupState] = useState({
        open: false,
        message: "",
        autoCloseMs: 2000,
    });

    useEffect(() => {
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
    }, [registeredStatus, searchParams, t]);

    return <>
        <main className="homePage pb-10">
            <div className="hero">
                <span className="titles relative">
                    <p className="heroEyebrow">{t("heroEyebrow")}</p>
                    <h2 className="heroHeadline w-fit font-bold text-(--text1) text-5xl max-[1300px]:text-[2.2rem] max-[1160px]:text-[2rem] max-[800px]:text-[2rem] max-[500px]:text-2xl">
                        {heroTitleSentences.map((sentence, index) => (
                            <span
                                key={`heroTitleSentence${index}`}
                                className={index === heroTitleSentences.length - 1 ? "heroTitleSentence heroTitleSentenceLast" : "heroTitleSentence"}
                            >
                                {index === heroTitleSentences.length - 1 && sentence.includes("OptiFlowz") ? (
                                    <>
                                        {sentence.split("OptiFlowz")[0]}
                                        <span className="heroBrandGlow">OptiFlowz</span>
                                        {sentence.split("OptiFlowz")[1]}
                                    </>
                                ) : sentence}
                            </span>
                        ))}
                    </h2>
                </span>
                
                <Slider props={{
                    images: [HeroLarge, HeroMedium, HeroSmall]
                }} />
            </div>

            <ItemSlider props={{type: 5}} />
            <ItemSlider props={{type: 0}} />
            <ItemSlider props={{type: 2}} />
            <ItemSlider props={{type: 1}} />
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
