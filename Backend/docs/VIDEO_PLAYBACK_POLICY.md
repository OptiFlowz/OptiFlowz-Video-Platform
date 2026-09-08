# Update video playback policy

Apply the database migration before using this endpoint:

```sh
npm run migrate -- up
```

`PATCH /api/video-moderation/:videoId/playback-policy`

Requires authentication and the existing video update authorization: permission
to update one's own video, permission to update any video, or the application owner role.

```json
{ "playback_policy": "signed" }
```

Only `public` and `signed` are accepted. A successful response is:

```json
{
  "success": true,
  "id": "video-uuid",
  "playback_policy": "signed",
  "mux_playback_id": "new-mux-playback-id",
  "changed": true
}
```

When the policy already matches, `changed` is false and no new playback ID is
created. Video visibility is independent of playback policy.

Changes create a Mux playback ID, commit it with the new policy, then delete the
previous ID. Existing playback and image URLs using the previous ID become invalid;
clients should fetch fresh playback and media URLs after changing the policy.

The nullable `mux_playback_id_pending_deletion` column retains the old ID until
deletion succeeds. A deletion failure returns HTTP 502 with code
`PLAYBACK_CLEANUP_PENDING` and `success: false`; the new policy has been saved, but the old ID may
still work. Retry the same request to finish deletion without creating another ID.
Cleanup is request-driven; there is no background worker. Row locks serialize
updates and cleanup for the video. Delayed asset-ready webhooks preserve the
stored playback ID.

Mux and PostgreSQL cannot share an atomic transaction. An ambiguous Mux creation
or database commit failure may require reconciliation of the asset's playback IDs;
the handler never deletes a replacement after attempting to commit it.

Mux API reference: [Create a playback ID](https://www.mux.com/docs/api-reference/video/assets/create-asset-playback-id).
