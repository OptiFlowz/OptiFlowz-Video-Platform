import { readFile } from 'node:fs/promises';

// Exercise the actual migration seed rather than a second copy of the certificate design.
export async function loadDefaultCertificateTemplate() {
  return loadSeed('1792713600000_add-system-certificate-templates.sql');
}

export async function loadMinimalCertificateTemplate() {
  return loadSeed('1792713600001_add-minimal-certificate-template.sql');
}

export async function loadModernCertificateTemplate() {
  return loadSeed('1792713600002_add-modern-certificate-template.sql');
}

async function loadSeed(filename) {
  const migration = await readFile(new URL(`../../src/database/migrations/${filename}`, import.meta.url), 'utf8');
  const html_template = /\$certificate_html\$([\s\S]*?)\$certificate_html\$/.exec(migration)?.[1];
  const css_template = /\$certificate_css\$([\s\S]*?)\$certificate_css\$/.exec(migration)?.[1];
  if (!html_template || !css_template) throw new Error(`Certificate migration seed is missing: ${filename}`);
  return { html_template, css_template, page_format: 'Letter', orientation: 'landscape' };
}
