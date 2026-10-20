# Personal question bank

All routes require a Bearer token. Questions belong to the authenticated user;
another user's question returns 404 on read, edit and delete, including for
administrators. The request cannot set or change `id` or `user_id`.

| Method | Path | Response data |
| --- | --- | --- |
| POST | `/api/quizzes/questions` | `{ question: {...} }`, status 201 |
| GET | `/api/quizzes/questions` | `{ questions: [...], pagination: {...}, sorting: {...} }` |
| GET | `/api/quizzes/questions/:questionId` | `{ question: {...} }` |
| PATCH | `/api/quizzes/questions/:questionId` | `{ question: {...} }` |
| DELETE | `/api/quizzes/questions/:questionId` | `{ deleted: true }` |

Responses include `success: true`. Errors contain `success: false` and `message`.
Invalid input returns 400, missing authentication returns 401, and inaccessible
questions return 404. Unexpected failures return a generic 500 message.

Create a choice question:

```json
{
  "type": "single_choice",
  "content": "Which technology is a programming language?",
  "explanation": "Python is a programming language.",
  "options": [
    { "option_no": 1, "content": "Python", "is_correct": true, "position": 1 },
    { "option_no": 2, "content": "CSS", "position": 2 }
  ]
}
```

`multiple_choice` uses the same `options` structure. `is_correct` defaults to
false and `explanation` defaults to null. Create a matching question:

```json
{
  "type": "matching",
  "content": "Match the technology to its category.",
  "matching_options": [
    { "option_no": 1, "content": "Programming language", "position": 1 },
    { "option_no": 2, "content": "Database", "position": 2 }
  ],
  "matching_items": [
    { "item_no": 1, "content": "Python", "correct_option_no": 1, "position": 1 },
    { "item_no": 2, "content": "JavaScript", "correct_option_no": 1, "position": 2 },
    { "item_no": 3, "content": "PostgreSQL", "correct_option_no": 2, "position": 3 }
  ]
}
```

Choice questions accept only choice options; matching questions accept only
matching options/items. Nonempty child arrays belonging to another type are
rejected. Every matching item must reference an option belonging to the same
question. Multiple items may reference one option.

Identifiers (`option_no`, `item_no`, `correct_option_no`) are positive integers
up to 32767. Positions are positive integers up to 2147483647. Identifiers must
be unique within their respective arrays; positions need not be unique.

Creation and modification save drafts: empty content, missing children and
incomplete sets of correct answers are allowed. There is no activation route or
status column yet. `validateQuestionForActivation` provides the later activation
checks, including exactly one correct choice for `single_choice` and at least
one for `multiple_choice`; CRUD does not invoke it.

PATCH accepts a nonempty subset of the create fields. Omitted fields are
preserved; `explanation: null` clears the explanation. A supplied child array
replaces that entire collection, so send every child to retain. Reordering
changes `position` while keeping each existing `option_no` or `item_no`.
Missing `is_correct` in a supplied option defaults to false, as on creation.

On a type change, old child collections are cleared and newly supplied
collections are used. Text and explanation are preserved unless supplied.
To remove a referenced matching option, supply the updated item collection in
the same PATCH; retained items cannot be left with dangling references.

Create and PATCH accept optional `category_id`, a single category UUID or null:

```json
{ "category_id": "12345678-1234-4234-8234-123456789abc" }
```

The category must belong to the question owner. Missing/foreign IDs return 404;
invalid UUIDs and legacy `group_ids`/`category_ids` arrays return 400.
Omission on PATCH preserves the category; null clears it. Moving to another
category replaces the previous assignment. Every question has at most one category.

Detail, create, PATCH and list responses expose `category: { id, name }` or null.
The list accepts a `category_id` UUID filter before pagination. Candidate lists
at `/api/quizzes/:quizId/questions` include the same object inside `question`.
`PUT /api/quizzes/question-categories/:categoryId/questions` replaces a category's
question list and moves supplied questions out of previous categories.

Question changes and category assignment run in a transaction. Concurrent category
membership mutations for one owner serialize with a transaction advisory lock.
Deleting a category clears the question's category but preserves the question and answers.

All question responses include `created_at` and `updated_at`. Creation initializes
both timestamps; every successful PATCH updates `updated_at`, including changes
to child arrays or category memberships, while preserving `created_at`. Clients cannot set these fields.
For existing questions, the timestamp migration initializes both fields at the
time it runs.

List responses contain question metadata without child arrays. Query parameters
follow the comments replies convention:

- `type`: optional question type filter.
- `page`: positive integer, default 1.
- `limit`: 1–100, default 20.
- `sortBy`: `created_at` (default), `updated_at`, `content`, or `type`.
- `sortOrder`: `asc` (default) or `desc`.

UUID ascending breaks ties for equal sort values. `type` follows the PostgreSQL
enum order: single choice, multiple choice, matching. The old `offset` query
parameter is replaced by `page`. Unknown fields are rejected.

Example: `GET /api/quizzes/questions?page=2&limit=20&sortBy=updated_at&sortOrder=desc`

```json
{
  "success": true,
  "questions": [],
  "pagination": {
    "page": 2,
    "limit": 20,
    "total": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": true
  },
  "sorting": {
    "sortBy": "updated_at",
    "sortOrder": "desc"
  }
}
```

`total` counts the owner's questions matching the type filter, including when
the requested page is empty. `totalPages` is `Math.ceil(total / limit)`;
`hasNextPage` is `page < totalPages` and `hasPreviousPage` is `page > 1`, matching
the replies API.

Apply the questions, timestamp and question-categories migrations before using these endpoints:
`npm run migrate:deploy`.

Run `npm run test:questions` for validation tests. Set `TEST_DATABASE_URL` to
also run PostgreSQL and HTTP integration coverage; all test writes target
session-local tables rather than application tables.
