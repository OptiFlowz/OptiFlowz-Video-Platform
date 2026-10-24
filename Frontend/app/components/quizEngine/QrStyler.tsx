import { useEffect, useMemo, useState, useId, type CSSProperties } from 'react';
import { useI18n } from '~/i18n';
import { CopySVG, CheckSVG } from '~/constants';
import ColorPicker from '../cssColorEditor/ColorPicker';
import { hexColor } from '../cssColorEditor/colors';
import CodeEditor from '../cssColorEditor/CssColorEditor';
import { styles, Field, Select } from './shared';
import { certificateQrImages } from './certificateQrStyles';
import { readQrSnippet, updateQrSnippet } from './qrStylerModel';

const snippet = (key: string) => `<img src="{{${key}}}" class="certificate-qr" alt="QR Code" width="104" height="104" />`;
const dotStyles = ['square', 'dots', 'rounded', 'extra-rounded', 'classy', 'classy-rounded'];
const cornerStyles = ['square', 'dot', 'dots', 'rounded', 'extra-rounded', 'classy', 'classy-rounded'];

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  value = /^[a-f0-9]{6}$/i.test(value ?? '') ? value : '000000';
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const color = { r: parseInt(value.slice(0, 2), 16), g: parseInt(value.slice(2, 4), 16), b: parseInt(value.slice(4, 6), 16), a: 1 };
  return <div className={styles.qrColor}>
    <button type="button" aria-label={label} onClick={event => setAnchor(event.currentTarget.getBoundingClientRect())}>
      <span style={{ '--qr-swatch': `#${value}` } as CSSProperties} /><code>#{value.toUpperCase()}</code>
    </button>
    {anchor && <ColorPicker label={label} color={color} anchor={anchor} allowAlpha={false} onClose={() => setAnchor(null)} onChange={next => onChange(hexColor(next).slice(1))} />}
  </div>;
}

export default function QrStyler() {
  const { t } = useI18n();
  const headingId = useId();
  const [code, setCode] = useState(() => snippet('certificate.qr_code_data_uri'));
  const [preview, setPreview] = useState({ code: '', image: '', error: '' });
  const [copied, setCopied] = useState(false), [copyError, setCopyError] = useState('');
  const parsed = useMemo(() => { try { return { value: readQrSnippet(code), error: '' }; } catch (error) { return { value: null, error: (error as Error).message }; } }, [code]);
  useEffect(() => {
    setCopied(false); setCopyError('');
    if (!parsed.value) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void certificateQrImages(code).then(images => { if (!cancelled) setPreview({ code, image: Object.values(images)[0] ?? '', error: '' }); })
        .catch(error => { if (!cancelled) setPreview({ code, image: '', error: (error as Error).message }); });
    }, 160);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [code, parsed]);
  useEffect(() => { if (!copied) return; const timer = window.setTimeout(() => setCopied(false), 2000); return () => window.clearTimeout(timer); }, [copied]);
  const patch = (values: Record<string, string | null>) => { if (parsed.value) setCode(updateQrSnippet(code, values)); };
  const params = parsed.value?.parameters ?? {};
  const error = parsed.error || (preview.code === code ? preview.error : '') || copyError;
  const choose = (name: string, values: string[], fallback: string) => <Field label={name}><Select label={`QR ${name}`} disabled={!parsed.value} value={params[name] ?? fallback} values={values.map(value => ({ value, label: value }))} onChange={value => patch({ [name]: value })} /></Field>;
  const palette = (solid: string, gradient: string, fallback: string, inherited = false) => {
    const parts = (params[gradient] ?? `linear_${params[solid] ?? fallback}_${fallback}_0`).split('_');
    const mode = params[gradient] ? parts[0] : params[solid] || !inherited ? 'HEX' : 'auto';
    const changeGradient = (index: number, value: string) => { const next = [...parts]; next[index] = value; patch({ [gradient]: next.join('_'), [solid]: null }); };
    return <div className={styles.qrPalette} key={solid}>
      <Field label={solid}><Select label={`QR ${solid}`} disabled={!parsed.value} value={mode} values={[...(inherited ? [{ value: 'auto', label: t('quizCertificateDefault') }] : []), ...['HEX', 'linear', 'radial'].map(value => ({ value, label: value }))]} onChange={value => patch(value === 'auto' ? { [solid]: null, [gradient]: null } : value === 'HEX' ? { [solid]: parts[1], [gradient]: null } : { [solid]: null, [gradient]: `${value}_${parts[1]}_${parts[2]}_${parts[3] ?? '0'}` })} /></Field>
      {mode !== 'auto' && <div className={styles.qrPaletteColors}>
        <ColorControl label={`QR ${solid} HEX 1`} value={mode === 'HEX' ? params[solid] ?? fallback : parts[1]} onChange={value => mode === 'HEX' ? patch({ [solid]: value }) : changeGradient(1, value)} />
        {mode !== 'HEX' && <><ColorControl label={`QR ${solid} HEX 2`} value={parts[2]} onChange={value => changeGradient(2, value)} /><label className={styles.qrAngle}><input aria-label={`QR ${gradient} °`} type="number" min={0} max={360} value={parts[3] ?? '0'} onChange={event => changeGradient(3, String(Math.max(0, Math.min(360, Number(event.target.value)))))} /><span>°</span></label></>}
      </div>}
    </div>;
  };
  return <details className={styles.qrStyler} aria-labelledby={headingId}>
    <summary><h2 id={headingId}>QR · {t('privacyCustomize')}</h2></summary>
    <div className={styles.qrStylerContent}>
      <fieldset disabled={!parsed.value} className={styles.qrControls}>
        <div className={styles.qrStylerTop}>
          <div className={styles.qrShapes}>{choose('dots', dotStyles, 'square')}{choose('corners', cornerStyles, 'square')}{choose('cornerdots', cornerStyles, 'square')}</div>
          <div className={styles.qrStylerPreview} aria-label={`QR ${t('postPreview')}`} aria-busy={!!parsed.value && preview.code !== code}>
            {parsed.value && preview.image && !error && <img src={preview.image} alt={`QR ${t('postPreview')}`} />}
          </div>
        </div>
        {palette('color', 'gradient', '000000')}
        {palette('background', 'backgroundgradient', 'ffffff')}
        <details className={styles.qrAdvanced}><summary>{t('settingsAdvancedTab')}</summary><div className={styles.qrAdvancedContent}>
          {palette('cornercolor', 'cornergradient', '003e8e', true)}{palette('cornerdotcolor', 'cornerdotgradient', '003e8e', true)}
          <div className={styles.qrGrid}><Field label="size (px)"><input aria-label="QR size" type="number" min={128} max={1024} value={params.size ?? '512'} onChange={event => patch({ size: String(Math.max(128, Math.min(1024, Number(event.target.value)))) })} /></Field>
          <Field label="margin"><input aria-label="QR margin" type="number" min={4} max={16} value={params.margin ?? '4'} onChange={event => patch({ margin: String(Math.max(4, Math.min(16, Number(event.target.value)))) })} /></Field>
          {choose('ecc', ['M', 'Q', 'H'], 'Q')}</div>
        </div></details>
      </fieldset>
      <div className={styles.qrCodeHeading}><span>HTML</span><button type="button" className={styles.button} disabled={!parsed.value || preview.code !== code || !!preview.error} onClick={async () => { try { await navigator.clipboard.writeText(code); setCopied(true); } catch { setCopyError(t('quizError')); } }}>{copied ? CheckSVG : CopySVG}{t(copied ? 'liveCopied' : 'copy')}</button></div>
      <CodeEditor language="html" label="QR HTML" value={code} onChange={setCode} />
      {error && <p role="alert" className={styles.qrError}>{error}</p>}
    </div>
  </details>;
}
