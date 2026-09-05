import sq from "./sq.json";
import ar from "./ar.json";
import bg from "./bg.json";
import zh from "./zh.json";
import hr from "./hr.json";
import cs from "./cs.json";
import da from "./da.json";
import nl from "./nl.json";
import en from "./en.json";
import et from "./et.json";
import fi from "./fi.json";
import fr from "./fr.json";
import de from "./de.json";
import el from "./el.json";
import he from "./he.json";
import hi from "./hi.json";
import hu from "./hu.json";
import is from "./is.json";
import id from "./id.json";
import it from "./it.json";
import ja from "./ja.json";
import ko from "./ko.json";
import lv from "./lv.json";
import lt from "./lt.json";
import mk from "./mk.json";
import nb from "./nb.json";
import fa from "./fa.json";
import pl from "./pl.json";
import pt from "./pt.json";
import ro from "./ro.json";
import ru from "./ru.json";
import sr from "./sr.json";
import sk from "./sk.json";
import sl from "./sl.json";
import es from "./es.json";
import sv from "./sv.json";
import th from "./th.json";
import tr from "./tr.json";
import uk from "./uk.json";
import vi from "./vi.json";

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

export const catalogues = { sq, ar, bg, zh, hr, cs, da, nl, en, et, fi, fr, de, el, he, hi, hu, is, id, it, ja, ko, lv, lt, mk, nb, fa, pl, pt, ro, ru, sr, sk, sl, es, sv, th, tr, uk, vi } satisfies Record<Locale, Record<keyof typeof en, unknown>>;
