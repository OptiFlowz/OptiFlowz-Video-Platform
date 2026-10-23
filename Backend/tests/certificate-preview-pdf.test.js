import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { chromium } from 'playwright';
import { buildPreviewDocument } from '../src/modules/certificates/certificate-templates/helpers/previewDocument.js';
import { renderCertificatePdf } from '../src/modules/certificates/certificate-templates/services/renderCertificatePdf.js';
import { loadDefaultCertificateTemplate, loadMinimalCertificateTemplate, loadModernCertificateTemplate } from './helpers/default-certificate-template.js';

const executablePath = process.env.CERTIFICATE_CHROMIUM_EXECUTABLE_PATH || process.env.PUPPETEER_EXECUTABLE_PATH || chromium.executablePath();
const browserAvailable = existsSync(executablePath);
const template = {
  html_template: '<h1>{{user.full_name}}</h1><p>{{quiz.title}}</p>',
  css_template: '.certificate {display:grid;place-items:center;background:rgb(240,240,250)} h1 {color:navy}',
  page_format: 'A4', orientation: 'landscape',
};

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
