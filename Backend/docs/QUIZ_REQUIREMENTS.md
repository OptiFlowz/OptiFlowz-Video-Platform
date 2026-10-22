# Quiz requirements

Authenticated CRUD at `/api/quizzes/quiz-requirements`. Only the owner of the referenced quiz can access or modify its requirements. Videos can be published public videos or the owner's public/private videos; linking requires `mux_status = 'ready'`.

| Method | Path | Result |
| --- | --- | --- |
| POST | `/` | `201 { success, requirement }` |
| GET | `/` | `200 { success, requirements, pagination, sorting }` |
| GET | `/:quizId/:videoId` | `200 { success, requirement }` |
| PATCH | `/:quizId/:videoId` | `200 { success, requirement }` |
| DELETE | `/:quizId/:videoId` | `200 { success, deleted: true }` |

POST body:

```json
{
  "quiz_id": "12345678-1234-4234-8234-123456789abc",
  "video_id": "12345678-1234-4234-8234-123456789def",
  "min_watch_percentage": 75.25,
  "position": 0,
  "is_active": true
}
```

Exactly one of `min_watch_percentage` and `min_watch_seconds` must be non-null. Omitted thresholds default to null. Percentages are numbers greater than 0 and at most 100, with at most two decimal places. Seconds must be positive integers and cannot exceed `videos.duration_seconds`; unknown duration rejects seconds thresholds. Position defaults to 0 and accepts nonnegative integers.

PATCH accepts only `min_watch_percentage`, `min_watch_seconds`, `position`, and `is_active`. Omitted fields retain their existing values. To switch threshold types, explicitly clear the previous threshold:

```json
{ "min_watch_percentage": null, "min_watch_seconds": 60 }
```

Quiz and video IDs are immutable. Repeated POST for the same pair returns 409. Invalid input or a duration violation returns 400; missing/inaccessible resources return 404; missing/invalid access tokens return 401. Create and update validate under a PostgreSQL transaction with locks and database constraints, preventing partial writes and lost updates.

GET list accepts optional `quiz_id` to restrict the list to one owned quiz. Without it, requirements across all owned quizzes are returned. Pagination: `page=1`, `limit=20`, maximum limit 100. Sorting: `sortBy=position`, `sortOrder=asc`; allowed fields are `position`, `quiz_id`, `video_id`, `min_watch_percentage`, `min_watch_seconds`; direction is `asc` or `desc`. Null thresholds sort last in either direction, with ascending composite IDs as stable tie breakers. An inaccessible quiz filter returns 404; an owned quiz with no requirements returns an empty list.

Example: `GET /api/quizzes/quiz-requirements?quiz_id=12345678-1234-4234-8234-123456789abc&page=1&limit=20&sortBy=position&sortOrder=desc`.

```json
{
  "success": true,
  "requirements": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  },
  "sorting": { "sortBy": "position", "sortOrder": "desc" }
}
```

Each requirement has `quiz_id`, `video_id`, numeric/null `min_watch_percentage`, integer/null `min_watch_seconds`, `position`, and boolean `is_active`. GET single and list additionally include `video_card`: the existing card shape with title, duration, views, uploader, people, the viewer's watch progress, thumbnails, preview and media expiry. Cards are resolved in batches. If a linked video becomes unavailable, `video_card` is null; the requirement remains in the list and its pagination count. POST/PATCH return requirement fields without the card.

Deleting a requirement preserves the quiz and video. Deleting either a quiz or a video cascades to its requirements, preserving the other resource. Apply migrations `1791763200000_add-quiz-requirements.sql` and `1791763200001_cascade-quiz-requirements-video-delete.sql` before using these endpoints. No Postman collection changes are included.


`is_active` is a boolean, defaults to `true` on creation, and cannot be null. Existing rows become active when migration `1792627200000_add-quiz-requirements-is-active.sql` is applied. POST/PATCH accept it and all CRUD reads return it; the management list includes both active and inactive requirements. For example, PATCH `/:quizId/:videoId` with `{ "is_active": false }` disables a requirement without deleting it.

Participant GET `/:quizId/check` and `/:quizId/progress` consider only active requirements; progress omits inactive entries. Eligibility and starting a new attempt use the same active-only check. If no active requirements remain, `requirements_met` is `true` and progress returns an empty `requirements` array. Check/progress still require a published quiz. Deactivation does not relax threshold or video validation for CRUD writes.
