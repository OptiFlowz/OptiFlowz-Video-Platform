import { parseCertificateQrOptions, QR_PLACEHOLDER_SOURCE } from './certificateQrOptions.js';

export const classicQrKey = 'certificate.qr_code_data_uri.size_512.dots_rounded.corners_extra-rounded.cornerdots_dot.gradient_linear_003e8e_102443_45.background_f8fbff.ecc_Q';
export const minimalQrKey = 'certificate.qr_code_data_uri.size_512.color_14243b.dots_rounded.corners_square.cornerdots_square.background_ffffff.ecc_Q';
const sampleUrl = 'https://example.com/certificates/verify/preview';
const cache = new Map<string, Promise<string>>();

async function renderQr(key: string): Promise<string> {
  const { options, marginModules } = parseCertificateQrOptions(key);
  const [{ default: QRCodeStyling }, { default: qrcode }] = await Promise.all([
    import('qr-code-styling'), import('qrcode-generator'),
  ]);
  const matrix = qrcode(0, options.qrOptions!.errorCorrectionLevel!);
  matrix.addData(sampleUrl, 'Byte'); matrix.make();
  const pixels = Math.floor(options.width! / (matrix.getModuleCount() + 2 * marginModules));
  if (pixels < 3) throw new Error('QR code: increase size for this margin.');
  const qr = new QRCodeStyling({ ...options, margin: marginModules * pixels, data: sampleUrl, type: 'svg' });
  const blob = await qr.getRawData('svg');
  if (!(blob instanceof Blob)) throw new Error('QR code preview could not be generated.');
  return `data:image/svg+xml,${encodeURIComponent(await blob.text())}`;
}

export async function certificateQrImages(html: string): Promise<Record<string, string>> {
  const fragment = document.createElement('template'); fragment.innerHTML = html;
  const pattern = new RegExp(`^(?:${QR_PLACEHOLDER_SOURCE})$`, 'i');
  const sources = [...new Set(Array.from(fragment.content.querySelectorAll('img'))
    .map(image => image.getAttribute('src') ?? '').filter(source => pattern.test(source)))];
  const entries = sources.map(source => {
    const key = source.slice(2, -2).trim();
    return { source, key, cacheKey: JSON.stringify(parseCertificateQrOptions(key)) };
  });
  if (new Set(entries.map(entry => entry.cacheKey)).size > 8) throw new Error('QR code: at most eight styles are allowed per preview.');
  const images = await Promise.all(entries.map(async ({ source, key, cacheKey }) => {
    if (!cache.has(cacheKey)) {
      if (cache.size >= 32) cache.delete(cache.keys().next().value!);
      const promise = renderQr(key).catch(error => { cache.delete(cacheKey); throw error; });
      cache.set(cacheKey, promise);
    }
    return [source, await cache.get(cacheKey)!] as const;
  }));
  return Object.fromEntries(images);
}
