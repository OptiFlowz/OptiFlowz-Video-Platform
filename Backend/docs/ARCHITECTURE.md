# EAES Backend Architecture

## Novi raspored

- `src/app.js` – Express aplikacija i globalni middleware-i
- `src/server.js` – bootstrap servera i startup logika
- `src/config/*` – env i CORS konfiguracija
- `src/database/*` – konekcije i helperi za bazu
- `src/middleware/*` – auth, parseri i globalni error handler
- `src/common/*` – zajednički helperi i logovanje
- `src/routes/index.js` – centralno registrovanje svih ruta
- `src/modules/*` – funkcionalni moduli (`auth`, `videos`, `playlists`, `reports`, `people`, `storage`)

## Zašto je ovo lakše za održavanje

Videos module layout:

```text
src/modules/videos/
  video/
    video.routes.js
    video.controller.js
    handlers/
  video-moderation/
    video-moderation.routes.js
    video-moderation.controller.js
    video.middleware.js
    handlers/
  helpers/
  mux.service.js
```

`video/video.routes.js` is mounted at `/api/videos`; `video-moderation/video-moderation.routes.js`
is mounted at `/api/video-moderation`. Shared helpers and the Mux service remain
at the videos module level. Upload middleware belongs to video moderation.

Playlists module layout:

```text
src/modules/playlists/
  playlists/
    playlist.routes.js
    playlist.controller.js
    handlers/
  playlist-moderation/
    playlist-moderation.routes.js
    playlist-moderation.controller.js
    playlist.middleware.js
    handlers/
```

Route and controller filenames are preserved. Playlist upload middleware belongs
to playlist moderation; existing API paths remain unchanged.

1. Infrastruktura više nije pomešana sa biznis logikom.
2. Svaki domen ima svoje rute i servise na jednom mestu.
3. Startup i Express konfiguracija su odvojeni od endpoint logike.
4. Dodavanje novog modula sada traži samo novi folder i registraciju u `src/routes/index.js`.
5. Lakše je postepeno dalje razbijati velike fajlove bez diranja ostatka sistema.

## Resource authorization and shared IP helpers

Video analytics and content management routes authorize resources through
`src/modules/authorization/resource-authorization.js`. Its `ownPermission`
checks still require matching ownership; `anyPermission` and the platform Owner
role allow access to other users' resources. Handlers rely on these route guards
instead of repeating authorization through the former `assertVideoOwner`
helper. New callers must use the same authorization boundary.
Controllers merge URL parameters last so body/query fields cannot substitute a
resource ID after middleware has authorized it. Video visibility checks remain
separate and are still required.

Livestream management uses the same boundary through `requireLiveStreamAccess`.
Edit/thumbnail, deletion and encoder credentials have separate own/any permission
pairs. Controllers pass the guard's resolved resource owner to existing scoped
handlers, so authorized any-access works while SQL remains bound to the approved
stream and owner. This scope is server-provided; the authenticated actor remains
`req.user.sub`. Creation, personal lists, viewer details and playback keep using
the actor's identity. Viewer visibility rules are independent of management access.

`src/common/ip.js` provides `getClientIp`, `normalizeIp`, `hashIp`, `isPrivateIp`,
and `getCountryAndCityFromIp` for videos and playlists. Client IP extraction uses
Express `req.ip` and its configured trust-proxy policy. GeoIP opens the bundled
`data/GeoLite2-City.mmdb` lazily, shares one reader, and returns null location
fields when an address is private, missing, or the lookup fails.

## Sledeći preporučeni koraci

- Razbiti `video.routes.js`, `video-moderation.routes.js` i `report.routes.js` na manje controllere.
- Uvesti zajednički `asyncHandler` i standardizovan format grešaka.
- Dodati testove za servise i integracione testove za glavne rute.
- Uvesti validacione sheme po endpoint grupama, umesto da sve žive u velikim route fajlovima.
