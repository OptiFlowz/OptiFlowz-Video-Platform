export function logEvent(event, data = {}, level = "info") {
  try {
    const ts = new Date().toISOString();

    // bezbedno “skraćivanje” da ne pukne na ogromnim objektima
    const safe = (v) => {
      if (v == null) return v;
      if (typeof v === "string") return v.length > 500 ? v.slice(0, 500) + "…" : v;
      return v;
    };

    const payload = {
      //ts,
      //event,
      ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, safe(v)])),
    };

    // jedna linija, lako se grepuje u logovima
    //const line = `[${payload.ts}] ${payload.event} ${JSON.stringify(payload)}`;
    const line = `${event} ${JSON.stringify(payload)}`;
    if (level === "warn") console.warn(line);
    else if (level === "error") console.error(line);
    else console.log(line);
  } catch (e) {
    console.error("[logEvent] failed", e);
  }
}