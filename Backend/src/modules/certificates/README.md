# Certificate templates

Base path: `/api/certificates/certificate-templates`. Every route requires an active user's Bearer access token and the `certificates.moderate` permission (**Certificate Moderation**, group **Certificates**), including list/detail reads and PDF previews. Missing authentication returns `401`; missing or denied permission returns `403` with `requiredPermission: "certificates.moderate"`. Reads include the user's private templates and all system templates. Other users' private templates remain inaccessible; clients cannot supply an owner or change system/default flags.

Migration `1792713600003_add-certificate-moderation-permission.sql` grants this permission to Administrator, Uploader and Owner roles. Other roles can receive it through the existing role-management API. The existing Owner permission bypass applies. The permission does not bypass template ownership or allow changes to system templates.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/` | `201 { success: true, template }` |
| GET | `/` | `200 { success: true, templates, pagination, sorting }` |
| GET | `/:id` | `200 { success: true, template }` |
| PATCH | `/:id` | `200 { success: true, template }` |
| DELETE | `/:id` | `200 { success: true, deleted: true }` |
| POST | `/:id/preview/pdf` | `200 application/pdf` (inline binary preview) |

## System and private templates

Migration `1792713600000_add-system-certificate-templates.sql` adds `is_system` and `is_default` (both default to `false`) and makes `user_id` nullable. A database check requires system templates to have `user_id = NULL` and private templates to have a non-null owner. Only system templates can be defaults. A partial unique index permits at most one `is_default = true` row globally.

The migration inserts **Classic**, the supplied blue geometric certificate design, in **Letter / landscape** format with `is_system: true`, `is_default: true`, and ID `b2a08625-4827-4e8a-9cde-d22f30b929ce`. Existing templates keep their owners and become private/non-default. Additional non-default system templates can be added by future migrations without a separate CRUD API. Changing the global default requires clearing the old flag and setting the new flag in the same database transaction.

List, detail and preview routes expose system templates to users with Certificate Moderation permission. List filters and pagination apply to the combined accessible set, using the existing sorting rules. Responses include `is_system` and `is_default` so clients can identify the global default and disable editing controls. POST always creates a private/non-default template. PATCH and DELETE operate only on the current user's private templates; attempting either on a system template returns `404`. Supplying `user_id`, `is_system` or `is_default` in a create/update request returns `400`.

Rollback removes system templates before restoring the original owner-required schema, and preserves private templates.

Migration `1792713600001_add-minimal-certificate-template.sql` adds **Minimal**, using the supplied minimal design in **Letter / landscape**, with ID `a7e155eb-2c60-4fe0-9533-521eab6cc579`, `is_system: true`, and `is_default: false`. Classic remains the global default. Rolling back this migration removes only Minimal.

Migration `1792713600002_add-modern-certificate-template.sql` adds **Modern**, using the supplied design in **Letter / landscape**, with ID `d6d99b35-407b-4d93-a63b-d485131da43f`, `is_system: true`, and `is_default: false`. Classic remains the global default. Rolling back this migration removes only Modern.

Create body:

```json
{
  "name": "Course completion",
  "description": null,
  "html_template": "<section class=\"certificate\"><h1>{{user.full_name}}</h1></section>",
  "css_template": ".certificate { display: grid; place-items: center; background: linear-gradient(#fff, #eee); }",
  "page_format": "A4",
  "orientation": "landscape"
}
```

`name` and `html_template` are required. Defaults: `description: null`, `css_template: ""`, `page_format: "A4"`, `orientation: "landscape"`. Name is trimmed and limited to 255 characters. HTML/CSS source is preserved exactly. Placeholders remain unchanged in storage and are populated only when previewing.

PATCH accepts one or more writable fields. Omitted fields are preserved, `description: null` clears the description, and `css_template: ""` clears CSS. Successful updates set `updated_at = now()`. Unknown fields, including `user_id`, `id` and timestamps, are rejected.

List parameters follow quizzes:

- `page`: positive integer, default `1`.
- `limit`: integer from `1` to `100`, default `20`.
- `sortBy`: `created_at` (default), `updated_at`, `name`, `page_format`, `orientation`.
- `sortOrder`: `asc` (default) or `desc`. Ties use `id ASC`.
- `name`: case-insensitive substring filter; `%`, `_`, and backslash are literal characters.
- `page_format`: `A4` or `Letter`.
- `orientation`: `portrait` or `landscape`.

Filters combine with AND. Pagination returns `page`, `limit`, `total`, `totalPages`, `hasNextPage`, and `hasPreviousPage`. Sorting returns `sortBy` and `sortOrder`. An empty page retains the total matching count.

## Content validation

`certificate-templates/helpers/templateContent.validation.js` exports `validateTemplateContent`, the shared HTML, CSS and placeholder validator used for creation, partial updates and PDF preview. Preview revalidates the stored HTML/CSS pair, page format and orientation before launching Chromium. Each source field is limited to 1 MiB to accommodate embedded fonts; HTML/CSS trees are bounded to 5,000 nodes and 64 levels of nesting. Certificate-template routes accept JSON bodies up to 3 MiB; other API routes retain their existing limits.

HTML is checked with `sanitize-html` using explicit tag and attribute allowlists. Supported elements cover certificate layout, text, tables, links, images and static inline SVG. Inline `style` attributes pass through the same CSS policy as `css_template`. Script, event handlers, iframe, object/embed, MathML, forms, style/meta elements, unknown attributes and unfinished markup are rejected. The only permitted `link` elements are Google Fonts stylesheet and preconnect links. Sanitizer removals are errors, not silently saved alterations; harmless serialization differences and class whitespace normalization do not rewrite the stored source.

CSS is parsed with `postcss`; `postcss-value-parser` inspects function values, including escaped names. The property allowlist supports Flexbox, Grid, positioning, typography, backgrounds, borders, transforms, SVG presentation properties and print layout. Allowed at-rules are `@media`, `@supports`, `@page`, `@font-face`, and top-level `@import` for Google Fonts. CSS custom properties and `var()` are supported, with their values validated. Other imports, unknown at-rules/properties/functions, `expression`, legacy bindings, unsafe URLs, malformed CSS and HTML style-element breakouts are rejected.

Resource URLs must be absolute HTTPS URLs without credentials or whitespace. Fragment links and CSS fragment references are allowed. Data URLs are permitted only for validated SVG images and base64 WOFF/WOFF2/TTF/OTF font files in `@font-face src`. HTTP, protocol-relative, relative, `javascript:`, `file:` and other data URLs are rejected. No remote resource is fetched by CRUD. External images remain blocked in PDF preview; custom fonts are loaded through the bounded server-side font loader described below.

### SVG

Inline SVG supports paths, basic shapes, groups, text/tspan/textPath, symbols/use, gradients, clipping, masks, patterns, markers and common static filter primitives (blur, offset, blend, color matrix, composite, flood, merge and morphology). SVG tag/attribute casing such as `linearGradient` and `viewBox` is retained in the rendered document. `fill`, `stroke`, typography and related presentation properties work in attributes, inline styles and `css_template`.

```html
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 100" width="500" height="100">
  <rect width="500" height="100" rx="12" fill="#f3e6b0" />
  <text x="20" y="60" font-family="CertificateTitle" font-size="32">{{user.full_name}}</text>
</svg>
```

SVG references (`use`, gradients, clip paths, masks and filters) must use local `#id` fragments. Scripts, event attributes, animation elements, `foreignObject`, SVG `image` elements and external SVG references are rejected. SVG images may also use `data:image/svg+xml,...` with percent-encoded XML or `data:image/svg+xml;base64,...` in HTML `img src` and CSS `url(...)`. Embedded SVG is limited to 100 KiB and parsed as strict XML; DOCTYPE, processing instructions and placeholders inside SVG data images are rejected. Placeholders in inline SVG text are supported.

### Custom fonts

Use `font-family` in HTML styles, SVG text or CSS rules. Define fonts in `css_template` with `@font-face`; supported formats are WOFF, WOFF2, TTF and OTF. Sources may be direct public HTTPS font-file URLs or embedded base64 font data:

```css
@font-face {
  font-family: CertificateTitle;
  src: url("https://your-public-cdn.example/fonts/title.woff2") format("woff2");
  font-weight: 400;
  font-style: normal;
}
h1, svg text { font-family: CertificateTitle, serif; }
/* Embedded alternative: src: url("data:font/woff2;base64,...") format("woff2"); */
```

Google Fonts can be included with either a stylesheet link in `html_template` or a top-level import in `css_template`:

```html
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Roboto&amp;display=swap">
<h1 style="font-family:Roboto,sans-serif">{{user.full_name}}</h1>
```

```css
@import url("https://fonts.googleapis.com/css2?family=Roboto&display=swap");
h1 { font-family: Roboto, sans-serif; }
```

Only Google Fonts `/css` and `/css2` stylesheet URLs are supported. Their responses must contain only validated `@font-face` declarations. Preconnect links to `fonts.googleapis.com` and `fonts.gstatic.com` are accepted but removed from the render document. Arbitrary stylesheet links/imports and HTML `style` elements remain unsupported; use the separate CSS field.

During PDF preview the API fetches font resources over public HTTPS on port 443, without cookies or authorization headers. Socket DNS lookup rejects private/reserved IPv4/IPv6 destinations, including mapped addresses; redirects are not followed. Chromium itself stays offline and receives font bytes only through synthetic, intercepted font URLs. Font signatures and resource sizes are checked. The renderer waits for font loading before printing; failed custom-font loads return `422` rather than silently generating a fallback-font PDF.

Per preview: up to 4 Google stylesheets (64 KiB each), 32 remote font sources, 1 MiB per font file, 4 MiB total fetched resources and a 5-second timeout per fetch, within the existing total render deadline. Only fonts actually requested by the browser are downloaded, with per-render caching. Use direct final font URLs that do not require redirects or authentication.

## Issued certificate storage

Migration `1792926000001_add-certificates.sql` creates `public.certificates`, the `certificate_status` enum (`issued`, `revoked`), `certificates_number_seq`, and `generate_certificate_number()`. Each certificate belongs to a user, quiz, and unique quiz attempt. Both `data_snapshot` and `template_snapshot` are required JSONB values. Status defaults to `issued`; `issued_at` and `created_at` default to `now()`, and `revoked_at` is initially null.

Omit `certificate_number` on INSERT to generate `CERT-2026-000001` automatically. Migration `1792926000002_certificate-number-per-year.sql` replaces the global sequence generator with atomic counters keyed by year in `certificate_number_counters`. Each new year starts at `000001` automatically, without a scheduled reset. The year comes from the current transaction's timestamp in UTC, matching `issued_at`; a transaction opened before midnight retains that year even if it commits afterward. Concurrent inserts increment the same year's counter safely. Numbers have at least six digits and grow without truncation (`1000000` after `999999`). Counter increments roll back with failed issuance, so an uncommitted number can be reused. Always let the default generate numbers during normal issuance.

The annual-counter migration preserves existing certificate numbers and initializes each year's counter from its largest stored numeric suffix (including revoked certificates). It locks certificate writes during initialization. The original sequence remains only for rollback compatibility; rolling back this migration restores the global generator above the largest existing/allocated suffix without deleting certificates.

The unique attempt constraint permits one certificate per attempt, including revoked certificates. The unique certificate-number constraint also protects explicitly supplied numbers. Deleting a template sets `certificate_template_id` to null while preserving both snapshots; user, quiz, and attempt deletion remains restricted by the foreign keys. Indexes support user issuance history and quiz/template references.

The Down migration removes the certificate table, number function, sequence, and status enum. It deletes issued-certificate records, and a subsequent Up starts a new sequence; it is intended for rolling back the feature, not resetting certificate numbering. Run `npm run test:certificates:db` with `TEST_DATABASE_URL` to exercise the migration in an isolated schema.

## Quiz certificate selection

Manual attempt submission and automatic expiration finalization call the shared `services/issueAttemptCertificate.js` service in the same database transaction as grading and the terminal status update. A certificate is inserted only for a persisted `passed=true` attempt with status `submitted` or `timed_out` whose **current quiz row** selects an existing template. Scoring and passing thresholds still use attempt settings; certificate selection, quiz title and all other quiz metadata use `quizzes`, never `settings_snapshot`. Enabling, disabling or changing the quiz's template while an attempt is active therefore affects issuance. A deleted template clears the live selection and prevents issuance.

Each issued record freezes `data_snapshot` with `user` (`id`, `full_name`), `quiz` (the current quiz row), `result` (`score_percentage`, `earned_points`, `max_points`, `passed`, `finished_at`), and `certificate` (`number`, `issued_at`). `template_snapshot` stores the complete selected template row, including HTML/CSS, paper format and orientation. Text placeholders remain in the saved template; issuance does not modify the original template or render a PDF. Later edits to users, quizzes or templates do not change these snapshots. `issued_at` is the issuance transaction time, while `result.finished_at` records the attempt's completion/deadline.

The attempt row lock and unique `quiz_attempt_id` guarantee at most one certificate per attempt. Existing certificates, including revoked ones, are never overwritten or reissued. A certificate insert failure rolls back finalization, newly graded answers and the annual counter increment; retrying can complete the operation safely. Failed attempts and quizzes without a selected template finalize normally without a certificate. The stored pass result is used even when `show_final_score=false`; existing response visibility remains unchanged. Existing terminal attempts are not backfilled. Issued-certificate listing, download and verification endpoints remain separate work.

Quiz create/PATCH accepts `certificate_template_id` as a UUID or `null`; it replaces the removed `has_certificate` flag. Omission on create defaults to `null`; omission on PATCH preserves the current selection without rechecking template access, and explicit `null` removes it. A supplied non-null ID enables certificates and must identify a system template or a private template belonging to the authenticated user making the request. A user authorized to edit another user's quiz can therefore assign their own private template, but cannot select the quiz owner's or a third user's private template. `updateQuizInternal` takes separate `resourceOwnerId` and `authenticatedUserId` arguments: the former scopes the quiz update, while the latter scopes template selection. Quiz ownership and edit permissions remain unchanged. Missing/inaccessible templates return `422`; malformed UUIDs or the legacy boolean field return `400`. Quiz create/detail/list/update responses include `certificate_template_id`.

Migration `1792926000000_quiz-certificate-template.sql` preserves already configured IDs, leaves legacy quizzes without a selected template at `null` (including those with `has_certificate=true`), removes the boolean column, and sets the foreign key to `ON DELETE SET NULL`. Deleting a template clears its selection on affected quizzes. Rollback derives the restored boolean from whether an ID is selected; discarded legacy boolean values cannot be reconstructed.

New attempts copy `certificate_template_id` into `settings_snapshot` instead of `has_certificate`. Resuming an attempt preserves that snapshot even if the quiz selection changes or the template is deleted. Historical attempts are not rewritten; a saved template ID does not retain the deleted template's HTML/CSS.

Attempt snapshots retain their original template ID for historical context but do not determine issuance. Issuance resolves the current quiz's selected template internally without filtering by the quiz owner's or participant's ownership, so an editor's assigned private template works. This does not grant those users direct access to private template CRUD/preview routes. PDF rendering itself operates on supplied template content and has no owner restriction; the existing preview endpoint still checks the requesting user's access.

## PDF preview

`POST /api/certificates/certificate-templates/:id/preview/pdf` requires the same Bearer token as CRUD and selects either a system template or the user's own private template. A missing template or another user's private template returns `404`. The request body is not used: source, format and orientation come from the database, and placeholder values are fixed server-side. No template is changed, no certificate record is created, and no PDF is written to the database, storage, or an output file.

Supported text placeholders use `{{key}}` (optional surrounding whitespace), only in HTML text:

| Placeholder | Preview value |
| --- | --- |
| `user.full_name` | John Anderson |
| `quiz.title` | Workplace Health and Safety Fundamentals |
| `result.score_percentage` | 95 |
| `result.earned_points` | 19 |
| `result.max_points` | 20 |
| `certificate.number` | CERT-2026-000001 |
| `certificate.issued_at` | October 23, 2026 |

The additional `{{certificate.qr_code_data_uri}}` placeholder is allowed **only as the entire `src` value of an HTML `<img>`**. It is rejected in text, SVG, other attributes, CSS, and URLs with a prefix/suffix. For example:

```html
<img src="{{certificate.qr_code_data_uri}}" class="qr-code" alt="QR verifikacija" />
```

```css
.qr-code { position: absolute; right: 24px; bottom: 32px; width: 96px; height: 96px; }
```

Set `FRONTEND_BASE_URL=https://videoplatform.optiflowz.com` on the backend. QR preview encodes `https://videoplatform.optiflowz.com/certificates/verify/preview` (a test verification URL, not an issued certificate). A path prefix in the configured base URL is retained; query/fragment are removed. This change does not create a frontend verification page. Missing/invalid configuration returns `500` only for previews containing the QR placeholder.

QR styling parameters can be appended with dots as separators. The original parameter-free placeholder remains supported:

```html
<img src="{{certificate.qr_code_data_uri.size_200.color_ff6937.dots_rounded.background_ffffff}}" class="qr-code" alt="QR verifikacija" />
<img src="{{certificate.qr_code_data_uri.size_300.dots_classy-rounded.corners_extra-rounded.cornerdots_dot.gradient_linear_002244_663300_45.ecc_H}}" class="qr-code" alt="QR verifikacija" />
```

Each parameter uses `name_value`. Order does not matter; names are lowercase, hex colors may use either case. Whitespace is allowed around the complete placeholder key, not between parameters. All styling remains subject to the `img src` context restriction above.

| Parameter | Accepted values / default | Library mapping |
| --- | --- | --- |
| `size_200` | Integer 128–1024; default 512 | `width` and `height` in pixels |
| `color_ff6937` | Six hex digits, no `#`; default `000000` | `dotsOptions.color` |
| `background_ffffff` | Six hex digits; default `ffffff` | `backgroundOptions.color` |
| `dots_rounded` | `square`, `dots`, `rounded`, `extra-rounded`, `classy`, `classy-rounded`; default `square` | `dotsOptions.type` |
| `corners_extra-rounded` | Dot styles above plus `dot`; default `square` | `cornersSquareOptions.type` |
| `cornerdots_dot` | Dot styles above plus `dot`; default `square` | `cornersDotOptions.type` |
| `cornercolor_102030` | Six hex digits; inherits dots color/gradient by default | `cornersSquareOptions.color` |
| `cornerdotcolor_203040` | Six hex digits; inherits dots color/gradient by default | `cornersDotOptions.color` |
| `gradient_linear_002244_663300_45` | `linear` or `radial`, two hex colors, optional integer angle 0–360 degrees (default 0) | `dotsOptions.gradient` |
| `backgroundgradient_linear_eeeeee_ffffff` | Same gradient syntax | `backgroundOptions.gradient` |
| `cornergradient_radial_001122_334455` | Same gradient syntax | `cornersSquareOptions.gradient` |
| `cornerdotgradient_linear_110022_442266_90` | Same gradient syntax | `cornersDotOptions.gradient` |
| `margin_4` | Integer 4–16 **QR modules**; default 4 | `margin`, converted to pixels for the actual encoded URL |
| `ecc_H` | `M`, `Q`, `H` (case insensitive); default `Q` | `qrOptions.errorCorrectionLevel` |

Gradients use stops at 0 and 1; degrees are converted to radians. A solid color and gradient for the same component cannot be combined. Unknown or duplicate options, invalid values, transparent/inverted colors, and insufficient contrast return `422` during create/PATCH/preview validation. The darkest background color must have at least 2:1 contrast against every foreground/corner color. Arbitrary library configuration, logos, external image URLs, output-format changes, and data overrides are not accepted as parameters.

`helpers/certificateQrCode.js` exports `generateCertificateQrCode(verificationUrl, key?)` for preview and future issuance; `key` is the full key without braces. `helpers/certificateQrOptions.js` provides the shared allowlisted parser. The generator uses `qr-code-styling` with an isolated JSDOM for SVG, then the existing `sharp` dependency for PNG. No `canvas` installation or Docker system-library change is required. The output remains a PNG Base64 Data URI. The original `qrcode` dependency is retained for the separate authentication/2FA flow.

The quiet zone is at least four modules, and the chosen size must fit at least three pixels per module for the actual URL; otherwise rendering returns `422`. Every generated PNG is decoded with `jsqr` and must reproduce the exact verification URL before it can enter the PDF. This checks the generated image; CSS resizing, printing quality, and scanner conditions still affect real-world readability. CSS continues to control displayed position and dimensions.

Each render supports up to eight distinct QR configurations, caches equivalent configurations within that render, and enforces the existing 3 MiB document budget after substitution. JSDOM windows are closed after generation. The verification URL is not fetched, and the original `html_template` in the database is never changed. User-authored PNG data URLs remain subject to the existing resource restrictions.

Unknown names, expressions, malformed/triple braces and placeholders in other attributes or CSS return `422`. This policy also applies to create/PATCH; older stored templates with unsupported placeholders must be updated before previewing. Text values are HTML-escaped. The render-only fragment is normalized and balanced before inserting it into `<div class="certificate">`, preventing stray closing tags from escaping the wrapper. The stored HTML remains unchanged.

`postcss-prefix-selector` scopes each CSS rule's subject to the wrapper or its descendants, including rules inside media/supports blocks. The renderer supplies page dimensions from `page_format` and `orientation`, prints backgrounds and uses zero margins. Preview is one page; content beyond the fixed certificate canvas is clipped. User CSS cannot select elements outside the wrapper. `@page`/`@font-face` remain document-level at-rules inside the isolated document; PDF format is controlled by Playwright's format/orientation options rather than CSS page sizing.

Each preview launches a fresh Playwright Chromium browser with `chromiumSandbox: true` and a fresh context. Page JavaScript, service workers and downloads are disabled. The context is offline; all browser requests are blocked except synthetic font URLs fulfilled by the font loader. WebSockets are blocked. CSP permits inline styles, embedded SVG images, generated QR PNGs and embedded/intercepted fonts. Chromium inherits only a small environment allowlist, excluding API secrets. Resource requests are aborted and the browser process tree is killed on completion, error, deadline or client disconnect.

Resource budgets per API process: one active render (no queue), 20-second total render deadline, 10-second launch timeout, 3 MiB generated-document limit, 5 MiB output limit and one PDF page. Each user is limited to 10 preview requests per minute. Chromium also receives a renderer-process limit and a 128 MiB V8 heap setting; these are not hard limits on Chromium's total native memory. Deployment memory/CPU limits remain necessary (the existing Fly app VM is limited to 1 GiB and one CPU).

Success returns `Content-Type: application/pdf`, an inline UUID-based filename, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Busy renderer: `503` with `Retry-After`; deadline: `504`; rate limit: `429`. Invalid stored content returns `422` before a browser is launched.

For local setup, run `npx playwright install chromium`. Set `CERTIFICATE_CHROMIUM_EXECUTABLE_PATH` to use a custom binary; otherwise the renderer uses `PUPPETEER_EXECUTABLE_PATH` when configured, then Playwright's installed Chromium. The Docker image installs Chromium and its sandbox and runs as the non-root `node` user. Linux hosts must permit Chromium's sandbox; the renderer does not fall back to `--no-sandbox`.

Errors use `{ success: false, message }`: `400` for invalid request shape/query/ID, `401` for authentication failure, `404` for missing or another user's template. Disallowed content and CSS syntax errors return `422` with a descriptive `message` and `field` (`html_template` or `css_template`). Unexpected failures return a generic `500` message.

Run `npm run test:certificate-templates`. The PostgreSQL integration test uses session-local temporary tables and requires `TEST_DATABASE_URL`; without it, that test is skipped.

Run `npm run test:certificate-preview` for placeholder/document/HTTP tests, SVG/font validation, font-loader network policy, renderer lifecycle tests, and real Chromium PDF tests. Real-browser tests are skipped when Chromium is not installed. They check all A4/Letter orientations, one-page output, SVG rendering, embedded fonts in PDFs, denied browser requests, and CSS/HTML containment.
