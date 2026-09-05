import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { SUPPORTED_LOCALES, type Locale, type TranslationParams as Params } from "~/locales";
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
  if (typeof window === "undefined") return activeLocale;
  return normalizeLocale(localStorage.getItem(STORAGE_KEY) || navigator.language);
}

export function getCurrentLocale(): Locale {
  if (typeof window !== "undefined") activeLocale = readStoredLocale();
  return activeLocale;
}

export function setCurrentLocaleValue(locale: Locale) {
  activeLocale = locale;
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, locale);
  document.documentElement.lang = locale;
  // Keep navigation, tables, charts and media controls in the platform's layout.
  // RTL text uses paragraph-level bidi detection without mirroring containers.
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
  const [locale, setLocaleState] = useState<Locale>(() => readStoredLocale());

  useEffect(() => {
    setCurrentLocaleValue(locale);
  }, [locale]);

  const value = useMemo<I18nContextType>(
    () => ({
      locale,
      setLocale: (nextLocale) => {
        setCurrentLocaleValue(nextLocale);
        setLocaleState(nextLocale);
      },
      t: (key, params) => {
        return formatTranslation(locale, key, params);
      },
    }),
    [locale]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  return useContext(I18nContext);
}
