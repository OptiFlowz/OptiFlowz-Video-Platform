const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const mod = { exports: {} };
const source = ts.transpileModule(fs.readFileSync('app/components/quizEngine/certificateQrOptions.js', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, allowJs: true } }).outputText;
new Function('exports', source)(mod.exports);
const { parseCertificateQrOptions: parse, isQrCodePlaceholder } = mod.exports;
const base = 'certificate.qr_code_data_uri';

test('QR styles preserve documented sizes, shape, gradient, corner and error-correction options', () => {
  const { options, marginModules } = parse(base + '.size_512.dots_classy-rounded.corners_extra-rounded.cornerdots_dot.gradient_linear_002244_663300_45.backgroundgradient_linear_eeeeee_ffffff.cornergradient_radial_001122_334455.cornerdotgradient_linear_110022_442266_90.margin_6.ecc_H');
  assert.equal(options.width, 512);
  assert.equal(options.dotsOptions.type, 'classy-rounded');
  assert.equal(options.dotsOptions.gradient.rotation, Math.PI / 4);
  assert.equal(options.cornersSquareOptions.type, 'extra-rounded');
  assert.equal(options.cornersDotOptions.type, 'dot');
  assert.equal(options.cornersDotOptions.gradient.rotation, Math.PI / 2);
  assert.equal(options.qrOptions.errorCorrectionLevel, 'H');
  assert.equal(marginModules, 6);
  assert.ok(isQrCodePlaceholder('{{ '+base+'.color_003E8E }}'));
  assert.equal(isQrCodePlaceholder('prefix{{'+base+'}}'), false);
  assert.deepEqual(parse(base+'.color_003e8e.dots_rounded'), parse(base+'.dots_rounded.color_003E8E'));
});

test('QR preview rejects invalid styles instead of silently rendering a different QR', () => {
  for (const suffix of ['.size_127', '.size_1025', '.margin_3', '.ecc_L', '.dots_invalid', '.color_fff', '.color_ffffff', '.color_003e8e.color_14243b', '.color_003e8e.gradient_linear_003e8e_14243b', '.image_https', '.gradient_linear_002244_663300_361']) {
    assert.throws(() => parse(base+suffix), /QR code:/, suffix);
  }
});
