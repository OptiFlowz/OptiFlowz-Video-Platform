import { useI18n } from "~/i18n";
import { MenuSVG } from "~/constants";
import heroOne from "../../../../assets/Slider1.webp";
import heroTwo from "../../../../assets/Slider2.webp";
import heroThree from "../../../../assets/Slider3.webp";
import PlatformSettingsHeader from "./platformSettingsHeader";

const homepageSections = ["settingsContinueSection", "settingsTrendingSection", "settingsRecommendedSection"];
const heroImages = [heroOne, heroTwo, heroThree];

export default function HomepageConfiguration() {
  const { t } = useI18n();
  return (
    <>
      <PlatformSettingsHeader activePage="homepage" />
      <div className="platformSettingsGrid homepageGrid">
        <section className="platformSettingsCard">
          <h2>{t("settingsHomepageSections")}</h2>
          {homepageSections.map((section) => (
            <label className="homepageSectionToggle" key={section}>
              <span>{t(section)}</span>
              <span className="homepageToggleControl">
                <input type="checkbox" />
                <span>{t("settingsEnable")}</span>
              </span>
            </label>
          ))}
        </section>

        <section className="platformSettingsCard heroSliderCard">
          <h2>{t("settingsHeroImages")}</h2>
          <div className="heroSliderList">
            {heroImages.map((image, index) => (
              <article className="heroSliderItem" key={image}>
                <span className="heroDragHandle" aria-label={t("settingsReorderHero", { number: index + 1 })}>{MenuSVG}</span>
                <img src={image} alt={t("settingsHeroSlide", { number: index + 1 })} />
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
