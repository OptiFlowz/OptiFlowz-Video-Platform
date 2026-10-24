import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { buildPreviewDocument } from '../src/modules/certificates/certificate-templates/helpers/previewDocument.js';
import { renderCertificatePdf } from '../src/modules/certificates/certificate-templates/services/renderCertificatePdf.js';
import { fillCertificateQrCode } from '../src/modules/certificates/helpers/certificateQrCode.js';
import { loadDefaultCertificateTemplate, loadMinimalCertificateTemplate, loadModernCertificateTemplate } from './helpers/default-certificate-template.js';

const executablePath = process.env.CERTIFICATE_CHROMIUM_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || chromium.executablePath();
const browserAvailable = existsSync(executablePath);
const template = {
  html_template: '<h1>{{user.full_name}}</h1><p>{{quiz.title}}</p>',
  css_template: '.certificate {display:grid;place-items:center;background:rgb(240,240,250)} h1 {color:navy}',
  page_format: 'A4', orientation: 'landscape',
};

test('QR PNG renders in PDF and respects template CSS position and dimensions', { skip: !browserAvailable }, async () => {
  const document = buildPreviewDocument({ ...template,
    html_template: '<img src="{{certificate.qr_code_data_uri}}" class="qr-code" alt="QR verifikacija">',
    css_template: '.qr-code {position:absolute; left:37px; top:53px; width:96px; height:96px}',
  });
  document.html = await fillCertificateQrCode(document.html, 'https://videoplatform.optiflowz.com/certificates/verify/preview');
  const pdf = await renderCertificatePdf(document);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /\/Subtype\s*\/Image/);
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.setContent(document.html);
    const details = await page.evaluate(() => {
      const image = document.querySelector('.qr-code');
      const rect = image.getBoundingClientRect();
      return { loaded: image.complete, naturalWidth: image.naturalWidth, x: rect.x, y: rect.y, width: rect.width, height: rect.height };
    });
    assert.deepEqual(details, { loaded: true, naturalWidth: 512, x: 37, y: 53, width: 96, height: 96 });
  } finally { await browser.close(); }
});

test('embedded custom fonts and SVG geometry render in Chromium and the generated PDF', { skip: !browserAvailable }, async () => {
  // Reuse the real font shipped with our browser-test dependency; no network or system-font assumption.
  const fixtureDir = new URL('../node_modules/playwright-core/lib/vite/traceViewer/', import.meta.url);
  const filename = (await readdir(fixtureDir)).find(name => name.endsWith('.ttf'));
  assert.ok(filename, 'Playwright ships its icon-font fixture');
  const font = await readFile(new URL(filename, fixtureDir));
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50" width="100" height="50"><rect width="100" height="50" fill="gold"/></svg>';
  const dataSvg = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  const document = buildPreviewDocument({ ...template,
    html_template: `<svg id="vector" viewBox="0 0 100 50" width="100" height="50"><defs><linearGradient id="paint"><stop offset="0" stop-color="gold"/><stop offset="1" stop-color="white"/></linearGradient></defs><rect width="100" height="50" fill="url(#paint)"/></svg>
      <img id="seal" src="${dataSvg}"><p id="custom-font" style="font-family:CertificateIcons;font-size:40px">&#xea60;</p>`,
    css_template: `@font-face {font-family:CertificateIcons;src:url('data:font/ttf;base64,${font.toString('base64')}') format('truetype')}
      .certificate {display:block} #vector {stroke:black;stroke-width:1}`,
  });
  const pdf = await renderCertificatePdf(document);
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(pdf.toString('latin1'), /codicon/i, 'PDF embeds the custom font');
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.setContent(document.html);
    const details = await page.evaluate(async () => {
      await document.fonts.ready;
      const vector = document.querySelector('#vector');
      const image = document.querySelector('#seal');
      return { viewBox: vector.viewBox.baseVal.width, gradient: vector.querySelector('linearGradient').localName,
        fill: getComputedStyle(vector.querySelector('rect')).fill, imageWidth: image.naturalWidth,
        fonts: Array.from(document.fonts).map(font => ({ family: font.family, status: font.status })) };
    });
    assert.equal(details.viewBox, 100);
    assert.equal(details.gradient, 'linearGradient');
    assert.match(details.fill, /url\(.*#paint/);
    assert.equal(details.imageWidth, 100);
    assert.deepEqual(details.fonts, [{ family: 'CertificateIcons', status: 'loaded' }]);
  } finally { await browser.close(); }
});

for (const [name, loadTemplate] of [['Classic', loadDefaultCertificateTemplate], ['Minimal', loadMinimalCertificateTemplate], ['Modern', loadModernCertificateTemplate]]) {
test(`the seeded ${name} design renders as one Letter landscape PDF page with visible certificate fields`, { skip: !browserAvailable }, async () => {
  const document = buildPreviewDocument(await loadTemplate());
  const pdf = await renderCertificatePdf(document);
  const text = pdf.toString('latin1');
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.match(text, /\/MediaBox\s*\[0 0 792 612\]/);
  assert.equal((text.match(/\/Type\s*\/Page\b/g) || []).length, 1);
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    await page.setContent(document.html);
    const details = await page.evaluate(() => {
      const canvas = document.querySelector('.certificate-content').getBoundingClientRect();
      return ['recipient-name', 'course-title', 'score', 'earned', 'maximum', 'completion-date', 'certificate-number'].map(id => {
        const element = document.getElementById(id), rect = element.getBoundingClientRect();
        return { id, text: element.textContent, visible: rect.width > 0 && rect.height > 0 && rect.left >= canvas.left
          && rect.top >= canvas.top && rect.right <= canvas.right && rect.bottom <= canvas.bottom };
      });
    });
    assert.equal(details[0].text, 'John Anderson');
    for (const field of details) assert.equal(field.visible, true, `${field.id} must fit within the certificate`);
  } finally { await browser.close(); }
});
}

test('real Chromium produces a one-page PDF in all supported formats/orientations', { skip: !browserAvailable }, async () => {
  for (const [page_format, orientation, width, height] of [
    ['A4', 'landscape', 841.89, 595.28], ['A4', 'portrait', 595.28, 841.89],
    ['Letter', 'landscape', 792, 612], ['Letter', 'portrait', 612, 792],
  ]) {
    const pdf = await renderCertificatePdf(buildPreviewDocument({ ...template, page_format, orientation }));
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
    const text = pdf.toString('latin1');
    const box = /\/MediaBox\s*\[0 0 ([\d.]+) ([\d.]+)\]/.exec(text);
    assert.ok(box, 'PDF has a MediaBox');
    assert.ok(Math.abs(Number(box[1]) - width) < 2, `${page_format} ${orientation}: width ${box[1]}`);
    assert.ok(Math.abs(Number(box[2]) - height) < 2, `${page_format} ${orientation}: height ${box[2]}`);
    assert.equal((text.match(/\/Type\s*\/Page\b/g) || []).length, 1);
  }
});

test('real renderer makes no requests for images, CSS resources or scripts, even without document CSP', { skip: !browserAvailable }, async t => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('not allowed'); });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const base = `http://127.0.0.1:${server.address().port}`;
  const pdf = await renderCertificatePdf({ format: 'A4', landscape: false,
    html: `<html><head><link rel="stylesheet" href="${base}/styles"><style>body{background-image:url(${base}/background)}</style></head>
      <body><img src="${base}/image"><script>fetch('${base}/script')</script><p>Offline preview</p></body></html>` });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.equal(requests, 0);
});

test('render document keeps stray closing tags and selectors inside the certificate wrapper', { skip: !browserAvailable }, async () => {
  const browser = await chromium.launch({ executablePath, headless: true, chromiumSandbox: true });
  try {
    const page = await browser.newPage({ javaScriptEnabled: false });
    const document = buildPreviewDocument({ ...template,
      html_template: '</div><h1 id="name">{{user.full_name}}</h1><p>Passed</p>',
      css_template: 'body {color:rgb(12,34,56)} .certificate + #outside {color:red} #outside {font-size:99px} h1 {font-size:40px} h1::before {content:"Award: "} .certificate::after {content:"Verified"}',
    });
    await page.setContent(document.html);
    // Trusted test code can inspect the DOM even while page-authored scripts are disabled.
    const result = await page.evaluate(() => {
      const outside = document.createElement('div');
      outside.id = 'outside'; outside.textContent = 'Outside'; document.body.append(outside);
      return {
        text: document.querySelector('#name').textContent,
        inside: document.querySelector('#name').parentElement.className,
        insideColor: getComputedStyle(document.querySelector('#name')).color,
        outsideColor: getComputedStyle(outside).color,
        outsideSize: getComputedStyle(outside).fontSize,
        bodyColor: getComputedStyle(document.body).color,
        rootCount: document.body.querySelectorAll(':scope > .certificate').length,
        before: getComputedStyle(document.querySelector('#name'), '::before').content,
        after: getComputedStyle(document.querySelector('.certificate'), '::after').content,
      };
    });
    assert.equal(result.text, 'John Anderson');
    assert.equal(result.inside, 'certificate');
    assert.equal(result.insideColor, 'rgb(12, 34, 56)');
    assert.equal(result.outsideColor, 'rgb(0, 0, 0)');
    assert.equal(result.bodyColor, 'rgb(0, 0, 0)');
    assert.equal(result.outsideSize, '16px');
    assert.equal(result.rootCount, 1);
    assert.equal(result.before, '"Award: "');
    assert.equal(result.after, '"Verified"');
  } finally { await browser.close(); }
});
