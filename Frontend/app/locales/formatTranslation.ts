import { BRAND_NAME, PLATFORM_NAME, POWERED_BY_NAME } from "~/changeables";
import { catalogues, type Locale, type TranslationEntry, type TranslationParams } from "./index";

const messages = catalogues as Record<Locale, Record<string, TranslationEntry>>;
const brandValues: Record<string, string> = { BRAND_NAME, PLATFORM_NAME, POWERED_BY_NAME };
const pluralRules = new Map<Locale, Intl.PluralRules>();

export function hasTranslation(key: string): boolean {
  return Object.hasOwn(messages.en, key);
}

export function formatTranslation(locale: Locale, key: string, params?: TranslationParams): string {
  const entry = messages[locale][key] ?? messages.en[key];
  if (entry === undefined) return key;

  let template: string;
  if (typeof entry === "string") {
    template = entry;
  } else {
    const count = params?.[entry.select];
    if (entry.rule === "exactOne") {
      template = Number(count) === 1 ? entry.one : entry.other;
    } else {
      let rules = pluralRules.get(locale);
      if (!rules) {
        rules = new Intl.PluralRules(locale);
        pluralRules.set(locale, rules);
      }
      const numeric = typeof count === "number" ? count : Number((count ?? "").replace(/[\s\u00a0\u202f]/g, "").replace(",", "."));
      const category = Number.isFinite(numeric) ? rules.select(numeric) : "other";
      template = entry[category] ?? entry.other;
    }
  }

  // A single replacement pass keeps user-supplied values out of template parsing.
  return template.replace(/\{\{(brand|param|rawParam)\.([\w]+)\}\}/g, (_, kind: string, name: string) => {
    if (kind === "brand") return brandValues[name] ?? "";
    if (kind === "rawParam") return String(params?.[name]);
    return String(params?.[name] ?? "");
  });
}
