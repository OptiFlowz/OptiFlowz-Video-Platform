# Posts

Apply the posts, posts-permissions, posts-status, and post-option-positions migrations before using these endpoints.
The option-position migration backfills existing options in their previous UUID display order.
All mutation endpoints require a Bearer access token. Reading a public post allows anonymous access.

## Create the post

`POST /api/posts` requires `posts.create` and accepts only post metadata:

```json
{
  "title": "Community update",
  "status": "private"
}
```

Title is trimmed and required (1–255 characters). Status accepts `private` or
`public` and defaults to `private`. The status migration sets existing posts to
`private` as well. Do not send `blocks`, author IDs, or other unknown fields.

Returns HTTP 201 with `{ "success": true, "post": { ... } }`. The post contains
`id`, `user_id`, `title`, `status`, `created_at`, and an empty `blocks` array.
Use its `id` to append content. Creation no longer accepts nested blocks.

## A user's public posts

`GET /api/posts/:userId?page=1&limit=20&sortBy=created_at&sortOrder=desc`

Returns only the specified user's public posts, including their blocks and
poll/questioner options. No authentication is required. If a Bearer token is provided, it must
be valid. Private posts are always excluded, even for their author or an administrator.

| Parameter | Values | Default |
| --- | --- | --- |
| `page` | Positive integer | `1` |
| `limit` | Integer from 1 to 100 | `20` |
| `sortBy` | `created_at` | `created_at` |
| `sortOrder` | `asc`, `desc` | `desc` |

Newest posts appear first by default; use `sortOrder=asc` for oldest first.
Post IDs break timestamp ties. Invalid user UUIDs or query parameters return 400.
Pagination is applied to posts before expanding their blocks, so a post is never
split between pages. Blocks and options are ordered by ascending position.

HTTP 200 uses the same `posts`, `pagination`, and `sorting` structure as `/my`,
with full posts instead of cards:

```json
{
  "success": true,
  "posts": [
    {
      "id": "12345678-1234-4234-8234-123456789abc",
      "user_id": "12345678-1234-4234-8234-123456789def",
      "title": "Community update",
      "status": "public",
      "created_at": "2026-09-19T12:00:00+00:00",
      "blocks": [
        {
          "id": "12345678-1234-4234-8234-123456789aaa",
          "post_id": "12345678-1234-4234-8234-123456789abc",
          "type": "text",
          "position": 0,
          "content": { "text": "Hello everyone!" }
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  },
  "sorting": { "sortBy": "created_at", "sortOrder": "desc" }
}
```

Poll/questioner options include `id`, `block_id`, `position`, `text`, and `image_url`.
The feed includes the viewer's saved selection and per-option counts. Percentages
are calculated by the frontend and displayed only after participation. Questioner
options include `is_correct` before answering so the UI can give instant feedback. Individual response records and
respondent identities are never exposed. Image/video text is returned in `content`.
Video blocks do not grant playback access beyond the existing video policy.

Empty posts contain `blocks: []`. Empty or out-of-range pages return `posts: []`
with correct totals for the requested user. A user with no public posts (or a
nonexistent user UUID) returns `totalPages: 0`. There is no all-users feed route.

To add another sort field later, update `PUBLIC_POST_SORT_FIELDS` in
`helpers/posts.shared.js`; query validation derives its allowed keys from that
map. SQL expressions must be trusted constants referring to selected post fields.
If sorting by a new column, also select it in the feed's `page_posts` query.

## List the current user's post cards

`GET /api/posts/my?page=1&limit=20&sortBy=created_at&sortOrder=desc`

Requires a Bearer access token. The author always comes from the token, so the
route returns only the caller's posts, both public and private. It does not
accept a user ID or let administrators list another author's posts.

Query parameters follow the comment-replies endpoint's naming and its nested
`pagination`/`sorting` response format:

| Parameter | Values | Default |
| --- | --- | --- |
| `page` | Positive integer | `1` |
| `limit` | Integer from 1 to 100 | `20` |
| `sortBy` | `title`, `status`, `created_at`, `content` | `created_at` |
| `sortOrder` | `asc`, `desc` | `desc` |

Invalid or unknown parameters return 400. Sorting is applied before pagination,
with post IDs breaking ties. Title sorting ignores letter case; status sorts
alphabetically (`private` before `public` in ascending order). `content` sorts
lexicographically by the alphabetically ordered array of distinct block types,
not by the text or number of blocks. Empty type arrays sort first ascending.

Each card includes `id`, `title`, `text`, `status`, `created_at`, and
`block_types`. `text` combines all nonempty `content.text` values with newline
separators in block-position order. This includes image/video captions and
poll/questioner questions. `block_types` lists each contained type once,
alphabetically. Empty posts return `text: ""` and `block_types: []`.

Example HTTP 200 response:

```json
{
  "success": true,
  "posts": [
    {
      "id": "12345678-1234-4234-8234-123456789abc",
      "title": "Community update",
      "text": "Welcome!\nWhich topic should we cover next?",
      "status": "private",
      "created_at": "2026-09-19T12:00:00+00:00",
      "block_types": ["poll", "text"]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 1,
    "totalPages": 1,
    "hasNextPage": false,
    "hasPreviousPage": false
  },
  "sorting": {
    "sortBy": "created_at",
    "sortOrder": "desc"
  }
}
```

Empty and out-of-range pages return `posts: []` with accurate totals. No posts
means `totalPages: 0`; the previous-page flag follows comments (`page > 1`).
This route is registered before `/:userId` so `/my` is not interpreted as an ID.

## Get one post with all blocks

`GET /api/posts/details/:postId` returns HTTP 200 with `{ "success": true, "post": {...} }`.
Single-post retrieval moved to `/details/:postId` because `/:userId` now lists a user's posts.
No request body is needed. Public posts can be read without a token. Private
posts require the author or a user with `posts.update_any` (including platform
Owners through their existing permission bypass). Other readers receive 404,
the same as a missing post. Invalid UUIDs return 400. If a token is supplied,
it must be valid; invalid/expired tokens return 401 even for public posts.

```json
{
  "success": true,
  "post": {
    "id": "12345678-1234-4234-8234-123456789abc",
    "user_id": "12345678-1234-4234-8234-123456789def",
    "title": "Community update",
    "status": "public",
    "created_at": "2026-09-19T12:00:00.000Z",
    "blocks": [
      {
        "id": "12345678-1234-4234-8234-123456789aaa",
        "post_id": "12345678-1234-4234-8234-123456789abc",
        "type": "text",
        "position": 0,
        "content": { "text": "Hello everyone!" }
      }
    ]
  }
}
```

Blocks are ordered by ascending `position`; an empty post returns `blocks: []`.
Poll and questioner blocks additionally include an `options` array with `id`,
`block_id`, `position`, `text`, and `image_url`. Options are ordered by ascending
position. Questioner `is_correct` fields are returned
to every reader with access to the post, including before answering. Viewer selection and results follow the participation rules below.
Individual vote/answer records and respondent identities are not included.

The post and all nested data use one primary-database query for a consistent
snapshot and current visibility. Video blocks contain their stored `video_id`;
this endpoint does not grant access to the referenced video's playback.

## Delete a post

`DELETE /api/posts/:postId` requires Bearer authentication and `posts.delete_own`
for the author or `posts.delete_any` for another user's post. Platform Owners
retain their permission bypass. Update permission alone does not allow deletion.
No request body is needed.

Returns HTTP 200:

```json
{
  "success": true,
  "deleted": true,
  "post_id": "12345678-1234-4234-8234-123456789abc"
}
```

Deletes the post, all blocks, options, votes, and answers, including blocks with
existing responses. Deletes managed images referenced by image blocks and
poll/questioner options. Referenced videos and external image URLs are retained.
Deletion locks the post to serialize it with block and option edits.

Invalid UUIDs return 400, forbidden deletion returns 403, and missing or already
deleted posts return 404. Storage failure returns 502 and rolls back database
deletion so the same request can be retried. Some files may already have been
removed when a later storage operation or commit fails; storage cannot roll back
with PostgreSQL. Retrying safely removes remaining files. No cleanup worker or
retry queue is used. Cached copies may persist until their cache lifetime expires.

## Append a block

`POST /api/posts/:postId/blocks` requires `posts.update_own` for the author or
`posts.update_any` for another user's post. Platform Owners retain their existing
permission bypass. Access is checked before multipart uploads are buffered and
again inside the database transaction.

Each request appends one block. Positions start at zero and are assigned by the
server, with a maximum of 50 blocks per post. Concurrent appends lock the post row
to prevent duplicate positions or bypassing the limit. Returns HTTP 201 with
`{ "success": true, "block": { ... } }`, including saved options where applicable.

For blocks without images, send `application/json`:

```json
{ "type": "text", "content": { "text": "Welcome to the community!" } }
```

```json
{
  "type": "video",
  "content": {
    "video_id": "12345678-1234-4234-8234-123456789abc",
    "text": "Watch this walkthrough."
  }
}
```

```json
{
  "type": "poll",
  "content": { "text": "What should we cover next?" },
  "options": [{ "text": "Basics" }, { "text": "Advanced" }]
}
```

```json
{
  "type": "questioner",
  "content": { "text": "Which answer is correct?" },
  "options": [{ "text": "A", "is_correct": true }, { "text": "B" }]
}
```

Every block type supports `content.text`. Text blocks and poll/questioner prompts
require nonempty text (1–10,000 trimmed characters). Image and video text is
optional, trimmed, and limited to 10,000 characters; `""` clears their text.
Omitting media text when appending remains supported. Polls and
questioners require 2–20 options with text (1–500 characters each). Questioner
options accept `is_correct` (boolean, default `false`); at least one must be true.
Editing, single-post GET, and public-feed responses include option correctness
flags, including before the viewer answers.

Option positions start at zero. When appending a block, each option may include
`position`; omitted positions default to the option's index in the request array.
The resulting positions must be unique and cover `0` through `options.length - 1`.
The returned options are sorted by position. Multipart `option_0`, `option_1`, etc.
still refer to request-array indices, regardless of explicit positions.

Video IDs must be UUIDs. The shared video-access check requires a ready video
that is published/public or owned by the caller; inaccessible videos return 404.
Embedding does not change playback permissions.

## Upload block images

Send `multipart/form-data` to the same append endpoint. Supply a `block` text
field containing the JSON block and the image files as separate fields.
Do not set a multipart Content-Type header manually when using browser FormData.

Image block:

```javascript
const form = new FormData();
form.append('block', JSON.stringify({
  type: 'image',
  content: { text: 'A photo from our latest event.' },
}));
form.append('file', imageFile);
await fetch(`/api/posts/${postId}/blocks`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
```

Poll or questioner option images use zero-based `option_0`, `option_1`, etc.,
matching the option's index in the JSON array:

```javascript
const form = new FormData();
form.append('block', JSON.stringify({
  type: 'poll',
  content: { text: 'Pick a design' },
  options: [{ text: 'Design A' }, { text: 'Design B' }],
}));
form.append('option_0', firstImage);
form.append('option_1', secondImage);
await fetch(`/api/posts/${postId}/blocks`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}` },
  body: form,
});
```

Images must be JPEG, PNG, or WebP, up to 5 MB each and 40 million decoded pixels.
There may be at most one file per image field. The multipart `block` JSON field
is limited to 64 KB; ordinary JSON requests retain the platform's 100 KB limit.
Images are rotated, resized within 1920×1920 without enlargement, and converted
to WebP. The existing R2 configuration stores them under `posts/<postId>/`.

The server writes `content.url` for image blocks and `image_url` for options.
Clients must not supply those URLs; options without uploads receive `null`.
Appending an image block requires a `file`; its optional text is saved alongside
the generated `content.url`. Files on text/video blocks, unknown option indices,
unknown fields, and malformed images are rejected. Oversize files return 413;
other invalid inputs return 400. Missing posts return 404, forbidden edits 403,
and exceeding the block limit 409.

Each block and its options are saved in one transaction. Failed appends trigger
best-effort cleanup of uploaded images. If the COMMIT outcome is uncertain,
images are retained to avoid breaking a potentially saved block.

Storage uses the existing public R2 image delivery setup: `private` restricts
access to the post but does not make an uploaded image's direct URL private.
Metadata, visibility and section ordering can be updated through the PATCH endpoint described below.

## Delete a block

`DELETE /api/posts/:postId/blocks/:blockId` requires a Bearer access token and
`posts.update_own` for the author or `posts.update_any` for another user's post,
matching append permissions. There is no request body.

Returns HTTP 200:

```json
{
  "success": true,
  "deleted": true,
  "block_id": "12345678-1234-4234-8234-123456789abc"
}
```

The block must belong to the specified post. Missing or mismatched blocks return
404, invalid UUIDs return 400, and forbidden edits return 403. The post row is
locked to serialize deletion with appends. Remaining block positions are kept;
gaps are allowed and subsequent appends use the highest position plus one.

Deletion removes the image block's uploaded file and all uploaded poll/questioner
option images. Database cascades remove options, votes, and answers. Referenced
video assets are retained. Only URLs matching this post's upload namespace under
the configured R2 public base URL are deleted; legacy external image URLs are
not storage objects managed by this endpoint.

R2 deletion must succeed before the database transaction commits. A storage
failure returns 502 and rolls back database deletion so the same request can be
retried. R2 and PostgreSQL cannot share a transaction: some images may already
have been removed if a later deletion or database commit fails. Retrying safely
deletes any remaining files. An already deleted block returns 404. Previously
cached image copies may remain available until their cache lifetime expires.

## Edit blocks and manage options

All routes below require Bearer authentication and `posts.update_own` for the
author or `posts.update_any` for another user's post. IDs are validated and
options must belong to the specified block and post. Options are supported only
on poll and questioner blocks. IDs are preserved during edits.

| Method | Path | Success response |
| --- | --- | --- |
| PATCH | `/api/posts/:postId/blocks/:blockId` | 200 `{ "success": true, "block": {...} }` |
| POST | `/api/posts/:postId/blocks/:blockId/options` | 201 `{ "success": true, "option": {...} }` |
| PATCH | `/api/posts/:postId/blocks/:blockId/options/:optionId` | 200 `{ "success": true, "option": {...} }` |
| DELETE | `/api/posts/:postId/blocks/:blockId/options/:optionId` | 200 `{ "success": true, "deleted": true, "option_id": "..." }` |
| DELETE | `/api/posts/:postId/blocks/:blockId/options/:optionId/image` | 200 `{ "success": true, "option": {...} }` with `image_url: null` |

### Edit question text or block content

For any block type, PATCH text with raw JSON:

```json
{
  "content": {
    "text": "Which topic would you like to explore next?"
  }
}
```

Both poll and questioner blocks require `content.text` when created and when
their question is edited. Text is trimmed, nonempty, and limited to 10,000
characters. Editing a question keeps its options intact. The response contains
the block's persisted columns; it does not include the unchanged options.

For image and video blocks, text is optional and may be cleared with
`{ "content": { "text": "" } }`. Text-only edits keep the existing image URL or
video ID. Omitting text from a media-replacement request keeps the existing text.
Existing media blocks without text remain valid; no migration is needed. GET
returns stored text in each block's `content` along with its other content fields.

To replace a video, send `{ "content": { "video_id": "EXISTING-VIDEO-UUID" } }`,
optionally adding `text` in the same content object. The ready/public-or-owner
access check applies when supplying a video ID; text-only edits do not recheck
an unchanged video. Type, position, IDs, and
nested options cannot be changed through PATCH. Option edits use the dedicated
routes. Unknown fields and empty edits return 400.

### Replace a block image in Postman

PATCH the image block with **Body → form-data**:

| Key | Field type | Value |
| --- | --- | --- |
| `file` | File | New image |
| `data` | Text | `{"content":{"text":"Updated image caption"}}` (optional) |

Keep Postman's automatic multipart Content-Type header. Omit `data` or use `{}`
to replace only the image and retain its text. Omit the file to edit only text
(using JSON or multipart `data`); the existing image remains untouched. Files on
other block types are rejected. Empty edits without a file return 400.

### Add or edit an option

POST a new poll option with raw JSON `{ "text": "Another topic" }`.
An optional `position` inserts it at that zero-based index and shifts later
options right. Omitting it appends the option. For addition, valid positions are
`0` through the current option count (subject to the 20-option limit).

PATCH an existing option with `{ "position": 0 }` to move it to the start.
Position can be combined with text, correctness, or image edits. For edits, it
must be an existing index (`0` through the option count minus one). Other options
shift to preserve their relative order. Deleting an option closes the gap.
Positions must be integers; negative, duplicate initial, or out-of-range positions
return 400. All option responses include `position`, including image removal,
votes, and answers. Reordering preserves IDs and follows the existing rule that
options cannot change after the block has responses (409). Reload post details
after a mutation to retrieve all shifted positions.

For a questioner, `is_correct` may also be supplied and defaults to `false`:

```json
{
  "text": "201 Created",
  "is_correct": true
}
```

PATCH accepts only changed fields, such as `{ "text": "Updated answer" }` or
`{ "is_correct": true }`. Omitted text, correctness, and images are retained.
Poll options reject `is_correct`. Clients cannot supply `image_url` or IDs.

To add an option with an image, or replace one option's image, use form-data:

| Key | Field type | Value |
| --- | --- | --- |
| `data` | Text | `{"text":"Updated answer","is_correct":true}` for a questioner, or `{"text":"Updated choice"}` for a poll |
| `file` | File | Image for this option |

For an image-only PATCH, omit `data` or use `{}`. An omitted file preserves the
current image. POST still requires option text. These routes use `data`, whereas
the existing block-append route continues to use `block` and `option_0`, etc.
Upload formats, 5 MB file limit, and image processing match block appends.

### Deletion and response protection

Both DELETE option routes take no body. Deleting an option deletes its uploaded
image. Deleting only its image keeps the option and clears `image_url`; repeating
image removal when no image remains succeeds without changing anything.

Option mutations lock the parent post and existing choices. Adding beyond 20
options or deleting below two returns 409. A questioner must retain at least one
correct option. To change the sole correct answer, first mark the new answer as
correct, then clear the old one.

Once any vote/answer exists in a block, adding, editing, deleting options,
changing option images, and editing the question text return 409. This preserves
what respondents answered. Deleting an entire block remains an explicit
destructive action and still cascades its responses, as described above.

### Image replacement and failure handling

Replacements upload a new file, commit its database reference, then immediately
attempt to delete the old file. Before-commit failures clean up the new upload
on a best-effort basis and retain the old reference. If the COMMIT result is
uncertain, uploads are retained to avoid breaking a possibly saved edit.

If old-image cleanup fails after a successful replacement, the edit still
succeeds and the failed object key is logged. There is no cleanup worker,
retry queue, or automatic retry; failed cleanup may require manual removal.
Explicit option/image DELETE operations require storage deletion before commit,
return 502 on storage failure, and retain database records for a request retry.
As with block deletion, storage and PostgreSQL cannot roll back together.

These editing routes require the post-option-positions migration listed above.

## Poll voting and questioner answers

Both routes require a Bearer access token and accept raw JSON:

```json
{
  "option_id": "12345678-1234-4234-8234-123456789aaa"
}
```

The user always comes from the access token. Unknown body fields, including
`user_id`, are rejected. The option must belong to the specified block, and the
block must belong to the specified post. The post must be public or readable by
its authenticated author or a user with `posts.update_any`. Private-post access
does not replace the participation permission required below.

### Vote in a poll

`POST /api/posts/:postId/blocks/:blockId/vote` requires `posts.poll.vote`.

The user has one selection per poll block. Sending a different option deletes
their previous vote in this block and inserts the new choice in one transaction.
Clicking the selected option again sends the same request with `remove: true`
and clears the user's vote in that block. This explicit removal is idempotent:
retrying it cannot add the vote back. A normal request without `remove` continues
to select the given option, so retries of a vote are also safe. Other users' votes
and votes in other blocks are unaffected. `remove` is accepted only for polls,
never for questioner answers.

After removal the response has `selected_option_id: null`, `has_responses`, and
options with updated counts but no percentages. The frontend hides results again.
`has_responses` indicates whether any other responses remain in the block.

HTTP 200 example after voting:

```json
{
  "success": true,
  "post_id": "12345678-1234-4234-8234-123456789abc",
  "block_id": "12345678-1234-4234-8234-123456789bbb",
  "selected_option_id": "12345678-1234-4234-8234-123456789aaa",
  "total_votes": 4,
  "options": [
    {
      "id": "12345678-1234-4234-8234-123456789aaa",
      "text": "Basics",
      "position": 0,
      "image_url": null,
      "vote_count": 3,
      "is_selected": true
    },
    {
      "id": "12345678-1234-4234-8234-123456789ccc",
      "text": "Advanced",
      "position": 1,
      "image_url": null,
      "vote_count": 1,
      "is_selected": false
    }
  ]
}
```

### Answer a questioner

`POST /api/posts/:postId/blocks/:blockId/answer` requires `posts.questioner.answer`.

Send `{ "option_id": "<uuid>" }` for a single answer, or
`{ "option_ids": ["<uuid>", "<uuid>"] }` for multiple answers. The array must
contain 1–20 unique IDs belonging to this block. A questioner with exactly one
correct option accepts only one selected option.

Only the user's first answer set is saved, atomically. A different set afterward
returns 409 and leaves the original untouched. Retrying the same set in any order
returns current results without changing timestamps or adding answers.

The HTTP 200 response has `post_id`, `block_id`, `selected_option_id`,
`selected_option_ids`, `total_answers`, and an `options` array. The array contains
all saved selections; the singular field is null unless exactly one was selected. Each option contains `id`, `text`,
`position`, `image_url`, `answer_count`, `is_selected`, and `is_correct`.
Top-level `is_correct` is true only when the selected set contains every correct
option and no incorrect options. `correct_option_ids` lists every correct option.
`total_answers` counts option selections, not distinct respondents.

```json
{
  "success": true,
  "post_id": "12345678-1234-4234-8234-123456789abc",
  "block_id": "12345678-1234-4234-8234-123456789bbb",
  "selected_option_id": "12345678-1234-4234-8234-123456789aaa",
  "total_answers": 1,
  "is_correct": false,
  "correct_option_ids": ["12345678-1234-4234-8234-123456789ccc"],
  "options": [
    {
      "id": "12345678-1234-4234-8234-123456789aaa",
      "text": "200",
      "position": 0,
      "image_url": null,
      "answer_count": 1,
      "is_selected": true,
      "is_correct": false
    },
    {
      "id": "12345678-1234-4234-8234-123456789ccc",
      "text": "201",
      "position": 1,
      "image_url": null,
      "answer_count": 0,
      "is_selected": false,
      "is_correct": true
    }
  ]
}
```

### Results and concurrency

Results include all options with `position`, ordered by position, including zero-response choices.
The API returns counts, not percentages. The frontend calculates
`option count / block total * 100`, rounded to two decimal places; rounding may
make the sum differ slightly from 100. Counts include the current submission
and never expose other respondents' identities.

Participation locks the post, then its block and options, matching content
mutation lock order. This serializes concurrent submissions and prevents
overlapping requests from replacing a final answer or leaving multiple poll
choices through these routes. The existing schema has uniqueness per
option/user; these transactions enforce one current choice per poll and one
immutable answer set per questioner.
Future writers must follow the same locking and response rules.

Malformed input or the wrong block type returns 400; missing login returns 401;
missing participation permission returns 403; an inaccessible/missing post or
mismatched block/option returns 404. Attempting to change a questioner answer
returns 409. Both successful routes return 200, including retries. No additional
database migration or cleanup worker is needed.

GET responses include counts, the viewer's selection, and questioner option
correctness. The answer endpoint validates and returns the recorded result.

## Module structure

- `posts.routes.js`: route registration and middleware order.
- `posts.controller.js`: shared HTTP response envelopes.
- `posts.middleware.js`: edit authorization and multipart parsing.
- `handlers/createPost.js`: metadata-only creation.
- `handlers/getPost.js`: visibility-aware retrieval with ordered blocks and nested options.
- `handlers/getMyPosts.js`: owner-only post cards with pagination and sorting metadata.
- `handlers/getUserPosts.js`: one user's public posts with full blocks, pagination, and sorting.
- `handlers/deletePost.js`: post deletion, cascades, and referenced-image cleanup.
- `handlers/appendPostBlock.js`: serialized block insertion and option persistence.
- `handlers/deletePostBlock.js`: block deletion, cascading records, and image cleanup.
- `handlers/editPostBlock.js`: block content and question text edits, image replacement.
- `handlers/addPostOption.js`, `handlers/editPostOption.js`: option creation and partial edits.
- `handlers/deletePostOption.js`, `handlers/deletePostOptionImage.js`: option and option-image removal.
- `handlers/votePostPoll.js`: replaceable single-choice poll votes.
- `handlers/answerPostQuestioner.js`: final questioner answer sets.
- `helpers/posts.shared.js`: schemas, limits, and column definitions.
- `helpers/postAccess.js`: post ownership, edit permissions, and delete permissions.
- `helpers/postImages.js`: image validation, processing, upload, and cleanup.
- `helpers/postMutations.js`: shared transactions, option locking, and response/correctness guards.
- `helpers/postBlocksSql.js`: shared ordered block/option projection with counts and questioner correctness.
- `helpers/postParticipation.js`: shared participation validation, visibility, locking, and result counts.

## Frontend integration additions

`PATCH /api/posts/:postId` accepts changed `title`, `status` (`private`/`public`),
and/or `block_order` (the complete ordered array of current block UUIDs).
It requires the same edit permission as block mutations, locks the post, and
commits metadata and ordering together. Invalid, duplicate, missing, or foreign
block IDs are rejected; a stale section list returns 409. IDs and all responses
are preserved. The response is `{ success: true, post: { ...metadata } }`.

`GET /api/posts/my` also accepts optional `q` (up to 255 characters). It searches
title and card text case-insensitively before counting and paginating.

`GET /api/posts/:userId` and `GET /api/posts/details/:postId` embed the
current viewer's participation directly in each poll/questioner block. The viewer
is identified only by the optional Bearer token, not by the channel's `userId`.
There is no separate results route or per-block results request. Blocks, options,
selection, and counts are read in the same SQL statement/database snapshot.

`selected_option_ids` contains all saved selections (empty before participation).
`selected_option_id` is set only for exactly one selection; otherwise it is null.
Options always contain
`id`, `block_id`, `position`, `text`, `image_url`, `is_selected`, and `vote_count` or
`answer_count`. Block totals (`total_votes`/`total_answers`) are also returned.
The API no longer includes `percentage`. Counts are intentionally available
before participation so the UI can calculate percentages instantly on click,
but the UI hides results until submission. Questioners with multiple correct
options allow toggling selections and require **Submit answers**; those with one
correct option submit immediately on click. The UI optimistically subtracts the
previous selections (if any) and adds each newly submitted selection, then reconciles with POST response
counts. Removal subtracts the vote and hides results. Failed writes roll back
the optimistic state and try to recover the saved selection through details.

All questioners include `correct_option_ids` and an explicit `is_correct` boolean
on every option, even for anonymous readers and before answering. Block-level
`is_correct` is included only when a saved selection exists. The frontend uses
these preloaded flags to immediately mark the optimistic answer red/green and
show feedback, without first showing a neutral selection. The backend still
validates, saves, and locks the first answer; failures roll back the UI. This
intentionally makes correct options available in the readable post response.
Respondent identities are never returned.

Successful vote/answer POST responses retain their participation result shape,
so the frontend updates the loaded feed without requesting results again.

Blocks returned by details and the public feed now include `has_responses`.
Editors use this to disable question/option edits after responses have arrived;
the existing mutation guards remain authoritative.

The frontend creates metadata as private, appends sections/uploads, and publishes
only after those requests succeed. Multi-request content saves are not atomic:
completed mutations remain saved if a later request fails. The editor checkpoints
returned IDs for retries and preserves pending input. Apply all four migrations
listed at the top of this document before deploying these routes.
