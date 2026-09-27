# Livestream frontend

The UI uses the sibling Backend's existing livestream and shared video APIs. No new provider credentials or frontend environment variables are needed.

## Entry points

- `/live`: public published broadcasts, search, status filters and pagination.
- `/my-livestreams`: the signed-in creator's events, including private ones.
- `/live/new`: create an event with visibility, playback policy, standard/DVR mode, planned start and duration limit.
- `/live/:videoId/studio`: metadata, artwork, encoder credentials, settings, viewer count, analytics, ending/cancelling and deletion.
- `/channel/:channelId/live`: the channel's public broadcasts.
- `/video/:videoId`: waiting screen, live player or the existing recording player after finalization. The same link works throughout the event.

Navigation and management actions use the backend's `livestreams.*` and `analytics.livestream_*` permissions. Viewing the main live library requires authentication, as required by its API. The channel listing uses the public channel endpoint.

## Backend prerequisites

Apply the three livestream migrations documented in `../../Backend/docs/livestream-schema.md`, including the lifecycle migration. Configure the existing Mux credentials, signing settings and Mux webhook endpoint on the backend. The lifecycle scheduler runs in the API process. See `../../Backend/src/modules/livestreams/README.md` for deployment details and limits.

## Broadcast workflow

1. Open **My livestreams → Create livestream**. Public events are published immediately; the planned date only announces the event, it does not start the encoder.
2. Upload artwork and open **Get encoder credentials**. Copy the RTMPS server and stream key into OBS's custom streaming service.
3. Start broadcasting from OBS. Details refresh every 10 seconds on the watch page; studio/list updates run every 15 seconds. Standard mode plays at the live edge; DVR enables rewinding.
4. Use **End broadcast** to finish permanently. Stopping the encoder alone may first enter the reconnect window. Once the backend finalizes the recording, the watch page switches to the regular player.
5. Finalized recordings support the existing editor, progress, notes and chapter features. Active broadcasts send watch-time heartbeats without saving a recording resume position.

Stream keys are fetched only on request, kept in component memory, masked by default and cleared when ingest becomes unavailable or playback access changes. Changing playback access before starting replaces the backend stream: fetch new credentials afterward. Mutation requests are not automatically retried.

## Manual integration checks

With a test event and encoder, check private/public visibility, permission-restricted actions, scheduled → live → reconnecting → ended transitions, DVR seeking, signed URL renewal and finalized replay. Check thumbnail upload, reactions, comments and concurrent viewers from a separate viewer session. Confirm that ending/deleting an event updates the lists, and that mobile layouts and the footer align with other content.

No actual OBS broadcast or provider-side mutation was performed during frontend implementation.
