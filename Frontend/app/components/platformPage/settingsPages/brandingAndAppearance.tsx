import { useRef, useState } from "react";
import { BRAND_NAME, LOGO } from "~/changeables";
import { UploadSVG } from "~/constants";
import { DEFAULT_THEME_CSS_VARIABLES } from "~/theme";
import PlatformSettingsHeader from "./platformSettingsHeader";

const initialDescription =
  "Describe your platform, its purpose, and the content your audience can expect to find here.";

export default function BrandingAndAppearance() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");

  return (
    <>
      <PlatformSettingsHeader activePage="branding" />

      <section className="platformGuideUpload">
        <p>If you don't want to set these up yourself you can upload your brand guide, and our AI will do it for you</p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          onChange={(event) => setFileName(event.target.files?.[0]?.name ?? "")}
        />
        <button type="button" onClick={() => fileInputRef.current?.click()}>
          {UploadSVG}<span>{fileName || "Upload document"}</span>
        </button>
      </section>

      <div className="platformSettingsGrid brandingGrid">
        <section className="platformSettingsCard">
          <h2>Branding</h2>
          <label className="platformField">
            <span>Platform Name</span>
            <input type="text" defaultValue={BRAND_NAME} />
          </label>
          <label className="platformField">
            <span>Platform Description</span>
            <textarea rows={4} defaultValue={initialDescription} />
          </label>
          <div className="platformField">
            <span>Platform Logo</span>
            <div className="platformLogoPreview">
              <div><img src={LOGO} alt="" /></div>
              <strong>{BRAND_NAME} <small>Video platform</small></strong>
            </div>
          </div>
        </section>

        <section className="platformSettingsCard appearanceCard">
          <h2>Appearance</h2>
          <ColorSetting
            label="Accent Colors"
            colors={[
              DEFAULT_THEME_CSS_VARIABLES["--palette-ec8b55"],
              DEFAULT_THEME_CSS_VARIABLES["--palette-003e8e"],
            ]}
          />
          <ColorSetting
            label="Background Color"
            colors={[DEFAULT_THEME_CSS_VARIABLES["--palette-ffffff"]]}
          />
          <ColorSetting
            label="Text Color"
            colors={[DEFAULT_THEME_CSS_VARIABLES["--palette-000000"]]}
          />
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
