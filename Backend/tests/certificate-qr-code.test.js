import assert from 'node:assert/strict';
import { test } from 'node:test';
import QRCode from 'qrcode';
import { generateCertificateQrCode, getPreviewVerificationUrl, fillCertificateQrCode } from '../src/modules/certificates/helpers/certificateQrCode.js';
import { validateTemplateContent } from '../src/modules/certificates/certificate-templates/helpers/templateContent.validation.js';
import { buildPreviewDocument } from '../src/modules/certificates/certificate-templates/helpers/previewDocument.js';

const placeholder = '{{certificate.qr_code_data_uri}}';
const template = {
  html_template: `<img src="${placeholder}" class="qr-code" alt="QR verifikacija" />`,
  css_template: '.qr-code { position:absolute; right:24px; bottom:32px; width:96px; height:96px }',
  page_format: 'A4', orientation: 'landscape',
};

test('QR placeholder is accepted only as the complete HTML img src value', () => {
  for (const html_template of [template.html_template, '<IMG SRC="{{ certificate.qr_code_data_uri }}">',
    '<img src="&#123;&#123;certificate.qr_code_data_uri&#125;&#125;">']) {
    const source = { html_template };
    assert.equal(validateTemplateContent(source), source);
  }
  for (const html_template of [
    `<p>${placeholder}</p>`, `<img alt="${placeholder}">`, `<a href="${placeholder}">QR</a>`,
    `<div src="${placeholder}"></div>`, `<img src="https://example.com/${placeholder}">`,
    `<img src="${placeholder}suffix">`, `<img src=" ${placeholder}">`,
    `<img src="${placeholder}\n">`,
    `<div style="background:url('${placeholder}')"></div>`,
    `<svg><text>${placeholder}</text></svg>`, `<svg><img src="${placeholder}"/></svg>`,
    `<svg><use href="${placeholder}"/></svg>`, `<!-- ${placeholder} -->`, `<!DOCTYPE ${placeholder}>`,
    '<p>&#123;&#123;certificate.qr_code_data_uri&#125;&#125;</p>',
    '<img src="{{certificate.qr_code_data_uri}}" alt="{{certificate.qr_code_data_uri}}">',
    '<img src="{{{certificate.qr_code_data_uri}}}">',
  ]) assert.throws(() => validateTemplateContent({ html_template }), { status: 422 }, html_template);
  assert.throws(() => validateTemplateContent({ css_template: `.qr {background:url('${placeholder}')}` }), { status: 422 });
});

test('preview URL uses the configured frontend and a test verification identifier', () => {
  assert.equal(getPreviewVerificationUrl('https://videoplatform.optiflowz.com'),
    'https://videoplatform.optiflowz.com/certificates/verify/preview');
  assert.equal(getPreviewVerificationUrl('https://example.com/app/?old=1#fragment'),
    'https://example.com/app/certificates/verify/preview');
  for (const invalid of ['', 'example.com', 'file:///tmp', 'https://user:secret@example.com']) {
    assert.throws(() => getPreviewVerificationUrl(invalid), { status: 500 });
  }
});

test('shared generator encodes the supplied URL as PNG; render replacement preserves template and CSS', async t => {
  const spy = t.mock.method(QRCode, 'toDataURL');
  const url = getPreviewVerificationUrl('https://videoplatform.optiflowz.com');
  const original = structuredClone(template);
  const document = buildPreviewDocument(template);
  const rendered = await fillCertificateQrCode(document.html, url);
  assert.equal(spy.mock.calls[0].arguments[0], url);
  assert.equal(spy.mock.calls[0].arguments[1].type, 'image/png');
  const dataUri = rendered.match(/src="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/)[1];
  const png = Buffer.from(dataUri.split(',')[1], 'base64');
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
  assert.doesNotMatch(rendered, /\{\{/);
  assert.match(rendered, /right:24px; bottom:32px; width:96px; height:96px/);
  assert.deepEqual(template, original);
  // User-authored PNG data does not bypass the existing resource policy.
  assert.throws(() => validateTemplateContent({ html_template: `<img src="${dataUri}">` }), { status: 422 });
  await generateCertificateQrCode('https://example.com/certificates/verify/real-token');
  assert.equal(spy.mock.calls[1].arguments[0], 'https://example.com/certificates/verify/real-token');
  const repeated = await fillCertificateQrCode(`${document.html}${document.html}`, url);
  assert.equal(spy.mock.callCount(), 3, 'generate once per render even with repeated images');
  assert.equal((repeated.match(/src="data:image\/png;base64,/g) || []).length, 2);
  assert.equal(await fillCertificateQrCode('<p>No QR</p>'), '<p>No QR</p>');
  assert.equal(spy.mock.callCount(), 3);
});
