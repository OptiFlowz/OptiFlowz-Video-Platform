import { chromium } from 'playwright';
import { HttpError } from '../../../../common/httpError.js';

export const PDF_LIMITS = Object.freeze({
  concurrent: 1,
  timeoutMs: 20_000,
  launchTimeoutMs: 10_000,
  maxDocumentBytes: 512 * 1024,
  maxPdfBytes: 5 * 1024 * 1024,
});
let activeRenders = 0;

function browserEnvironment() {
  // Chromium must not inherit database credentials, storage keys, or the API's other secrets.
  const allowed = /^(PATH|SYSTEMROOT|WINDIR|TEMP|TMP|TMPDIR|HOME|USERPROFILE|LOCALAPPDATA|LANG|LC_ALL|DISPLAY|XDG_RUNTIME_DIR|FONTCONFIG_PATH)$/i;
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.test(key)));
}

export async function renderCertificatePdf(document, { signal } = {}) {
  if (Buffer.byteLength(document.html) > PDF_LIMITS.maxDocumentBytes) {
    throw new HttpError(422, { message: 'Certificate preview exceeds the document size limit', field: 'html_template' });
  }
  if (signal?.aborted) throw new HttpError(499, { message: 'Preview request cancelled' });
  if (activeRenders >= PDF_LIMITS.concurrent) throw new HttpError(503, { message: 'Certificate preview renderer is busy; retry shortly' });
  activeRenders++;
  let server;
  let launchPromise;
  let stopped = false;
  let timer;
  let abort;
  const interrupted = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new HttpError(504, { message: 'Certificate preview timed out' })), PDF_LIMITS.timeoutMs);
    abort = () => reject(new HttpError(499, { message: 'Preview request cancelled' }));
    signal?.addEventListener('abort', abort, { once: true });
  });
  const render = async () => {
    launchPromise = chromium.launchServer({
      host: '127.0.0.1',
      headless: true,
      chromiumSandbox: true,
      executablePath: process.env.CERTIFICATE_CHROMIUM_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      timeout: PDF_LIMITS.launchTimeoutMs,
      env: browserEnvironment(),
      args: ['--disable-dev-shm-usage', '--disable-background-networking', '--disable-extensions',
        '--renderer-process-limit=1', '--js-flags=--max-old-space-size=128'],
    });
    server = await launchPromise;
    // A launch completing after cancellation must not leave an orphaned Chromium process.
    if (stopped) throw new HttpError(499, { message: 'Preview request cancelled' });
    const browser = await chromium.connect(server.wsEndpoint(), { timeout: PDF_LIMITS.launchTimeoutMs });
    const context = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: 'block',
      acceptDownloads: false,
      offline: true,
      viewport: { width: 1123, height: 1123 },
      deviceScaleFactor: 1,
    });
    // Deny all requests, including loopback, private networks, metadata endpoints and redirects.
    await context.route('**/*', route => route.abort('blockedbyclient'));
    await context.routeWebSocket('**/*', socket => socket.close());
    context.setDefaultTimeout(PDF_LIMITS.timeoutMs);
    context.setDefaultNavigationTimeout(PDF_LIMITS.timeoutMs);
    const page = await context.newPage();
    await page.emulateMedia({ media: 'print' });
    await page.setContent(document.html, { waitUntil: 'load', timeout: PDF_LIMITS.timeoutMs });
    const pdf = await page.pdf({
      format: document.format,
      landscape: document.landscape,
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 },
      preferCSSPageSize: false,
      pageRanges: '1',
      timeout: PDF_LIMITS.timeoutMs,
    });
    if (pdf.length > PDF_LIMITS.maxPdfBytes) throw new HttpError(422, { message: 'Certificate preview exceeds the PDF size limit', field: 'html_template' });
    return pdf;
  };
  try {
    return await Promise.race([render(), interrupted]);
  } finally {
    stopped = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    try {
      // Keep the slot reserved until an in-flight launch is reaped; cancelled launches
      // must not let repeated disconnects bypass the concurrency limit.
      if (!server && launchPromise) server = await launchPromise.catch(() => null);
      // BrowserServer.kill kills the browser process tree, even if PDF generation has hung.
      if (server) await server.kill();
    } finally { activeRenders--; }
  }
}
