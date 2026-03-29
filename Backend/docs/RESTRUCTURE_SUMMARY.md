# Restructure Summary

## What changed

### Bootstrap and app lifecycle
- `server.js` is now only a thin compatibility entrypoint.
- Main startup logic moved to `src/server.js`.
- Express app creation moved to `src/app.js`.

### Cross-cutting concerns
- Environment loading: `src/config/env.js`
- CORS config: `src/config/cors.js`
- Request parser rules: `src/middleware/request-parsers.js`
- Global error handling: `src/middleware/error-handler.js`
- Auth middleware: `src/middleware/auth.js`
- Database pools: `src/database/index.js`
- Shared logging helper: `src/common/logger.js`

### Domain modules
- Auth: `src/modules/auth/*`
- People: `src/modules/people/*`
- Playlists: `src/modules/playlists/*`
- Reports: `src/modules/reports/*`
- Videos and moderation: `src/modules/videos/*`
- Storage / R2: `src/modules/storage/*`

## Old to new mapping
- `authRoutes.js` -> `src/modules/auth/auth.routes.js`
- `peopleRoutes.js` -> `src/modules/people/people.routes.js`
- `playlistRoutes.js` -> `src/modules/playlists/playlist.routes.js`
- `playlistService.js` -> `src/modules/playlists/playlist.service.js`
- `reportRoutes.js` -> `src/modules/reports/report.routes.js`
- `videoRoutes.js` -> `src/modules/videos/video.routes.js`
- `videoModerationRoutes.js` -> `src/modules/videos/video-moderation.routes.js`
- `videoService.js` -> `src/modules/videos/video.service.js`
- `mux.js` -> `src/modules/videos/mux.service.js`
- `r2.js` -> `src/modules/storage/r2.client.js`
- `db.js` -> `src/database/index.js`
- `middleware.js` -> `src/middleware/auth.js`
- `util.js` -> `src/common/logger.js`

## Additional fixes
- Fixed package entrypoint and dev/start scripts to use `src/server.js`.
- Removed repeated `dotenv.config()` calls from individual modules.
- Fixed missing `R2_ACCOUNT_ID` variable declaration in R2-related files.
