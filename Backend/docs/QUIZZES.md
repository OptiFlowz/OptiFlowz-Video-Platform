# Personal quizzes

The `quizzes-engine/quizzes` submodule serves quiz CRUD at `/api/quizzes`.
All routes require a Bearer token. Management routes use `quizzes.*_own` /
`quizzes.*_any` permissions; Owner retains the existing permission bypass.
Missing or inaccessible quizzes return 404. Body fields `id`, `user_id`,
`created_at` and `updated_at` cannot be set by clients.

| Method | Path | Response data |
| --- | --- | --- |
| POST | `/api/quizzes` | `{ quiz: {...} }`, status 201 |
| GET | `/api/quizzes` | `{ quizzes: [...], pagination: {...}, sorting: {...} }` |
| GET | `/api/quizzes/:quizId` | `{ quiz: {...} }` |
| GET | `/api/quizzes/published` | Participant `{ quizzes: [...], pagination: {...}, sorting: {...} }` |
| GET | `/api/quizzes/published/:quizId` | Participant `{ quiz: {...} }` |
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
  "time_limit_seconds": 600,
  "max_attempts": 3,
  "passing_score_percentage": 75.25,
  "shuffle_questions": true,
  "shuffle_options": true,
  "certificate_template_id": null
}
```

Only `title` (trimmed, 1–255 characters) is required. `question_count` is read-only: fixed questions + source counts. It starts at 0; sending it in POST/PATCH returns 400.
Other defaults match the migration: `description: null`, `status: "draft"`,
`questions_per_page: 1`, `time_limit_seconds: null`, `max_attempts: null`, `passing_score_percentage: 50`,
both shuffle flags true and `certificate_template_id: null`.

Counts and non-null limits are positive integers up to 2147483647. A null
time limit means unlimited time; null attempts means unlimited attempts.
Passing score is a JSON number from 0 through 100 with at most two decimal
places. All responses expose it as a number. Boolean fields require JSON
booleans. Status accepts `draft`, `published` or `archived`.

PATCH accepts a nonempty subset of the create fields and preserves omitted
fields. Explicit null clears description, time limit or maximum attempts.
False shuffle flags and a zero passing score are preserved.
Each successful edit updates `updated_at` while preserving `created_at`.
Each mutation is a single atomic PostgreSQL statement; concurrent partial
edits preserve unrelated fields. Duplicate titles are allowed.

List query parameters:

- `user_id`: optional author UUID. Users with `read_any` (or Owner) can filter by
  any author. For `read_own`, this filter intersects the authenticated user's
  scope: another author's ID returns an empty list with total 0. Omission keeps
  the existing authorized scope. Invalid/empty/repeated IDs return 400.

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
Existing questions and question-categories endpoints retain their current paths.

This CRUD stores the quiz table fields; question selection, attempts,
grading and certificate issuance are separate later workflows.
Apply `1791590400004_add-quizzes.sql` using `npm run migrate:deploy` before
using these routes. Also apply `1792454400001_fixed-questions-and-random-category-sources.sql`; counts are maintained by database triggers.

Run `npm run test:quizzes`. Set `TEST_DATABASE_URL` to enable PostgreSQL/HTTP
integration tests; all writes use session-local objects.

`questions_per_page` accepts a positive integer (1–2147483647) on POST/PATCH and is returned by create, update, detail and list. It is informational for frontend pagination and may exceed the question count. New attempts copy it into `settings_snapshot`; later quiz edits do not change that snapshot. Existing attempts are not backfilled; clients can use 1 when the field is absent.


## Published quizzes for participants

`GET /api/quizzes/published` and `GET /api/quizzes/published/:quizId` require
`quizzes.participate`. They do not require author read permissions and show
published quizzes from all authors. Publication scope also applies to authors
and Owners. A missing, draft or archived detail returns 404; malformed UUIDs
return 400. Authentication/permission failures return 401/403.

List parameters and pagination/sorting match the management list above. The
optional `status` parameter may only be `published`; other values return 400.
The repository always enforces `published`, including in pagination totals.
`user_id` optionally filters by author UUID, without requiring author read permissions.
Only published quizzes of that author are included; unknown IDs yield an empty
list with total 0. The filter also applies to pagination totals. Example:

```http
GET /api/quizzes/published?user_id=12345678-1234-4234-8234-123456789abc&title=Programming&page=1&limit=20&sortBy=created_at&sortOrder=desc
```

Both routes return the same participant quiz shape: `id`, `title`, `description`,
`status`, `question_count`, `questions_per_page`, `time_limit_seconds`,
`max_attempts`, `passing_score_percentage`, `shuffle_questions`, `shuffle_options`,
`min_answered_percentage`, `min_correct_percentage`, `correctness_visibility`,
`correct_answers_visibility`, `explanation_visibility`, `explanation_incorrect_only`,
`allow_answer_changes_after_check`, `allow_attempt_review`, `show_final_score`,
`scoring_mode`, `created_at`, `updated_at`, and computed `has_certificate`.
`has_certificate` indicates whether a certificate template is assigned; it is
read-only in this participant DTO. Management writes still use `certificate_template_id`.
Author/template IDs, question content/solutions, sources and attempts are not included.

These routes do not evaluate watch requirements or attempt limits, so a quiz
remains visible even when a participant cannot start it. Use
`GET /api/quizzes/:quizId/eligibility` for start/resume eligibility. Settings here
are current quiz settings; an existing attempt continues to use its snapshot.
Responses use `Cache-Control: private, no-store`.
