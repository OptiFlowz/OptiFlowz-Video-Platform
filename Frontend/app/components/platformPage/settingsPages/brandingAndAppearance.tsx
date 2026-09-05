import { useI18n } from "~/i18n";
import { useRef, useState } from "react";
import { BRAND_NAME, LOGO } from "~/changeables";
import { UploadSVG } from "~/constants";
import PlatformSettingsHeader from "./platformSettingsHeader";


export default function BrandingAndAppearance() {
  const { t } = useI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");

  return (
    <>
      <PlatformSettingsHeader activePage="branding" />

      <section className="platformGuideUpload">
        <p>{t("settingsBrandGuideHelp")}</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
        />
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          {UploadSVG}<span>{fileName || t("settingsUploadDocument")}</span>
        </button>
      </section>

      <div className="platformSettingsGrid brandingGrid">
        <section className="platformSettingsCard">
          <h2>{t("settingsBranding")}</h2>
          <label className="platformField">
            <span>{t("settingsPlatformName")}</span>
            <input type="text" defaultValue={BRAND_NAME} />
          </label>
          <label className="platformField">
            <span>{t("settingsPlatformDescription")}</span>
            <textarea rows={4} placeholder={t("settingsDescriptionPlaceholder")} />
          </label>
          <div className="platformField">
            <span>{t("settingsPlatformLogo")}</span>
            <div className="platformLogoPreview">
              <div><img src={LOGO} alt="" /></div>
              <strong>{BRAND_NAME} <small>{t("appName")}</small></strong>
            </div>
          </div>
        </section>

        <section className="platformSettingsCard appearanceCard">
          <h2>{t("settingsAppearance")}</h2>
          <ColorSetting label={t("settingsAccentColors")} colors={["#EC8B55", "#003E8E"]} />
          <ColorSetting label={t("settingsBackgroundColor")} colors={["#FFFFFF"]} />
          <ColorSetting label={t("settingsTextColor")} colors={["#000000"]} />
        </section>
      </div>
    </>
  );
}

function ColorSetting({ label, colors }: { label: string; colors: string[] }) {
  return (
    <div className="platformColorSetting">
      <span>{label}</span>
      <div>
        {colors.map((color) => (
          <label key={color} className="platformColorChip">
            <input type="color" defaultValue={color} aria-label={`${label} ${color}`} />
            <span>{color}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
