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

`certificate-templates/helpers/templateContent.validation.js` exports `validateTemplateContent`, the shared HTML, CSS and placeholder validator used for creation, partial updates and PDF preview. Preview revalidates the stored HTML/CSS pair, page format and orientation before launching Chromium. Each source field is limited to 100 KiB; HTML/CSS trees are bounded to 5,000 nodes and 64 levels of nesting.

HTML is checked with `sanitize-html` using explicit tag and attribute allowlists. Supported elements cover certificate layout, text, tables, links and images. Inline `style` attributes pass through the same CSS policy as `css_template`. Script, event handlers, iframe, object/embed, SVG, MathML, forms, style/link/meta elements, unknown attributes and unfinished markup are rejected. Sanitizer removals are errors, not silently saved alterations; harmless serialization differences and class whitespace normalization do not rewrite the stored source.

CSS is parsed with `postcss`; `postcss-value-parser` inspects function values, including escaped names. The property allowlist supports Flexbox, Grid, positioning, typography, backgrounds, borders, transforms and print layout. Allowed at-rules are `@media`, `@supports`, `@page`, and `@font-face`. CSS custom properties and `var()` are supported, with their values validated. Imports, unknown at-rules/properties/functions, `expression`, legacy bindings, unsafe URLs, malformed CSS and HTML style-element breakouts are rejected.

Resource URLs must be absolute HTTPS URLs without credentials or whitespace. Fragment links and CSS fragment references are allowed. HTTP, protocol-relative, relative, `data:`, `javascript:`, and `file:` URLs are rejected. No remote resource is fetched by CRUD. PDF preview denies all network requests, so external images and web fonts are not loaded; local fonts, CSS backgrounds and layout still render.

## PDF preview

`POST /api/certificates/certificate-templates/:id/preview/pdf` requires the same Bearer token as CRUD and selects either a system template or the user's own private template. A missing template or another user's private template returns `404`. The request body is not used: source, format and orientation come from the database, and placeholder values are fixed server-side. No template is changed, no certificate record is created, and no PDF is written to the database, storage, or an output file.

Supported placeholders use `{{key}}` (optional surrounding whitespace), only in HTML text:

| Placeholder | Preview value |
| --- | --- |
| `user.full_name` | John Anderson |
| `quiz.title` | Workplace Health and Safety Fundamentals |
| `result.score_percentage` | 95 |
| `result.earned_points` | 19 |
| `result.max_points` | 20 |
| `certificate.number` | CERT-2026-000001 |
| `certificate.issued_at` | October 23, 2026 |

Unknown names, expressions, malformed/triple braces and placeholders in attributes or CSS return `422`. This policy also applies to create/PATCH; older stored templates with unsupported placeholders must be updated before previewing. Values are HTML-escaped. The render-only fragment is normalized and balanced before inserting it into `<div class="certificate">`, preventing stray closing tags from escaping the wrapper. The stored HTML remains unchanged.

`postcss-prefix-selector` scopes each CSS rule's subject to the wrapper or its descendants, including rules inside media/supports blocks. The renderer supplies page dimensions from `page_format` and `orientation`, prints backgrounds and uses zero margins. Preview is one page; content beyond the fixed certificate canvas is clipped. User CSS cannot select elements outside the wrapper. `@page`/`@font-face` remain document-level at-rules inside the isolated document; PDF format is controlled by Playwright's format/orientation options rather than CSS page sizing.

Each preview launches a fresh Playwright Chromium browser with `chromiumSandbox: true` and a fresh context. Page JavaScript, service workers and downloads are disabled. The context is offline; HTTP and WebSocket routes are blocked, and the generated document has a restrictive CSP. Chromium inherits only a small environment allowlist, excluding API secrets. The browser process tree is killed on completion, error, deadline or client disconnect.

Resource budgets per API process: one active render (no queue), 20-second total render deadline, 10-second launch timeout, 512 KiB generated-document limit, 5 MiB output limit and one PDF page. Each user is limited to 10 preview requests per minute. Chromium also receives a renderer-process limit and a 128 MiB V8 heap setting; these are not hard limits on Chromium's total native memory. Deployment memory/CPU limits remain necessary (the existing Fly app VM is limited to 1 GiB and one CPU).

Success returns `Content-Type: application/pdf`, an inline UUID-based filename, `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`. Busy renderer: `503` with `Retry-After`; deadline: `504`; rate limit: `429`. Invalid stored content returns `422` before a browser is launched.

For local setup, run `npx playwright install chromium`. Set `CERTIFICATE_CHROMIUM_EXECUTABLE_PATH` to use a custom binary; otherwise the renderer uses `PUPPETEER_EXECUTABLE_PATH` when configured, then Playwright's installed Chromium. The Docker image installs Chromium and its sandbox and runs as the non-root `node` user. Linux hosts must permit Chromium's sandbox; the renderer does not fall back to `--no-sandbox`.

Errors use `{ success: false, message }`: `400` for invalid request shape/query/ID, `401` for authentication failure, `404` for missing or another user's template. Disallowed content and CSS syntax errors return `422` with a descriptive `message` and `field` (`html_template` or `css_template`). Unexpected failures return a generic `500` message.

Run `npm run test:certificate-templates`. The PostgreSQL integration test uses session-local temporary tables and requires `TEST_DATABASE_URL`; without it, that test is skipped.

Run `npm run test:certificate-preview` for placeholder/document/HTTP tests, renderer lifecycle tests, and real Chromium PDF tests. Real-browser tests are skipped when Chromium is not installed. They check all A4/Letter orientations, one-page output, no outbound requests, and CSS/HTML containment.
