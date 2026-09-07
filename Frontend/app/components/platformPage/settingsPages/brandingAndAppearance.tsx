import { useI18n } from "~/i18n";
import { useEffect, useRef, useState } from "react";
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
          <ColorSetting label={t("settingsAccentColors")} colors={["--accentBlue2", "--accentBlue"]} />
          <ColorSetting label={t("settingsBackgroundColor")} colors={["--background1"]} />
          <ColorSetting label={t("settingsTextColor")} colors={["--text1"]} />
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
          <ThemeColorInput key={color} label={label} variable={color} />
        ))}
      </div>
    </div>
  );
}

function ThemeColorInput({ label, variable }: { label: string; variable: string }) {
  const swatchRef = useRef<HTMLSpanElement>(null);
  const [color, setColor] = useState<string>();

  useEffect(() => {
    if (!swatchRef.current) return;
    // Native color inputs require hex, not var(...). Resolve the actual theme
    // through the browser, including aliases, before showing the input.
    const channels = getComputedStyle(swatchRef.current).color.match(/[\d.]+/g);
    if (!channels || channels.length < 3) return;
    setColor(`#${channels.slice(0, 3).map((channel) => Math.round(Number(channel)).toString(16).padStart(2, "0")).join("")}`);
  }, [variable]);

  return (
    <label className="platformColorChip">
      <span ref={swatchRef} hidden style={{ color: `var(${variable})` }} aria-hidden="true" />
      {color && <input type="color" value={color} onChange={(event) => setColor(event.target.value)} aria-label={`${label} ${color}`} />}
      <span>{color}</span>
    </label>
  );
}
