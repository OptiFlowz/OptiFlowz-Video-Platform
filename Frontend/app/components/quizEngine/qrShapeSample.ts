import type { DotType, CornerSquareType, CornerDotType } from 'qr-code-styling';

// Render the option samples with the same library as the certificate itself.
// Cropping real modules preserves connected dots and the library's corner fallbacks.
const samples = new Map<string, Promise<string>>();

export function qrShapeSample(part: string, shape: string): Promise<string> {
  const key = `${part}:${shape}`;
  if (!samples.has(key)) {
    const result = (async () => {
      const { default: QRCodeStyling } = await import('qr-code-styling');
      const qr = new QRCodeStyling({
        width: 210, height: 210, margin: 0, type: 'svg', data: 'QR',
        qrOptions: { typeNumber: 1, errorCorrectionLevel: 'Q', mode: 'Byte' },
        backgroundOptions: { color: 'transparent' },
        dotsOptions: { type: part === 'dots' ? shape as DotType : 'square', color: 'currentColor' },
        cornersSquareOptions: { type: part === 'corners' ? shape as CornerSquareType : 'square', color: 'currentColor' },
        cornersDotOptions: { type: part === 'cornerdots' ? shape as CornerDotType : 'square', color: part === 'corners' ? 'transparent' : 'currentColor' },
      });
      const blob = await qr.getRawData('svg');
      if (!(blob instanceof Blob)) throw new Error('QR sample could not be generated.');
      const svg = new DOMParser().parseFromString(await blob.text(), 'image/svg+xml').documentElement;
      // Version 1 is 21 modules: 10 pixels per module, with no quiet zone.
      svg.setAttribute('viewBox', part === 'dots' ? '80 80 70 70' : part === 'corners' ? '0 0 70 70' : '20 20 30 30');
      svg.setAttribute('width', '40'); svg.setAttribute('height', '40');
      return `data:image/svg+xml,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
    })().catch(error => { samples.delete(key); throw error; });
    samples.set(key, result);
  }
  return samples.get(key)!;
}
