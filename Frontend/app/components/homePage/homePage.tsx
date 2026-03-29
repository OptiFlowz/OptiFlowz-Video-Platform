import ItemSlider from "../itemSlider/itemSlider";
import HeroLarge from "../../../assets/slider1.webp";
import HeroMedium from "../../../assets/slider2.webp";
import HeroSmall from "../../../assets/hero-large.webp";
import Slider from "./slider/slider";
import { useRef } from "react";
import { useI18n } from "~/i18n";

function HomePage(){
    const { t } = useI18n();
    const paragraphRef = useRef<HTMLDivElement>(null);

    return <>
        <main className="homePage pb-10">
            <div className="hero">
                <span className="titles relative">
                    <h2 className="w-fit font-bold text-white text-5xl max-[1300px]:text-[2.2rem] max-[1160px]:text-[2rem] max-[800px]:text-[2rem] max-[500px]:text-2xl">OptiFlowz<br/>{t("heroTitle")}</h2>

                    <div ref={paragraphRef} className={`paragraphHolder`}>
                        <p className={`relative paragraph paragraph0 selected mt-5 mb-7.5 max-[800px]:mb-0 font-medium text-lg max-[1300px]:text-[1rem] max-[1160px]:text-[0.85rem] max-[500px]:mt-3 max-[450px]:text-[.85rem] text-(--text1)`}>
                            {t("heroParagraph1")}
                        </p>

                        <p className={`relative paragraph paragraph1 mt-5 mb-7.5 max-[800px]:mb-0 font-medium text-lg max-[1300px]:text-[1rem] max-[1160px]:text-[0.85rem] max-[500px]:mt-3 max-[450px]:text-[.85rem] text-(--text1)`}>
                            {t("heroParagraph2")}
                        </p>

                        <p className={`relative paragraph paragraph2 mt-5 mb-7.5 max-[800px]:mb-0 font-medium text-lg max-[1300px]:text-[1rem] max-[1160px]:text-[0.85rem] max-[500px]:mt-3 max-[450px]:text-[.85rem] text-(--text1)`}>
                            {t("heroParagraph3")}
                        </p>

                        <p className={`relative paragraph paragraph3 mt-5 mb-7.5 max-[800px]:mb-0 max-[650px]:mr-5 font-medium text-lg max-[1300px]:text-[1rem] max-[1160px]:text-[0.85rem] max-[500px]:mt-3 max-[450px]:text-[.85rem] text-(--text1)`}>
                            {t("heroParagraph1")}
                        </p>
                    </div>
                </span>
                
                <Slider props={{
                    images: [HeroLarge, HeroMedium, HeroSmall],
                    paragraphs: paragraphRef
                }} />
            </div>

            <ItemSlider props={{type: 5}} />
            <ItemSlider props={{type: 0}} />
            <ItemSlider props={{type: 2}} />
            <ItemSlider props={{type: 1}} />
        </main>
    </>;
}

export default HomePage;
