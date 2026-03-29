# Routes → Services split

This pass moved database-heavy and integration-heavy logic out of the route files, so routes now mostly do three things:

1. attach middleware
2. forward the request to a service/handler
3. return the service result

## New/updated service files

- `src/modules/auth/auth.service.js`
- `src/modules/people/people.service.js`
- `src/modules/playlists/playlist.service.js` (extended)
- `src/modules/reports/report.service.js`
- `src/modules/videos/video-route.service.js`
- `src/modules/videos/video-moderation.service.js`

## Result

- route files are now thin and easier to scan
- DB access is no longer embedded directly inside route files for the refactored modules
- Mux, R2, Puppeteer and n8n integration logic is grouped into service-level files

## Suggested next step

A good follow-up would be to split the large service files into:

- `controller` / `handler`
- `service`
- `repository`

That would move SQL into repository files and leave services focused only on orchestration/business rules.
