# Personal question categories

All routes require a Bearer token and the corresponding `question_categories.*`
permission. `_own` permissions restrict access to the authenticated user; `_any`
and Owner allow access across owners. Missing or inaccessible categories return
404. Request bodies cannot set `id` or `user_id`. Category metadata bodies cannot
set question memberships.

| Method | Path | Response data |
| --- | --- | --- |
| POST | `/api/quizzes/question-categories` | `{ category: {...} }`, status 201 |
| GET | `/api/quizzes/question-categories` | `{ categories: [...], pagination: {...}, sorting: {...} }` |
| GET | `/api/quizzes/question-categories/:categoryId` | `{ category: {...} }` |
| PATCH | `/api/quizzes/question-categories/:categoryId` | `{ category: {...} }` |
| DELETE | `/api/quizzes/question-categories/:categoryId` | `{ deleted: true }` |
| PUT | `/api/quizzes/question-categories/:categoryId/questions` | `{ category: {...}, question_ids: [...] }` |

Successful responses include `success: true`. Errors include `success: false`
and `message`. Invalid input returns 400, unauthenticated access returns 401,
and duplicate category names for the same user return 409. Names remain case
sensitive for uniqueness, matching the database constraint.

Create body:

```json
{
  "name": "Programming languages",
  "description": "Questions for language practice."
}
```

Name is trimmed and must contain 1–255 characters. Description is optional,
trimmed when provided, and defaults to null. PATCH accepts a nonempty subset of
these fields, preserves omitted fields, and accepts `description: null` to clear
the description. Unknown fields are rejected.

## Synchronize category membership

`PUT /api/quizzes/question-categories/:categoryId/questions` replaces the category's
membership set. Body:

```json
{
  "question_ids": ["12345678-1234-4234-8234-123456789abc"]
}
```

The array is required. `question_ids: []` clears all memberships. UUIDs are
normalized to lowercase and deduplicated. Every question and the category must
exist and share the category owner. Missing and foreign resources
return 404; malformed IDs or bodies return 400.

Every question belongs to at most one category. Supplied questions move from
previous categories; omitted questions currently in this category become uncategorized.
Question content and answers are preserved; assignments update `updated_at`.
The response includes category metadata and saved question IDs in UUID order.
Repeating the same PUT is idempotent. GET category details include its `questions`
list, with each question exposing `category: { id, name }`.

The operation uses one transaction and serializes with question-side category
changes for the same owner. Invalid/foreign question IDs roll back the whole operation.

GET list entries and GET category details include `question_count` (integer, 0 for an
empty category). It counts all current bank questions in that category, including drafts,
and updates automatically when questions are added, moved or deleted.

## List categories

List query parameters:

- `name`: optional case-insensitive substring filter, trimmed, at most 255 characters.
  Empty input means no filter. `%`, `_` and backslash are treated literally.
- `page`: positive integer, default 1.
- `limit`: 1–100, default 20.
- `sortBy`: `name` (default) or `id`.
- `sortOrder`: `asc` (default) or `desc`.

Example: `GET /api/quizzes/question-categories?name=language&page=1&limit=20&sortBy=name&sortOrder=asc`

The response follows the questions/replies pagination convention:

```json
{
  "success": true,
  "categories": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  },
  "sorting": {
    "sortBy": "name",
    "sortOrder": "asc"
  }
}
```

`total` counts categories matching `name` within the permitted owner scope. The count and page
share one SQL snapshot. `totalPages` is `Math.ceil(total / limit)`;
`hasNextPage` is `page < totalPages`, and `hasPreviousPage` is `page > 1`.
UUID ascending breaks ties when sorting by name. All reads use the primary.

Category deletion sets `questions.category_id` to NULL and preserves original questions.
Source rows referencing the category cascade; affected quiz totals update automatically. Questions can also change category through
`category_id` in question POST/PATCH; see `QUESTIONS.md`.

Apply migration `1792454400000_question-categories-and-uncategorized-sources.sql`
with `npm run migrate:deploy`. It retains the first old membership by category name,
then ID, for questions previously in several groups. Permission IDs and role grants
are preserved under the new `question_categories.*` keys.
Run `npm run test:question-categories` with `TEST_DATABASE_URL` for PostgreSQL checks.
