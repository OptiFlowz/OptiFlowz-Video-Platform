import en from "./en.json";

export const SUPPORTED_LOCALES = ["sq", "ar", "bg", "zh", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "he", "hi", "hu", "is", "id", "it", "ja", "ko", "lv", "lt", "mk", "nb", "fa", "pl", "pt", "ro", "ru", "sr", "sk", "sl", "es", "sv", "th", "tr", "uk", "vi"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const LANGUAGE_OPTIONS: { value: Locale; label: string }[] = [
  { value: "sq", label: "Albanian" },
  { value: "ar", label: "Arabic" },
  { value: "bg", label: "Bulgarian" },
  { value: "zh", label: "Chinese (Simplified)" },
  { value: "hr", label: "Croatian" },
  { value: "cs", label: "Czech" },
  { value: "da", label: "Danish" },
  { value: "nl", label: "Dutch" },
  { value: "en", label: "English" },
  { value: "et", label: "Estonian" },
  { value: "fi", label: "Finnish" },
  { value: "fr", label: "French" },
  { value: "de", label: "German" },
  { value: "el", label: "Greek" },
  { value: "he", label: "Hebrew" },
  { value: "hi", label: "Hindi" },
  { value: "hu", label: "Hungarian" },
  { value: "is", label: "Icelandic" },
  { value: "id", label: "Indonesian" },
  { value: "it", label: "Italian" },
  { value: "ja", label: "Japanese" },
  { value: "ko", label: "Korean" },
  { value: "lv", label: "Latvian" },
  { value: "lt", label: "Lithuanian" },
  { value: "mk", label: "Macedonian" },
  { value: "nb", label: "Norwegian" },
  { value: "fa", label: "Persian" },
  { value: "pl", label: "Polish" },
  { value: "pt", label: "Portuguese" },
  { value: "ro", label: "Romanian" },
  { value: "ru", label: "Russian" },
  { value: "sr", label: "Serbian" },
  { value: "sk", label: "Slovak" },
  { value: "sl", label: "Slovenian" },
  { value: "es", label: "Spanish" },
  { value: "sv", label: "Swedish" },
  { value: "th", label: "Thai" },
  { value: "tr", label: "Turkish" },
  { value: "uk", label: "Ukrainian" },
  { value: "vi", label: "Vietnamese" },
];

export type TranslationParams = Record<string, string | number> | undefined;
export type TranslationEntry = string | {
  select: string;
  rule: "exactOne" | "cardinal";
  one: string;
  other: string;
  few?: string;
  many?: string;
  two?: string;
  zero?: string;
};

// Non-English catalogues may omit newer messages; formatTranslation falls back to English.
// Validate message shapes without requiring duplicated English placeholders.
// JSON imports widen literal strings, including the plural rule discriminator.
type CatalogueEntry = string | (Omit<Exclude<TranslationEntry, string>, "rule"> & { rule: string });
type Catalogue = Partial<Record<keyof typeof en, CatalogueEntry>>;

// Only English is part of the initial bundle. Each other language is a separate chunk.
export const catalogues: Partial<Record<Locale, Catalogue>> & { en: Catalogue } = { en };
const loaders = {
  ar: () => import("./ar.json"),
  bg: () => import("./bg.json"),
  cs: () => import("./cs.json"),
  da: () => import("./da.json"),
  de: () => import("./de.json"),
  el: () => import("./el.json"),
  es: () => import("./es.json"),
  et: () => import("./et.json"),
  fa: () => import("./fa.json"),
  fi: () => import("./fi.json"),
  fr: () => import("./fr.json"),
  he: () => import("./he.json"),
  hi: () => import("./hi.json"),
  hr: () => import("./hr.json"),
  hu: () => import("./hu.json"),
  id: () => import("./id.json"),
  is: () => import("./is.json"),
  it: () => import("./it.json"),
  ja: () => import("./ja.json"),
  ko: () => import("./ko.json"),
  lt: () => import("./lt.json"),
  lv: () => import("./lv.json"),
  mk: () => import("./mk.json"),
  nb: () => import("./nb.json"),
  nl: () => import("./nl.json"),
  pl: () => import("./pl.json"),
  pt: () => import("./pt.json"),
  ro: () => import("./ro.json"),
  ru: () => import("./ru.json"),
  sk: () => import("./sk.json"),
  sl: () => import("./sl.json"),
  sq: () => import("./sq.json"),
  sr: () => import("./sr.json"),
  sv: () => import("./sv.json"),
  th: () => import("./th.json"),
  tr: () => import("./tr.json"),
  uk: () => import("./uk.json"),
  vi: () => import("./vi.json"),
  zh: () => import("./zh.json"),
} satisfies Record<Exclude<Locale, "en">, () => Promise<{ default: Catalogue }>>;
const pending = new Map<Locale, Promise<void>>();

export function loadCatalogue(locale: Locale): Promise<void> {
  if (catalogues[locale]) return Promise.resolve();
  const existing = pending.get(locale);
  if (existing) return existing;
  const request = loaders[locale as Exclude<Locale, "en">]().then(module => {
    catalogues[locale] = module.default;
  }).finally(() => {
    // Failed downloads can be retried, and successful catalogues remain cached.
    pending.delete(locale);
  });
  pending.set(locale, request);
  return request;
}
