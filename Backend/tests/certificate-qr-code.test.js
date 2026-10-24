import assert from 'node:assert/strict';
import { test } from 'node:test';
import QRCodeStyling from 'qr-code-styling';
import sharp from 'sharp';
import jsQR from 'jsqr';
import { parseCertificateQrOptions, QR_CODE_KEY } from '../src/modules/certificates/helpers/certificateQrOptions.js';
import { generateCertificateQrCode, getPreviewVerificationUrl, fillCertificateQrCode } from '../src/modules/certificates/helpers/certificateQrCode.js';
import { validateTemplateContent } from '../src/modules/certificates/certificate-templates/helpers/templateContent.validation.js';
import { buildPreviewDocument } from '../src/modules/certificates/certificate-templates/helpers/previewDocument.js';

const placeholder = '{{certificate.qr_code_data_uri}}';
const styledPlaceholder = '{{certificate.qr_code_data_uri.size_200.color_ff6937.dots_rounded.background_ffffff}}';
const verificationUrl = 'https://videoplatform.optiflowz.com/certificates/verify/preview';
async function decode(dataUri) {
  const { data, info } = await sharp(Buffer.from(dataUri.split(',')[1], 'base64')).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return jsQR(new Uint8ClampedArray(data), info.width, info.height)?.data;
}
const template = {
  html_template: `<img src="${placeholder}" class="qr-code" alt="QR verifikacija" />`,
  css_template: '.qr-code { position:absolute; right:24px; bottom:32px; width:96px; height:96px }',
  page_format: 'A4', orientation: 'landscape',
};

test('QR placeholder is accepted only as the complete HTML img src value', () => {
  for (const html_template of [template.html_template, '<IMG SRC="{{ certificate.qr_code_data_uri }}">',
    `<img src="${styledPlaceholder}">`,
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
  for (const html_template of [`<p>${styledPlaceholder}</p>`, `<img alt="${styledPlaceholder}">`,
    `<img src="prefix${styledPlaceholder}">`, `<svg><text>${styledPlaceholder}</text></svg>`,
    `<p>${styledPlaceholder.replaceAll('{', '&#123;').replaceAll('}', '&#125;')}</p>`]) {
    assert.throws(() => validateTemplateContent({ html_template }), { status: 422 });
  }
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
  const spy = t.mock.method(QRCodeStyling.prototype, 'getRawData');
  const url = getPreviewVerificationUrl('https://videoplatform.optiflowz.com');
  const original = structuredClone(template);
  const document = buildPreviewDocument(template);
  const rendered = await fillCertificateQrCode(document.html, url);
  assert.equal(spy.mock.calls[0].arguments[0], 'svg');
  const dataUri = rendered.match(/src="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/)[1];
  const png = Buffer.from(dataUri.split(',')[1], 'base64');
  assert.equal(await decode(dataUri), url);
  assert.deepEqual(png.subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  assert.equal(png.readUInt32BE(16), 512);
  assert.equal(png.readUInt32BE(20), 512);
  assert.doesNotMatch(rendered, /\{\{/);
  assert.match(rendered, /right:24px; bottom:32px; width:96px; height:96px/);
  assert.deepEqual(template, original);
  // User-authored PNG data does not bypass the existing resource policy.
  assert.throws(() => validateTemplateContent({ html_template: `<img src="${dataUri}">` }), { status: 422 });
  const issuedUrl = 'https://example.com/certificates/verify/real-token';
  assert.equal(await decode(await generateCertificateQrCode(issuedUrl)), issuedUrl);
  const repeated = await fillCertificateQrCode(`${document.html}${document.html}`, url);
  assert.equal(spy.mock.callCount(), 3, 'generate once per render even with repeated images');
  assert.equal((repeated.match(/src="data:image\/png;base64,/g) || []).length, 2);
  assert.equal(await fillCertificateQrCode('<p>No QR</p>'), '<p>No QR</p>');
  assert.equal(spy.mock.callCount(), 3);
});

test('style parameters map to library options independently of parameter order', () => {
  const parsed = parseCertificateQrOptions(`${QR_CODE_KEY}.size_200.color_ff6937.dots_rounded.background_ffffff`);
  assert.equal(parsed.options.width, 200);
  assert.equal(parsed.options.height, 200);
  assert.deepEqual(parsed.options.dotsOptions, { type: 'rounded', color: '#ff6937', roundSize: true });
  assert.equal(parsed.options.backgroundOptions.color, '#ffffff');
  assert.deepEqual(parsed, parseCertificateQrOptions(`${QR_CODE_KEY}.dots_rounded.background_ffffff.size_200.color_ff6937`));
  const { options, marginModules } = parseCertificateQrOptions(`${QR_CODE_KEY}.corners_extra-rounded.cornerdots_dot.cornercolor_102030.cornerdotcolor_203040.margin_6.ecc_H`);
  assert.deepEqual(options.cornersSquareOptions, { type: 'extra-rounded', color: '#102030' });
  assert.deepEqual(options.cornersDotOptions, { type: 'dot', color: '#203040' });
  assert.equal(options.qrOptions.errorCorrectionLevel, 'H');
  assert.equal(marginModules, 6);
  for (const [name, target] of [['gradient', 'dotsOptions'], ['cornergradient', 'cornersSquareOptions'],
    ['cornerdotgradient', 'cornersDotOptions'], ['backgroundgradient', 'backgroundOptions']]) {
    const colors = name === 'backgroundgradient' ? 'eeeeee_ffffff' : '001122_334455';
    const { options: shaded } = parseCertificateQrOptions(`${QR_CODE_KEY}.${name}_linear_${colors}_90`);
    assert.equal(shaded[target].gradient.rotation, Math.PI / 2);
    assert.deepEqual(shaded[target].gradient.colorStops.map(stop => stop.offset), [0, 1]);
  }
});

test('unknown, repeated, malformed and unreadable style options fail central validation', () => {
  for (const suffix of ['unknown_foo', 'size_0', 'size_1025', 'size_1e3', 'size_200.size_300',
    'color_fff', 'color_ffffff', 'color_000000.background_000000', 'background_transparent',
    'dots_invalid', 'corners_unknown', 'cornerdots_unknown', 'margin_0', 'margin_17', 'ecc_L',
    'gradient_linear_000000_ffffff', 'gradient_linear_000000_111111_361',
    'color_000000.gradient_linear_000000_111111', 'gradient_linear_000000',
    'size_200..dots_rounded', '__proto___foo', 'image_https://example.com/logo.png', 'size_200.']) {
    assert.throws(() => validateTemplateContent({ html_template: `<img src="{{${QR_CODE_KEY}.${suffix}}}">` }), { status: 422 }, suffix);
  }
});

test('user example, every supported dot/corner style and gradients produce decodable PNGs', async () => {
  const examples = ['size_200.color_ff6937.dots_rounded.background_ffffff',
    ...['square', 'dots', 'rounded', 'extra-rounded', 'classy', 'classy-rounded'].map(type => `dots_${type}`),
    ...['square', 'dot', 'dots', 'rounded', 'extra-rounded', 'classy', 'classy-rounded'].map(type => `corners_${type}.cornerdots_${type}`),
    'gradient_linear_002244_663300_45.cornergradient_radial_001122_334455.cornerdotgradient_linear_110022_442266_90.backgroundgradient_linear_eeeeee_ffffff',
    'size_256.margin_6.ecc_H.cornercolor_102030.cornerdotcolor_203040'];
  for (const suffix of examples) {
    const dataUri = await generateCertificateQrCode(verificationUrl, `${QR_CODE_KEY}.${suffix}`);
    assert.equal(await decode(dataUri), verificationUrl, suffix);
    if (suffix.startsWith('size_200')) assert.equal((await sharp(Buffer.from(dataUri.split(',')[1], 'base64')).metadata()).width, 200);
  }
  await assert.rejects(generateCertificateQrCode(verificationUrl, `${QR_CODE_KEY}.size_128.margin_16.ecc_H`), { status: 422 });
});

test('mixed placeholders get their own style while equivalent styles render once', async t => {
  const spy = t.mock.method(QRCodeStyling.prototype, 'getRawData');
  const source = { ...template, html_template: `<img src="${placeholder}"><img src="${styledPlaceholder}"><img src="{{${QR_CODE_KEY}.dots_rounded.background_ffffff.color_ff6937.size_200}}">` };
  const original = structuredClone(source);
  const document = buildPreviewDocument(source);
  const filled = await fillCertificateQrCode(document.html, verificationUrl);
  const images = [...filled.matchAll(/src="(data:image\/png;base64,[^"]+)"/g)].map(match => match[1]);
  assert.equal(images.length, 3);
  assert.notEqual(images[0], images[1]);
  assert.equal(images[1], images[2]);
  assert.equal(spy.mock.callCount(), 2);
  assert.doesNotMatch(filled, /\{\{/);
  assert.deepEqual(source, original);
  const excessive = Array.from({ length: 9 }, (_, index) => `<img src="{{${QR_CODE_KEY}.size_${200 + index}}}">`).join('');
  await assert.rejects(fillCertificateQrCode(excessive, verificationUrl), { status: 422 });
  assert.equal(spy.mock.callCount(), 2, 'reject excessive styles before generating');
});
