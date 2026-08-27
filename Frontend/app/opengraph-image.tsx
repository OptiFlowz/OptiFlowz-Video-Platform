import { ImageResponse } from "next/og";

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
          color: "white",
          background:
            "radial-gradient(circle at 82% 18%, #126de0 0, #0b3269 20%, transparent 47%), linear-gradient(135deg, #03070b 0%, #0b1422 62%, #071b35 100%)",
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
              border: "15px solid #268cff",
              borderRightColor: "#b9dcff",
              boxShadow: "0 0 42px rgba(38, 140, 255, .55)",
            }}
          />
          <div style={{ display: "flex", fontSize: 46, fontWeight: 700 }}>OptiFlowz</div>
        </div>
        <div style={{ display: "flex", fontSize: 76, lineHeight: 1.05, fontWeight: 800, maxWidth: 900 }}>
          Video content, organized.
        </div>
        <div style={{ display: "flex", marginTop: 30, fontSize: 30, color: "#c8d5e8" }}>
          Professional videos, playlists, and learning resources.
        </div>
      </div>
    ),
    size,
  );
}
