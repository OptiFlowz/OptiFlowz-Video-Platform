# Certificate templates

Base path: `/api/certificates/certificate-templates`. Every route requires an active user's Bearer access token. Records are always scoped to `req.user.sub`; there is no cross-user access or client-supplied owner.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/` | `201 { success: true, template }` |
| GET | `/` | `200 { success: true, templates, pagination, sorting }` |
| GET | `/:id` | `200 { success: true, template }` |
| PATCH | `/:id` | `200 { success: true, template }` |
| DELETE | `/:id` | `200 { success: true, deleted: true }` |

Create body:

```json
{
  "name": "Course completion",
  "description": null,
  "html_template": "<section class=\"certificate\"><h1>{{recipient_name}}</h1></section>",
  "css_template": ".certificate { display: grid; place-items: center; background: linear-gradient(#fff, #eee); }",
  "page_format": "A4",
  "orientation": "landscape"
}
```

`name` and `html_template` are required. Defaults: `description: null`, `css_template: ""`, `page_format: "A4"`, `orientation: "landscape"`. Name is trimmed and limited to 255 characters. HTML/CSS source is preserved exactly. Placeholders are stored as text; this API does not interpolate them.

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

`certificate-templates/helpers/templateContent.validation.js` exports `validateTemplateContent`, the shared content validator used for creation and partial updates. A future preview/render handler must call this same function with the complete HTML/CSS pair before rendering. This change implements the five CRUD routes; it does not introduce a preview endpoint or renderer.

HTML is checked with `sanitize-html` using explicit tag and attribute allowlists. Supported elements cover certificate layout, text, tables, links and images. Inline `style` attributes pass through the same CSS policy as `css_template`. Script, event handlers, iframe, object/embed, SVG, MathML, forms, style/link/meta elements, unknown attributes and unfinished markup are rejected. Sanitizer removals are errors, not silently saved alterations; harmless serialization differences and class whitespace normalization do not rewrite the stored source.

CSS is parsed with `postcss`; `postcss-value-parser` inspects function values, including escaped names. The property allowlist supports Flexbox, Grid, positioning, typography, backgrounds, borders, transforms and print layout. Allowed at-rules are `@media`, `@supports`, `@page`, and `@font-face`. CSS custom properties and `var()` are supported, with their values validated. Imports, unknown at-rules/properties/functions, `expression`, legacy bindings, unsafe URLs, malformed CSS and HTML style-element breakouts are rejected.

Resource URLs must be absolute HTTPS URLs without credentials or whitespace. Fragment links and CSS fragment references are allowed. HTTP, protocol-relative, relative, `data:`, `javascript:`, and `file:` URLs are rejected. No remote resource is fetched by CRUD. Rendering needs a separate sandbox/network policy; interpolation must escape substituted values and must not introduce executable HTML.

Errors use `{ success: false, message }`: `400` for invalid request shape/query/ID, `401` for authentication failure, `404` for missing or another user's template. Disallowed content and CSS syntax errors return `422` with a descriptive `message` and `field` (`html_template` or `css_template`). Unexpected failures return a generic `500` message.

Run `npm run test:certificate-templates`. The PostgreSQL integration test uses session-local temporary tables and requires `TEST_DATABASE_URL`; without it, that test is skipped.
