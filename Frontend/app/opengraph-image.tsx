import { ImageResponse } from "next/og";
import { DEFAULT_THEME } from "./theme";

export const alt = "OptiFlowz Video Platform";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  const colors = DEFAULT_THEME.openGraph;

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
          color: colors.text,
          background: colors.background,
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
              border: `15px solid ${colors.markBorder}`,
              borderRightColor: colors.markBorderAccent,
              boxShadow: colors.markShadow,
            }}
          />
          <div style={{ display: "flex", fontSize: 46, fontWeight: 700 }}>OptiFlowz</div>
        </div>
        <div style={{ display: "flex", fontSize: 76, lineHeight: 1.05, fontWeight: 800, maxWidth: 900 }}>
          Video content, organized.
        </div>
        <div style={{ display: "flex", marginTop: 30, fontSize: 30, color: colors.subtitle }}>
          Professional videos, playlists, and learning resources.
        </div>
      </div>
    ),
    size,
  );
}
