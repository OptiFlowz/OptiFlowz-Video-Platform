# Personal question groups

All routes require a Bearer token and operate only on the authenticated user's
groups. Missing and foreign groups return 404. Request bodies cannot set `id`,
`user_id` or question memberships.

| Method | Path | Response data |
| --- | --- | --- |
| POST | `/api/quizzes/question-groups` | `{ group: {...} }`, status 201 |
| GET | `/api/quizzes/question-groups` | `{ groups: [...], pagination: {...}, sorting: {...} }` |
| GET | `/api/quizzes/question-groups/:groupId` | `{ group: {...} }` |
| PATCH | `/api/quizzes/question-groups/:groupId` | `{ group: {...} }` |
| DELETE | `/api/quizzes/question-groups/:groupId` | `{ deleted: true }` |

Successful responses include `success: true`. Errors include `success: false`
and `message`. Invalid input returns 400, unauthenticated access returns 401,
and duplicate group names for the same user return 409. Names remain case
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

List query parameters:

- `name`: optional case-insensitive substring filter, trimmed, at most 255 characters.
  Empty input means no filter. `%`, `_` and backslash are treated literally.
- `page`: positive integer, default 1.
- `limit`: 1–100, default 20.
- `sortBy`: `name` (default) or `id`.
- `sortOrder`: `asc` (default) or `desc`.

Example: `GET /api/quizzes/question-groups?name=language&page=1&limit=20&sortBy=name&sortOrder=asc`

The response follows the questions/replies pagination convention:

```json
{
  "success": true,
  "groups": [],
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

`total` counts only the caller's groups matching `name`. The count and page
share one SQL snapshot. `totalPages` is `Math.ceil(total / limit)`;
`hasNextPage` is `page < totalPages`, and `hasPreviousPage` is `page > 1`.
UUID ascending breaks ties when sorting by name. All reads use the primary.

Group deletion cascades to existing `question_group_items` memberships and
preserves questions. Question CREATE/PATCH manage memberships through optional
`group_ids`; see `QUESTIONS.md`. There are no standalone membership endpoints.
Group responses contain only `id`, `user_id`, `name` and `description`.

Apply the existing question-groups migration with `npm run migrate:deploy`.
Run `npm run test:question-groups`; set `TEST_DATABASE_URL` to enable the
PostgreSQL/HTTP integration cases, which write only session-local objects.
