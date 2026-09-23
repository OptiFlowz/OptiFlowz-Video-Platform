# Post comments

Apply `1790121600002_add-post-comments.sql` before deploying these routes.
Post comments mirror video comments, using `post_id` instead of `video_id`.
Video-comment routes remain under `/api/comments`; post-comment routes are under
`/api/post-comments`. Top-level listing is on the post route, matching videos.

| Method | Route | Permission | Response |
| --- | --- | --- | --- |
| POST | `/api/post-comments/post` | `comments.create` | 201 `{ success, comment }` |
| GET | `/api/posts/:postId/comments` | Optional authentication | 200 `{ success, comments, page, limit, total, total_pages }` |
| GET | `/api/post-comments/:id/replies` | Optional authentication | 200 `{ success, replies, pagination, sorting, parent_id, post_id }` |
| PATCH | `/api/post-comments/:id/edit` | Author with `comments.edit_own` | 200 `{ success, comment }` |
| DELETE | `/api/post-comments/:id/delete` | Author with `comments.delete_own`, or `comments.moderate` | 200 `{ success, deleted: true }` |
| POST | `/api/post-comments/:id/like` | `comments.react` | 200 `{ success, status, like_count, dislike_count }` |
| POST | `/api/post-comments/:id/dislike` | `comments.react` | 200 `{ success, status, like_count, dislike_count }` |

All mutations require `Authorization: Bearer <token>`. Existing comment
permissions and role grants are reused. The platform Owner has the existing
permission bypass; editing content still requires being the comment author,
matching video comments. URL IDs are authoritative and cannot be replaced by
body or query parameters.

Every operation checks post visibility. Public posts are readable anonymously;
private posts require their author or `posts.update_any`. A comment permission
does not grant access to a private post. Missing/inaccessible posts and missing
or deleted comments return 404; missing authentication returns 401 and missing
permissions return 403. Invalid IDs or content return 400.

## Create a comment or reply

`POST /api/post-comments/post`

```json
{
  "post_id": "12345678-1234-4234-8234-123456789abc",
  "content": "Thanks for sharing!",
  "parent_id": null
}
```

Omit `parent_id` or set it to null for a top-level comment. Supply an existing
comment ID to reply; the parent must belong to the same post and must not be
deleted. Replies can themselves receive replies, as with video comments.
Content is trimmed, required, and limited to 500 characters. The same profanity
moderation applies as for new video comments (blocked content returns 403).
Unknown body fields, including a supplied author ID, are rejected.

Creation/edit responses include `id`, `post_id`, `user_id`, `parent_id`, `content`,
`like_count`, `dislike_count`, `reply_count`, `created_at`, and `updated_at`.

## List top-level comments

`GET /api/posts/:postId/comments?page=1&limit=20&sort=new`

`sort=new` orders newest first. `sort=top` orders by likes, then newest first.
The default page is 1 and limit is 20 (maximum 100). Only non-deleted top-level
comments are returned. `total` counts those comments, excluding replies.
An empty or out-of-range page returns an empty `comments` array.

Every comment/reply in a list contains the comment fields above plus:

```json
{
  "author_full_name": "Alex Example",
  "author_image_url": null,
  "my_reaction": 1
}
```

`my_reaction` is `1` for like, `-1` for dislike, or `null` for no reaction or an
anonymous viewer. This matches video comments and differs from the post's own
`user_reaction` field. Reacting users' identities are not returned.

## List replies

`GET /api/post-comments/:id/replies?page=1&limit=20&sortBy=created_at&sortOrder=asc`

Returns direct, non-deleted replies to the comment. `sortBy` accepts `created_at`
or `like_count`; `sortOrder` accepts `asc` or `desc`. Defaults are oldest first,
page 1, and limit 20 (maximum 100). The response matches video replies:

```json
{
  "success": true,
  "replies": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  },
  "sorting": { "sortBy": "created_at", "sortOrder": "asc" },
  "parent_id": "<comment-id>",
  "post_id": "<post-id>"
}
```

## Edit, delete, and react

PATCH `/api/post-comments/:id/edit` with `{ "content": "Updated comment" }`.
As in the video-comment edit route, content is trimmed and must have 1–2000
characters. Edits preserve the comment ID, replies, and reactions.

DELETE `/api/post-comments/:id/delete` needs no body. It soft-deletes the comment
and updates its timestamp. Deleted comments disappear from lists and cannot
receive edits, reactions, or new replies. Their existing replies remain stored;
the replies endpoint requires a non-deleted parent, matching video comments.

POST either reaction endpoint with no body. Clicking the same reaction again
removes it; clicking the opposite reaction switches it. The response contains
the resulting `status` (`1`, `-1`, or `0`) and persisted totals:

```json
{ "success": true, "status": 1, "like_count": 4, "dislike_count": 1 }
```

Reactions are unique per comment/user. Counters are updated on `post_comments`
in the reaction transaction. Parent `reply_count` is maintained by triggers on
insert, physical deletion, and changes to `parent_id` or `is_deleted`;
`updated_at` is maintained by its own trigger. Mutations lock the post before
the comment to serialize concurrent changes with post editing and deletion.
Physical post/comment/user deletion follows the cascading foreign keys.
