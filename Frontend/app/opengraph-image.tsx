import { ImageResponse } from "next/og";
import { themeColor } from "./theme/serverColors";

export const alt = "OptiFlowz Video Platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "76px 88px",
          color: themeColor("--text1"),
          background:
            `radial-gradient(circle at 82% 18%, ${themeColor("--accentBlue2")} 0, ${themeColor("--accentBlue")} 20%, transparent 47%), linear-gradient(135deg, ${themeColor("--background1")} 0%, ${themeColor("--background4")} 62%, ${themeColor("--accentBlue")} 100%)`,
          fontFamily: "Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24, marginBottom: 54 }}>
          <div
            style={{
              display: "flex",
              width: 86,
              height: 86,
              borderRadius: 43,
              border: `15px solid ${themeColor("--accentBlue2")}`,
              borderRightColor: themeColor("--analyticsChart6"),
              boxShadow: `0 0 42px ${themeColor("--privacyAccentShadowColor")}`,
            }}
          />
          <div style={{ display: "flex", fontSize: 46, fontWeight: 700 }}>OptiFlowz</div>
        </div>
        <div style={{ display: "flex", fontSize: 76, lineHeight: 1.05, fontWeight: 800, maxWidth: 900 }}>
          Video content, organized.
        </div>
        <div style={{ display: "flex", marginTop: 30, fontSize: 30, color: themeColor("--text3") }}>
          Professional videos, playlists, and learning resources.
        </div>
      </div>
    ),
    size,
  );
}
