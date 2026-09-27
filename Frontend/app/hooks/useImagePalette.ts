import { useEffect, useState, type CSSProperties } from "react";

type Palette = [string, string, string];
const cache = new Map<string, Palette>();

function samplePalette(image: HTMLImageElement): Palette | undefined {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 48;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0, 48, 48);
    const pixels = context.getImageData(0, 0, 48, 48).data;
    const buckets = new Map<number, { count: number; rgb: number[]; weight: number }>();
    for (let i = 0; i < pixels.length; i += 4) {
        const rgb = [pixels[i], pixels[i + 1], pixels[i + 2]];
        const max = Math.max(...rgb), min = Math.min(...rgb);
        if (pixels[i + 3] < 128 || max < 25 || min > 230) continue;
        const key = (rgb[0] >> 5) * 64 + (rgb[1] >> 5) * 8 + (rgb[2] >> 5);
        const bucket = buckets.get(key) ?? { count: 0, rgb: [0, 0, 0], weight: 0 };
        bucket.count++;
        rgb.forEach((value, channel) => { bucket.rgb[channel] += value; });
        // Prefer colorful areas over white lettering and neutral backgrounds.
        bucket.weight += .15 + (max - min) / Math.max(max, 1);
        buckets.set(key, bucket);
    }
    const colors = [...buckets.values()].map(bucket => ({
        rgb: bucket.rgb.map(value => Math.round(value / bucket.count)),
        weight: bucket.weight,
    })).sort((a, b) => b.weight - a.weight);
    if (!colors.length) return;
    const selected = [colors[0]];
    while (selected.length < 3) {
        const candidate = colors.filter(color => !selected.includes(color)).sort((a, b) => {
            const score = (color: typeof a) => Math.sqrt(color.weight) * Math.min(...selected.map(other =>
                color.rgb.reduce((sum, value, i) => sum + (value - other.rgb[i]) ** 2, 0)));
            return score(b) - score(a);
        })[0];
        selected.push(candidate ?? selected[0]);
    }
    return selected.map(color => `#${color.rgb.map(value => value.toString(16).padStart(2, "0")).join("")}`) as Palette;
}

export function useImagePalette(src: string): CSSProperties {
    const [result, setResult] = useState<{ src: string; colors: Palette } | null>(null);
    useEffect(() => {
        if (!src) return;
        const cached = cache.get(src);
        if (cached) { setResult({ src, colors: cached }); return; }
        let cancelled = false;
        const image = new Image();
        let usingProxy = false;
        const retryThroughApp = () => {
            if (cancelled || usingProxy) return;
            const url = new URL(src, window.location.href);
            if (url.origin === window.location.origin || url.protocol !== "https:") return;
            usingProxy = true;
            image.src = `/api/image-palette-source?url=${encodeURIComponent(url.href)}`;
        };
        image.crossOrigin = "anonymous";
        image.onload = () => {
            if (cancelled) return;
            try {
                const colors = samplePalette(image);
                if (!colors) return;
                if (cache.size >= 32) cache.delete(cache.keys().next().value!);
                cache.set(src, colors);
                setResult({ src, colors });
            } catch {
                retryThroughApp();
            }
        };
        image.onerror = retryThroughApp;
        image.src = src;
        return () => { cancelled = true; image.onload = image.onerror = null; };
    }, [src]);
    const colors = result?.src === src ? result.colors : cache.get(src);
    return colors ? {
        "--playlist-accent-1": colors[0],
        "--playlist-accent-2": colors[1],
        "--playlist-accent-3": colors[2],
    } as CSSProperties : {};
}
