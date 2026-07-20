import { MenuSVG } from "~/constants";
import heroOne from "../../../../assets/Slider1.webp";
import heroTwo from "../../../../assets/Slider2.webp";
import heroThree from "../../../../assets/Slider3.webp";
import PlatformSettingsHeader from "./platformSettingsHeader";

const homepageSections = ["Continue watching section", "Trending section", "Recommended section"];
const heroImages = [heroOne, heroTwo, heroThree];

export default function HomepageConfiguration() {
  return (
    <>
      <PlatformSettingsHeader activePage="homepage" />
      <div className="platformSettingsGrid homepageGrid">
        <section className="platformSettingsCard">
          <h2>Homepage Sections</h2>
          {homepageSections.map((section) => (
            <label className="homepageSectionToggle" key={section}>
              <span>{section}</span>
              <span className="homepageToggleControl">
                <input type="checkbox" />
                <span>Turn on</span>
              </span>
            </label>
          ))}
        </section>

        <section className="platformSettingsCard heroSliderCard">
          <h2>Hero Slider Images</h2>
          <div className="heroSliderList">
            {heroImages.map((image, index) => (
              <article className="heroSliderItem" key={image}>
                <span className="heroDragHandle" aria-label={`Reorder hero image ${index + 1}`}>{MenuSVG}</span>
                <img src={image} alt={`Hero slide ${index + 1}`} />
              </article>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
