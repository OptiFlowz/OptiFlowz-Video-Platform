# UI styling

Use existing CSS variables for all UI colors, including backgrounds, borders, text, shadows, and interaction states. Do not introduce hardcoded color literals or fixed-color utility classes. Keep pagination consistent across pages by using the shared `app/components/library/pagination.tsx` component.

Reuse SVG icons from `app/constants.tsx`. Add a new SVG only when the required icon is missing from the existing collection.
