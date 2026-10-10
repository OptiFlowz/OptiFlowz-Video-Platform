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

Create and PATCH also accept optional `group_ids`, an array of group UUIDs:

```json
{
  "group_ids": ["12345678-1234-4234-8234-123456789abc"]
}
```

This example is a PATCH body; creation additionally requires `type` and
`content`. `group_ids` manages rows in `question_group_items` and is not a
column in `questions`. Every group must exist and belong to the question owner.
`PUT /api/quizzes/question-groups/:groupId/questions` also replaces a group's
question memberships; see `QUESTION_GROUPS.md`.
Missing and foreign groups both return 404. Malformed group IDs return 400.
Duplicate IDs are normalized to lowercase and deduplicated; the composite
membership PK also prevents duplicates.

- On creation, supplied groups are linked in the question's transaction.
- On PATCH, supplied groups replace the membership set: new links are inserted,
  omitted links removed, and retained links preserved.
- Omitting `group_ids` on PATCH leaves all existing memberships untouched,
  including when changing the question type.
- `group_ids: []` removes all memberships.

Detail, create and PATCH responses include the current `group_ids`, sorted by
UUID. List responses remain question metadata. Question deletion cascades to
memberships and preserves the groups themselves.

Create, PATCH and DELETE execute in transactions. Changes to the question,
answers and memberships roll back together on any failure. Target groups are
validated and share-locked until commit, preventing concurrent deletion or
owner changes during linking. PATCH locks
the owned parent before reading children, serializing concurrent modifications.
All reads use the primary database. Detail responses contain all three child
arrays, sorted by position then their stable identifier; unused arrays are empty.

All question responses include `created_at` and `updated_at`. Creation initializes
both timestamps; every successful PATCH updates `updated_at`, including changes
to child arrays or group memberships, while preserving `created_at`. Clients cannot set these fields.
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

Apply the questions, timestamp and question-groups migrations before using these endpoints:
`npm run migrate:deploy`.

Run `npm run test:questions` for validation tests. Set `TEST_DATABASE_URL` to
also run PostgreSQL and HTTP integration coverage; all test writes target
session-local tables rather than application tables.
