# Interface translations

Each of the 40 supported languages has one JSON catalogue named after its locale code. These files are the source of truth for all interface text, including account, platform administration, analytics, quizzes, privacy, and the predefined content titles.

- `index.ts` registers the catalogues and English language names in alphabetical order.
- `formatTranslation.ts` resolves parameters, branding, and count variants.
- `../i18n.tsx` provides the existing React hook, language persistence, and document language/direction.

Add a new translation key to every catalogue. English is the fallback catalogue, and TypeScript checks that the other catalogues include its keys. Keep parameter names unchanged across languages.

```json
{
  "usersName": "Name",
  "usersPage": "Page {{param.page}} of {{param.total}}",
  "footerPoweredBy": "Powered by {{brand.POWERED_BY_NAME}}",
  "replyCountLabel": {
    "select": "count",
    "rule": "cardinal",
    "one": "{{param.count}} reply",
    "other": "{{param.count}} replies"
  }
}
```

`cardinal` uses the language's `Intl.PluralRules` categories (`zero`, `one`, `two`, `few`, `many`, `other`). Always provide `one` and `other`; additional categories are optional. Existing messages using an explicit numeric `count === 1` condition retain `rule: "exactOne"` to preserve their behavior.

Brand placeholders support `BRAND_NAME`, `PLATFORM_NAME`, and `POWERED_BY_NAME`. Parameters are inserted literally in one pass. Missing `param` values become empty strings; the legacy `rawParam` placeholder retains direct interpolation behavior for existing messages.

Keys prefixed with `content.` translate predefined content titles. User-entered titles and custom role names are not translation keys.

The page layout remains left-to-right for every locale. Arabic (`ar`), Hebrew (`he`), and Persian (`fa`) use paragraph-level bidirectional text detection in `app.css`, so text can read right-to-left without mirroring navigation, tables, or media controls. Norwegian uses Bokmål (`nb`); the browser locale `no` maps to `nb`. Chinese (`zh`) uses Simplified Chinese.
