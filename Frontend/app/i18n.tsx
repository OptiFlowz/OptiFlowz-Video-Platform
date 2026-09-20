import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { loadCatalogue, SUPPORTED_LOCALES, type Locale, type TranslationParams as Params } from "~/locales";
import { useHydrated } from "~/hooks/useHydrated";
import { formatTranslation, hasTranslation } from "~/locales/formatTranslation";

export { SUPPORTED_LOCALES, LANGUAGE_OPTIONS, type Locale } from "~/locales";
export type TranslationKey = string;
const STORAGE_KEY = "platformLanguage";

let activeLocale: Locale = "en";

export function normalizeLocale(value?: string | null): Locale {
  if (!value) return "en";
  const language = value.toLowerCase().split("-")[0];
  const short = (language === "no" ? "nb" : language) as Locale;
  return SUPPORTED_LOCALES.includes(short) ? short : "en";
}

function readStoredLocale(): Locale {
  if (typeof window === "undefined") return "en";
  try {
    return normalizeLocale(localStorage.getItem(STORAGE_KEY) || navigator.language);
  } catch {
    return normalizeLocale(navigator.language);
  }
}

export function getCurrentLocale(): Locale {
  // Formatting follows the loaded catalogue, including while another language downloads.
  return typeof window === "undefined" ? "en" : activeLocale;
}

export function setCurrentLocaleValue(locale: Locale, persist = true) {
  if (typeof window === "undefined") return;
  activeLocale = locale;
  if (persist) {
    try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* Language still works without storage. */ }
  }
  document.documentElement.lang = locale;
  // RTL text uses paragraph-level bidi detection without mirroring the interface.
  document.documentElement.dir = "ltr";
}

export function translate(key: TranslationKey, params?: Params) {
  const locale = getCurrentLocale();
  return formatTranslation(locale, key, params);
}

export function translateContentTitle(value?: string | null) {
  const title = value ?? "";
  const normalized = title.trim().toLowerCase();
  if (!normalized) return title;

  const key = `content.${normalized}`;
  return hasTranslation(key) ? formatTranslation(getCurrentLocale(), key) : title;
}

type I18nContextType = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: TranslationKey, params?: Params) => string;
};

const I18nContext = createContext<I18nContextType>({
  locale: "en",
  setLocale: () => {
    throw new Error("setLocale called outside I18nProvider");
  },
  t: translate,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const hydrated = useHydrated();
  const [locale, setLocaleState] = useState<Locale>(() => hydrated ? activeLocale : "en");
  const requestVersion = useRef(0);
  const mounted = useRef(false);

  const selectLocale = useCallback(async (nextLocale: Locale, persist = true) => {
    const version = ++requestVersion.current;
    try {
      await loadCatalogue(nextLocale);
      if (!mounted.current || version !== requestVersion.current) return;
      setCurrentLocaleValue(nextLocale, persist);
      setLocaleState(nextLocale);
    } catch {
      // Keep the current complete language on a failed download; selecting again retries.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void selectLocale(readStoredLocale(), false);
    const syncStoredLocale = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY && event.key !== null) return;
      try { if (event.storageArea !== localStorage) return; } catch { return; }
      void selectLocale(readStoredLocale(), false);
    };
    window.addEventListener("storage", syncStoredLocale);
    return () => {
      mounted.current = false;
      requestVersion.current++;
      window.removeEventListener("storage", syncStoredLocale);
    };
  }, [selectLocale]);

  const value = useMemo<I18nContextType>(() => ({
    locale,
    setLocale: nextLocale => { void selectLocale(nextLocale); },
    t: (key, params) => formatTranslation(locale, key, params),
  }), [locale, selectLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
