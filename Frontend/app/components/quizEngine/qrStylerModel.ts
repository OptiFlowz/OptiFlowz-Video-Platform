import { QR_PLACEHOLDER_SOURCE, QR_CODE_KEY } from './certificateQrOptions.js';

export function readQrSnippet(code: string) {
  const fragment = document.createElement('template');
  fragment.innerHTML = code.trim();
  const image = fragment.content.firstElementChild;
  if (fragment.content.children.length !== 1 || image?.tagName !== 'IMG'
    || Array.from(fragment.content.childNodes).some(node => node.nodeType === 3 && node.textContent?.trim())) {
    throw new Error('Use one <img> element with a certificate QR placeholder in src.');
  }
  const allowed = new Set(['src', 'alt', 'class', 'id', 'width', 'height', 'style']);
  if (Array.from(image.attributes).some(attribute => !allowed.has(attribute.name))) throw new Error('Unsupported image attribute.');
  const source = image.getAttribute('src') ?? '';
  if (!new RegExp(`^(?:${QR_PLACEHOLDER_SOURCE})$`, 'i').test(source)) throw new Error('Use {{certificate.qr_code_data_uri}} in img src.');
  const key = source.slice(2, -2).trim();
  const parameters = Object.fromEntries(key.slice(QR_CODE_KEY.length).split('.').slice(1).map(part => {
    const separator = part.indexOf('_'); return [part.slice(0, separator), part.slice(separator + 1)];
  }));
  return { image, parameters };
}

export function updateQrSnippet(code: string, patch: Record<string, string | null>) {
  const { image, parameters } = readQrSnippet(code);
  for (const [name, value] of Object.entries(patch)) {
    if (value === null) delete parameters[name]; else parameters[name] = value;
  }
  const key = [QR_CODE_KEY, ...Object.entries(parameters).map(([name, value]) => `${name}_${value}`)].join('.');
  image.setAttribute('src', `{{${key}}}`);
  return image.outerHTML;
}
