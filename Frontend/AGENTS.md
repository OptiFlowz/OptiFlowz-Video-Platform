# UI styling

Use existing CSS variables for all UI colors, including backgrounds, borders, text, shadows, and interaction states. Do not introduce hardcoded color literals or fixed-color utility classes. Keep pagination consistent across pages by using the shared `app/components/library/pagination.tsx` component.

Reuse SVG icons from `app/constants.tsx`. Add a new SVG only when the required icon is missing from the existing collection.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
