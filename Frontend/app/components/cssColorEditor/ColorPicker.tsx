import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useI18n } from '~/i18n';
import { fromHSV, hexColor, toHSV, type RGBA } from './colors';
import styles from './editor.module.css';

type Props = { label: string; color: RGBA; anchor: DOMRect; onChange: (color: RGBA) => void; onClose: () => void };
export default function ColorPicker({ label, color, anchor, onChange, onClose }: Props) {
  const { t } = useI18n();
  const [hsv, setHSV] = useState(() => toHSV(color)), [alpha, setAlpha] = useState(color.a);
  const [hex, setHex] = useState(() => hexColor(color).slice(1).toUpperCase());
  const box = useRef<HTMLDivElement>(null), plane = useRef<HTMLCanvasElement>(null), hueCanvas = useRef<HTMLCanvasElement>(null);
  const [position, setPosition] = useState({ left: anchor.left, top: anchor.bottom + 8 });
  useLayoutEffect(() => {
    const bounds = box.current!.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8)), top: Math.max(8, anchor.bottom + 8 + bounds.height <= window.innerHeight ? anchor.bottom + 8 : anchor.top - bounds.height - 8) });
    box.current?.focus();
  }, [anchor]);
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) onClose(); };
    const dismiss = () => onClose();
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', dismiss); window.addEventListener('scroll', dismiss, true);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', dismiss); window.removeEventListener('scroll', dismiss, true); };
  }, [onClose]);
  useEffect(() => {
    const ctx = plane.current?.getContext('2d'); if (!ctx) return;
    const image = ctx.createImageData(200, 200);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) {
      const c = fromHSV(hsv.h, x / 199, 1-y/199), i = (y*200+x)*4;
      image.data.set([c.r,c.g,c.b,255], i);
    }
    ctx.putImageData(image, 0, 0);
  }, [hsv.h]);
  useEffect(() => {
    const ctx = hueCanvas.current?.getContext('2d'); if (!ctx) return;
    const image = ctx.createImageData(360, 1);
    for (let x = 0; x < 360; x++) { const c = fromHSV(x, 1, 1); image.data.set([c.r,c.g,c.b,255], x*4); }
    ctx.putImageData(image, 0, 0);
  }, []);
  const update = (next: typeof hsv, opacity = alpha) => {
    setHSV(next); setAlpha(opacity); const c = fromHSV(next.h, next.s, next.v, opacity); setHex(hexColor(c).slice(1).toUpperCase()); onChange(c);
  };
  const pointer = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    update({ ...hsv, s: Math.max(0, Math.min(1, (event.clientX-rect.left)/rect.width)), v: 1-Math.max(0, Math.min(1, (event.clientY-rect.top)/rect.height)) });
  };
  return createPortal(<div ref={box} className={styles.picker} style={position} role="dialog" aria-label={label} tabIndex={-1} onKeyDown={event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(); }
    if (event.key === 'Tab') {
      const controls = Array.from(box.current!.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]'));
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }}>
    <div className={styles.plane} onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); pointer(event); }} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) pointer(event); }}>
      <canvas ref={plane} width={200} height={200} aria-hidden="true" />
      <span className={styles.cursor} style={{ left: `${hsv.s*100}%`, top: `${(1-hsv.v)*100}%`, '--selected-color': hexColor(fromHSV(hsv.h,hsv.s,hsv.v)) } as CSSProperties} />
    </div>
    <div className={styles.hue}>
      <canvas ref={hueCanvas} width={360} height={1} aria-hidden="true" />
      <input aria-label="H" title="H" type="range" min={0} max={359} value={hsv.h} onChange={event => update({ ...hsv, h: Number(event.target.value) })} style={{ '--selected-color': hexColor(fromHSV(hsv.h,1,1)) } as CSSProperties} />
    </div>
    <div className={styles.values}>
      <label className={styles.hex}><span>#</span><input aria-label="HEX" value={hex} maxLength={9} spellCheck={false} onChange={event => {
        const value = event.target.value.replace(/^#/, ''); setHex(value);
        if (/^[\da-f]{6}$/i.test(value)) { const rgb = { r: parseInt(value.slice(0,2),16), g: parseInt(value.slice(2,4),16), b: parseInt(value.slice(4,6),16), a: alpha }; setHSV(toHSV(rgb)); onChange(rgb); }
      }} onBlur={() => {
        if (/^[\da-f]{3}$/i.test(hex)) { const expanded = hex.split('').map(c => c+c).join(''); const rgb = { r: parseInt(expanded.slice(0,2),16), g: parseInt(expanded.slice(2,4),16), b: parseInt(expanded.slice(4,6),16), a: alpha }; update(toHSV(rgb)); }
        else setHex(hexColor(fromHSV(hsv.h,hsv.s,hsv.v)).slice(1).toUpperCase());
      }} /></label>
      <label className={styles.alpha}><input aria-label="Alpha (%)" type="number" min={0} max={100} value={Math.round(alpha*100)} onChange={event => update(hsv, Math.max(0,Math.min(100,Number(event.target.value)))/100)} /><span>%</span></label>
    </div>
    <div className={styles.accessibleSliders}>
      <input aria-label="S" type="range" min={0} max={100} value={hsv.s*100} onChange={event => update({ ...hsv,s:Number(event.target.value)/100 })} />
      <input aria-label="V" type="range" min={0} max={100} value={hsv.v*100} onChange={event => update({ ...hsv,v:Number(event.target.value)/100 })} />
    </div>
    <button className={styles.close} type="button" onClick={onClose}>{t('close')}</button>
  </div>, document.body);
}
