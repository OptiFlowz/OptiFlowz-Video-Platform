/** Keep the issued title readable, with a stable certificate number for uniqueness. */
export function certificatePdfFilename(title: string, number: string): string {
  const clean = (value: string, limit: number) => Array.from(value.normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ').trim()).slice(0, limit).join('').replace(/[. ]+$/g, '').replace(/^\.+/, '').trim();
  const name = [clean(title, 100), clean(number, 60)].filter(Boolean).join(' - ') || 'Certificate';
  return `${/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name}.pdf`;
}

export function downloadCertificatePdf(url: string, filename: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); }
}
