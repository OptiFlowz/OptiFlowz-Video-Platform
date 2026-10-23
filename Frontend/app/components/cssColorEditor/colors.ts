import { cssLanguage } from '@codemirror/lang-css';

export type ColorToken = { from: number; to: number; text: string };
export type RGBA = { r: number; g: number; b: number; a: number };
export function colorTokens(source: string, valid: (value: string) => boolean): ColorToken[] {
  const tokens: ColorToken[] = [];
  cssLanguage.parser.parse(source).iterate({ enter(node) {
    if (node.name === 'Comment' || node.name === 'StringLiteral') return false;
    if (!['ColorLiteral', 'ValueName', 'CallExpression'].includes(node.name)) return;
    let parent = node.node.parent;
    while (parent && parent.name !== 'Declaration') parent = parent.parent;
    if (!parent) return;
    const text = source.slice(node.from, node.to);
    // Context-dependent colors cannot be resolved independently of the certificate.
    if (/\b(?:var|env|currentcolor|inherit|initial|unset|revert|light-dark)\b/i.test(text) || !valid(text)) return;
    tokens.push({ from: node.from, to: node.to, text });
    return false;
  } });
  return tokens;
}
export function resolveColor(value: string): RGBA | null {
  if (!CSS.supports('color', value)) return null;
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = value;
  // Read canonical sRGB directly: an 8-bit canvas pixel would round alpha and
  // change RGB channels when un-premultiplying translucent colors.
  const canonical = String(ctx.fillStyle);
  if (/^#[\da-f]{6}$/i.test(canonical)) return { r: parseInt(canonical.slice(1,3),16), g: parseInt(canonical.slice(3,5),16), b: parseInt(canonical.slice(5,7),16), a: 1 };
  const rgb = canonical.match(/^rgba?\(([^)]+)\)$/i);
  if (rgb) {
    const channels = rgb[1].split(/[,\s/]+/).map(Number);
    if (channels.every(Number.isFinite)) return { r: channels[0], g: channels[1], b: channels[2], a: channels[3] ?? 1 };
  }
  ctx.clearRect(0, 0, 1, 1); ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return { r, g, b, a: a / 255 };
}
export function toHSV({ r, g, b }: RGBA) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  const h = !d ? 0 : max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h * 60, s: max ? d / max : 0, v: max };
}
export function fromHSV(h: number, s: number, v: number, a = 1): RGBA {
  const c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c;
  const [r, g, b] = h < 60 ? [c,x,0] : h < 120 ? [x,c,0] : h < 180 ? [0,c,x] : h < 240 ? [0,x,c] : h < 300 ? [x,0,c] : [c,0,x];
  return { r: Math.round((r+m)*255), g: Math.round((g+m)*255), b: Math.round((b+m)*255), a };
}
export const hexColor = ({ r, g, b }: RGBA) => '#' + [r,g,b].map(v => v.toString(16).padStart(2, '0')).join('');
export function serializeColor(color: RGBA, original: string) {
  if (/^rgba?\(/i.test(original)) return color.a < 1 || /^rgba/i.test(original) ? `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(3))})` : `rgb(${color.r}, ${color.g}, ${color.b})`;
  if (/^hsla?\(/i.test(original)) {
    const { h, s, v } = toHSV(color), l = v * (1 - s / 2), saturation = l === 0 || l === 1 ? 0 : (v-l)/Math.min(l,1-l);
    return `hsl(${Math.round(h)} ${Math.round(saturation*100)}% ${Math.round(l*100)}%${color.a < 1 ? ` / ${Number(color.a.toFixed(3))}` : ''})`;
  }
  return hexColor(color) + (color.a < 1 ? Math.round(color.a * 255).toString(16).padStart(2, '0') : '');
}
