import type { CertificateDetail } from './accountQueries';
import { certificatePaper } from '../quizEngine/certificatePreview';
import { issuedCertificateDocument } from './issuedCertificateDocument';

/** Rasterize the issued document at 192 dpi, within mobile canvas memory limits. */
export async function generateCertificatePdf(certificate: CertificateDetail, signal: AbortSignal): Promise<Blob> {
  signal.throwIfAborted();
  const frame = document.createElement('iframe');
  // Parent access is needed for capture; certificate scripts remain forbidden.
  frame.setAttribute('sandbox', 'allow-same-origin');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  frame.referrerPolicy = 'no-referrer';
  const { width, height } = certificatePaper(certificate.template_snapshot);
  Object.assign(frame.style, { position: 'fixed', left: '-10000px', top: '0', width: `${width}px`, height: `${height}px`, border: '0', pointerEvents: 'none' });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  let stopped = false;
  const check = () => {
    signal.throwIfAborted();
    if (stopped) throw new Error('Certificate capture timed out.');
  };
  const interrupted = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('Certificate capture timed out.')), 15_000);
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  const render = async () => {
    const [html, { toCanvas, getFontEmbedCSS }, { jsPDF }] = await Promise.all([
      issuedCertificateDocument(certificate), import('html-to-image'), import('jspdf'),
    ]);
    check();
    await new Promise<void>((resolve, reject) => {
      frame.onload = () => resolve();
      frame.onerror = () => reject(new Error('Certificate document could not load.'));
      frame.srcdoc = html;
      document.body.appendChild(frame);
    });
    check();
    const doc = frame.contentDocument;
    const content = doc?.querySelector<HTMLElement>('.certificate');
    if (!doc || !content) throw new Error('Certificate document is unavailable.');
    await doc.fonts.ready;
    await Promise.all(Array.from(doc.images, image => image.decode()));
    check();
    const hasFontResources = doc.querySelector('link[rel=stylesheet]') || /@(?:import|font-face)\b/i.test(certificate.template_snapshot.css_template);
    if (hasFontResources && doc.fonts.size === 0) throw new Error('Certificate font styles could not load.');
    if (Array.from(doc.fonts).some(font => font.status === 'error')) throw new Error('A certificate font could not load.');

    // html-to-image's font discovery does not traverse children from another Window.
    // Supply all actually used families, including SVG text, from the capture document.
    const fontProbe = doc.createElement('div');
    const families = new Set(Array.from(content.querySelectorAll('*'), element => getComputedStyle(element).fontFamily));
    families.add(getComputedStyle(content).fontFamily);
    fontProbe.style.fontFamily = [...families].join(',');
    const fontEmbedCSS = await getFontEmbedCSS(fontProbe, { fetchRequestInit: { signal } });
    if (Array.from(doc.fonts).some(font => font.status === 'loaded') && !fontEmbedCSS) throw new Error('Certificate fonts could not be embedded.');
    if (/url\(\s*["']?\s*["']?\s*\)/i.test(fontEmbedCSS)) throw new Error('A certificate font could not be embedded.');
    if (/url\(\s*["']?(?:https?:|data:[^,]*,?["']?\s*\))/i.test(fontEmbedCSS)) throw new Error('A certificate font could not be embedded.');
    check();
    const canvas = await toCanvas(content, { width, height, pixelRatio: 2, fontEmbedCSS, fetchRequestInit: { signal } });
    try {
      check();
      if (!canvas.width || !canvas.height) throw new Error('Certificate capture is empty.');
      const pdf = new jsPDF({ orientation: certificate.template_snapshot.orientation, unit: 'mm', format: certificate.template_snapshot.page_format.toLowerCase(), compress: true });
      pdf.setProperties({ title: `${certificate.data_snapshot.quiz.title} - ${certificate.certificate_number}` });
      pdf.addImage(canvas, 'PNG', 0, 0, pdf.internal.pageSize.getWidth(), pdf.internal.pageSize.getHeight(), undefined, 'FAST');
      check();
      return pdf.output('blob');
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  };
  try {
    return await Promise.race([render(), interrupted]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    if (abort) signal.removeEventListener('abort', abort);
    frame.onload = null;
    frame.onerror = null;
    frame.remove();
  }
}
