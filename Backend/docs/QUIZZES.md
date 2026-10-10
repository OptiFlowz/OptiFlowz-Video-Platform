# Personal quizzes

The `quizzes-engine/quizzes` submodule serves quiz CRUD at `/api/quizzes`.
All routes require a Bearer token and are scoped to the authenticated owner.
Missing and foreign quizzes return 404. Body fields `id`, `user_id`,
`created_at` and `updated_at` cannot be set by clients.

| Method | Path | Response data |
| --- | --- | --- |
| POST | `/api/quizzes` | `{ quiz: {...} }`, status 201 |
| GET | `/api/quizzes` | `{ quizzes: [...], pagination: {...}, sorting: {...} }` |
| GET | `/api/quizzes/:quizId` | `{ quiz: {...} }` |
| PATCH | `/api/quizzes/:quizId` | `{ quiz: {...} }` |
| DELETE | `/api/quizzes/:quizId` | `{ deleted: true }` |

Responses include `success: true`. Validation errors return 400,
authentication errors return 401, and inaccessible resources return 404.
Unexpected failures return a generic 500 message.

Create body:

```json
{
  "title": "Programming languages",
  "description": "Practice quiz",
  "question_count": 10,
  "time_limit_seconds": 600,
  "max_attempts": 3,
  "passing_score_percentage": 75.25,
  "shuffle_questions": true,
  "shuffle_options": true,
  "has_certificate": false
}
```

`title` (trimmed, 1–255 characters) and `question_count` are required.
Other defaults match the migration: `description: null`, `status: "draft"`,
`time_limit_seconds: null`, `max_attempts: null`, `passing_score_percentage: 50`,
both shuffle flags true and `has_certificate: false`.

Counts and non-null limits are positive integers up to 2147483647. A null
time limit means unlimited time; null attempts means unlimited attempts.
Passing score is a JSON number from 0 through 100 with at most two decimal
places. All responses expose it as a number. Boolean fields require JSON
booleans. Status accepts `draft`, `published` or `archived`.

PATCH accepts a nonempty subset of the create fields and preserves omitted
fields. Explicit null clears description, time limit or maximum attempts.
False shuffle/certificate flags and a zero passing score are preserved.
Each successful edit updates `updated_at` while preserving `created_at`.
Each mutation is a single atomic PostgreSQL statement; concurrent partial
edits preserve unrelated fields. Duplicate titles are allowed.

List query parameters:

- `title`: optional case-insensitive substring filter, trimmed, at most 255
  characters. Empty means no filter; `%`, `_` and backslash are literal.
- `status`: optional status filter.
- `page`: positive integer, default 1.
- `limit`: 1–100, default 20.
- `sortBy`: `created_at` (default), `updated_at`, `title`, `status`,
  `question_count` or `passing_score_percentage`.
- `sortOrder`: `asc` (default) or `desc`.

UUID ascending breaks equal sort values; status follows the enum order:
draft, published, archived. Counts and rows share one SQL snapshot and reflect
both filters. The response matches the questions/replies pagination format:

```json
{
  "success": true,
  "quizzes": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  },
  "sorting": {
    "sortBy": "created_at",
    "sortOrder": "asc"
  }
}
```

`totalPages = Math.ceil(total / limit)`, `hasNextPage = page < totalPages`
and `hasPreviousPage = page > 1`. Unknown input/query fields are rejected.
Existing questions and question-groups endpoints retain their current paths.

This CRUD stores the quiz table fields; question selection, attempts,
grading and certificate issuance are separate later workflows.
Apply `1791590400004_add-quizzes.sql` using `npm run migrate:deploy` before
using these routes. No additional migration is needed for CRUD.

Run `npm run test:quizzes`. Set `TEST_DATABASE_URL` to enable PostgreSQL/HTTP
integration tests; all writes use session-local objects.
