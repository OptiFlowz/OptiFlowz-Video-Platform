import { createRoot } from "react-dom/client";
import { FAVICON, PLATFORM_NAME } from "~/changeables";
import { TranscriptSVG } from "~/constants";

const previewStyles = `
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { background: var(--background1); color: var(--text1); font-family: var(--report-font); }
  .report-shell { min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px; }
  .report-card { width: min(100%, 520px); padding: clamp(28px, 6vw, 56px); text-align: center;
    background: var(--background1); border: 1px solid var(--border1); border-radius: 28px;
    box-shadow: 0 24px 80px var(--background2); }
  .report-brand { display: flex; align-items: center; justify-content: center; gap: 12px; font-size: 14px; font-weight: 600; }
  .report-visual { position: relative; display: grid; place-items: center; width: 104px; height: 104px; margin: 40px auto 28px;
    border-radius: 50%; background: var(--background2); color: var(--report-accent); }
  .report-visual svg { width: 36px; height: 36px; }
  .report-visual svg * { stroke: currentColor; }
  .report-spinner { position: absolute; inset: -8px; border: 3px solid var(--background2);
    border-top-color: var(--report-accent); border-radius: 50%; animation: report-spin 1s linear infinite; }
  .report-label { color: var(--text2); opacity: .75; font-size: 14px; margin: 0 0 10px; }
  h1 { font-size: clamp(24px, 4vw, 30px); line-height: 1.35; margin: 0; font-weight: 650; overflow-wrap: anywhere; }
  button { margin-top: 28px; border: 1px solid var(--border1); border-radius: 999px; padding: 12px 28px;
    background: var(--background2); color: var(--text1); font: inherit; cursor: pointer; }
  button:hover { background: var(--background3); }
  button:focus-visible { outline: 2px solid var(--report-accent); outline-offset: 4px; }
  body.pdf, body.pdf #report-root { height: 100vh; }
  iframe { display: block; width: 100%; height: 100%; border: 0; }
  @keyframes report-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .report-spinner { animation: none; } }
`;

type Labels = { generating: string; report: string; failed: string; close: string };

/** The pending tab is frontend UI; the backend only supplies the final PDF. */
export function createAnalyticsReportPreview(target: Window, labels: Labels) {
  const doc = target.document;
  const theme = getComputedStyle(document.documentElement);
  // about:blank has no application stylesheet, so explicitly carry over the theme.
  for (let i = 0; i < theme.length; i++) {
    const property = theme.item(i);
    if (property.startsWith("--")) doc.documentElement.style.setProperty(property, theme.getPropertyValue(property));
  }
  doc.documentElement.style.setProperty("--report-font", getComputedStyle(document.body).fontFamily);
  doc.documentElement.style.setProperty("--report-accent", theme.getPropertyValue("--accentBlue2"));
  doc.documentElement.lang = document.documentElement.lang || "en";
  document.fonts?.forEach(font => doc.fonts.add(font));
  const style = doc.createElement("style");
  style.textContent = previewStyles;
  const viewport = doc.createElement("meta");
  viewport.name = "viewport";
  viewport.content = "width=device-width, initial-scale=1";
  const favicon = doc.createElement("link");
  favicon.rel = "icon";
  favicon.href = new URL(FAVICON, window.location.origin).href;
  doc.head.replaceChildren(viewport, favicon, style);
  const mount = doc.createElement("div");
  mount.id = "report-root";
  doc.body.replaceChildren(mount);
  const root = createRoot(mount);
  let mounted = true;
  const unmount = () => { if (mounted) { root.unmount(); mounted = false; } };
  target.addEventListener("pagehide", unmount, { once: true });

  function render(failed: boolean) {
    if (target.closed || !mounted) return;
    doc.title = failed ? labels.failed : labels.generating;
    root.render(<main className="report-shell"><section className="report-card" role={failed ? "alert" : "status"} aria-live="polite" aria-busy={!failed}>
      <div className="report-brand">{PLATFORM_NAME}</div>
      <div className="report-visual" aria-hidden="true">{!failed && <span className="report-spinner" />}{TranscriptSVG}</div>
      <p className="report-label">{labels.report}</p>
      <h1>{failed ? labels.failed : labels.generating}</h1>
      {failed && <button type="button" onClick={() => target.close()}>{labels.close}</button>}
    </section></main>);
  }
  render(false);
  return {
    showError: () => render(true),
    showPdf(url: string, filename: string) {
      if (target.closed) { URL.revokeObjectURL(url); return; }
      unmount();
      doc.title = filename;
      doc.body.className = "pdf";
      const frame = doc.createElement("iframe");
      frame.src = url;
      frame.title = filename;
      mount.replaceChildren(frame);
      target.addEventListener("pagehide", () => URL.revokeObjectURL(url), { once: true });
    },
  };
}
