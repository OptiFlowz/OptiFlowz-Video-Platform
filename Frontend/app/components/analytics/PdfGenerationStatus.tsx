import { PLATFORM_NAME } from '~/changeables';
import { TranscriptSVG } from '~/constants';

// Scoped styles also work in the analytics preview's separate document.
const styles = `
  .pdf-generation-shell * { box-sizing: border-box; }
  .pdf-generation-shell { box-sizing: border-box; min-height: 100vh; min-height: 100dvh; display: grid; place-items: center; padding: 24px; background: var(--background1); color: var(--text1); }
  .pdf-generation-card { box-sizing: border-box; width: min(100%, 520px); padding: clamp(28px, 6vw, 56px); text-align: center;
    background: var(--background1); border: 1px solid var(--border1); border-radius: 28px; box-shadow: 0 24px 80px var(--background2); }
  .pdf-generation-brand { font-size: 14px; font-weight: 600; }
  .pdf-generation-visual { position: relative; display: grid; place-items: center; width: 104px; height: 104px; margin: 40px auto 28px;
    border-radius: 50%; background: var(--background2); color: var(--accentBlue2); }
  .pdf-generation-visual svg { width: 36px; height: 36px; }
  .pdf-generation-visual svg * { stroke: currentColor; }
  .pdf-generation-spinner { position: absolute; inset: -8px; border: 3px solid var(--background2);
    border-top-color: var(--accentBlue2); border-radius: 50%; animation: pdf-generation-spin 1s linear infinite; }
  .pdf-generation-label { color: var(--text2); opacity: .75; font-size: 14px; margin: 0 0 10px; overflow-wrap: anywhere; }
  .pdf-generation-card h1 { font-size: clamp(24px, 4vw, 30px); line-height: 1.35; margin: 0; font-weight: 650; overflow-wrap: anywhere; }
  .pdf-generation-card button { margin-top: 28px; border: 1px solid var(--border1); border-radius: 999px; padding: 12px 28px;
    background: var(--background2); color: var(--text1); font: inherit; cursor: pointer; }
  .pdf-generation-card button:hover { background: var(--background3); }
  .pdf-generation-card button:focus-visible { outline: 2px solid var(--accentBlue2); outline-offset: 4px; }
  @keyframes pdf-generation-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .pdf-generation-spinner { animation: none; } }
`;

export type PdfGenerationLabels = { generating: string; report: string; failed: string; close: string };

export function PdfGenerationStatus({ labels, failed = false, onClose }: {
  labels: PdfGenerationLabels;
  failed?: boolean;
  onClose?: () => void;
}) {
  return <div className="pdf-generation-shell">
    <style type="text/css">{styles}</style>
    <section className="pdf-generation-card" role={failed ? 'alert' : 'status'} aria-live="polite" aria-busy={!failed}>
      <div className="pdf-generation-brand">{PLATFORM_NAME}</div>
      <div className="pdf-generation-visual" aria-hidden="true">{!failed && <span className="pdf-generation-spinner" />}{TranscriptSVG}</div>
      <p className="pdf-generation-label">{labels.report}</p>
      <h1>{failed ? labels.failed : labels.generating}</h1>
      {failed && onClose && <button type="button" onClick={onClose}>{labels.close}</button>}
    </section>
  </div>;
}
