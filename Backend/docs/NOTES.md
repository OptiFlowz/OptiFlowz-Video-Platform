# Personal video notes

All endpoints require a Bearer token. Notes are private: even platform Owners
and Administrators can only read, edit, and delete their own notes.

| Method | Path | Permission | Response data |
| --- | --- | --- | --- |
| GET | `/api/notes/video/:videoId` | `notes.read_own` | `{ notes: [...] }` |
| POST | `/api/notes` | `notes.create` | `{ note: {...} }` (201) |
| PATCH | `/api/notes/:id` | `notes.edit_own` | `{ note: {...} }` |
| DELETE | `/api/notes/:id` | `notes.delete_own` | `{ deleted: true }` |

Responses also contain `success: true`, following the shared response helpers.
Errors contain `success: false` and `message` from the controller; authentication
and permission errors follow the existing middleware response format.

Create body:

```json
{
  "video_id": "12345678-1234-4234-8234-123456789abc",
  "title": "Key point",
  "text": "Review this example later.",
  "timestamp": 42.5,
  "color": "#ffcc00"
}
```

Title and text are trimmed and required (1–200 and 1–10,000 characters).
Timestamp is a finite, nonnegative number of seconds. Color is optional, accepts
a nonempty string up to 50 characters, and defaults to `null`. No palette is
enforced. PATCH accepts any nonempty subset of `title`, `text`, `timestamp`, and
`color`; use `color: null` to clear the color. The author and video cannot change.
Unknown body fields are rejected with 400.

GET returns all of the caller's notes on that video, ordered by timestamp then
ID. GET and POST use the same ready/public-or-uploader visibility rules as video
details, returning 404 for missing or inaccessible videos. Authors may still
edit/delete their existing notes if video visibility changes. Missing or foreign
notes return 404 on PATCH/DELETE without revealing another user's notes.

Creation allows at most 100 notes per user per video and returns 409 at the
limit. A primary-database transaction locks the user row before counting and
inserting, so concurrent API requests cannot bypass the limit. This is enforced
by the creation handler, not by a database trigger; other writers must follow
the same protocol. Deleting a note frees a slot.

The permission migration grants all four permissions to Viewer and Administrator
roles. Existing explicit permission assignments are preserved. Apply pending
migrations with `npm run migrate:deploy` before using the API.

Run `npm run test:notes` for handler and HTTP authorization coverage using a
mocked database; these tests do not require a live database.
