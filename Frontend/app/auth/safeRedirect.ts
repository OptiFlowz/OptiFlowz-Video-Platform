/** Only root-relative application paths are accepted, never URL schemes or hosts. */
export function safeRedirect(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u0020\u007f]/.test(value)) return fallback;
  try {
    // Reject encoded separators/control characters as well as their literal forms.
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback;
    const parsed = new URL(value, "https://app.invalid");
    if (parsed.origin !== "https://app.invalid" || decodeURIComponent(parsed.pathname).startsWith("//")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return fallback; }
}
