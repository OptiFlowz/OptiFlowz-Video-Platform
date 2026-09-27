// Pixel sampling needs a same-origin response when storage does not expose CORS.
// Restrict this endpoint to public image hosts; never proxy arbitrary URLs.
const storageBase = process.env.R2_PUBLIC_BASE_URL || "https://template.optiflowzstorage.com";
const maxBytes = 5 * 1024 * 1024;

export async function GET(request: Request) {
    let source: URL;
    try {
        source = new URL(new URL(request.url).searchParams.get("url") || "");
        const storage = new URL(storageBase);
        const storagePath = `${storage.pathname.replace(/\/$/, "")}/`;
        const allowedStorage = source.origin === storage.origin && source.pathname.startsWith(storagePath);
        const allowedMux = source.origin === "https://image.mux.com";
        if (source.protocol !== "https:" || source.username || source.password || (!allowedStorage && !allowedMux)) {
            return new Response(null, { status: 400 });
        }
    } catch {
        return new Response(null, { status: 400 });
    }

    try {
        const response = await fetch(source, {
            redirect: "error",
            signal: AbortSignal.timeout(8000),
            cache: "no-store",
        });
        const contentType = response.headers.get("content-type")?.split(";")[0].trim();
        if (!response.ok || !response.body || !contentType || !["image/jpeg", "image/png", "image/webp", "image/avif", "image/gif"].includes(contentType)) {
            await response.body?.cancel();
            return new Response(null, { status: 502 });
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > maxBytes) {
                await reader.cancel();
                return new Response(null, { status: 413 });
            }
            chunks.push(value);
        }
        const image = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { image.set(chunk, offset); offset += chunk.byteLength; }
        return new Response(image, {
            headers: {
                "Content-Type": contentType,
                "X-Content-Type-Options": "nosniff",
                "Cache-Control": "public, max-age=86400, s-maxage=604800",
            },
        });
    } catch {
        return new Response(null, { status: 502 });
    }
}
