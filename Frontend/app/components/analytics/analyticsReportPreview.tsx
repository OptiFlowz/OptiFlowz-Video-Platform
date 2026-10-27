import { createRoot } from "react-dom/client";
import { FAVICON } from "~/changeables";
import { PdfGenerationStatus, type PdfGenerationLabels } from "./PdfGenerationStatus";

const previewStyles = `
  * { box-sizing: border-box; }
  html, body { margin: 0; min-height: 100%; }
  body { background: var(--background1); color: var(--text1); font-family: var(--report-font); }
  body.pdf, body.pdf #report-root { height: 100vh; }
  iframe { display: block; width: 100%; height: 100%; border: 0; }
`;

type Labels = PdfGenerationLabels;

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
    root.render(<PdfGenerationStatus labels={labels} failed={failed} onClose={() => target.close()} />);
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
