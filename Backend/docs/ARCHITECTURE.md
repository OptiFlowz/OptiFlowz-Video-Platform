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

1. Infrastruktura više nije pomešana sa biznis logikom.
2. Svaki domen ima svoje rute i servise na jednom mestu.
3. Startup i Express konfiguracija su odvojeni od endpoint logike.
4. Dodavanje novog modula sada traži samo novi folder i registraciju u `src/routes/index.js`.
5. Lakše je postepeno dalje razbijati velike fajlove bez diranja ostatka sistema.

## Sledeći preporučeni koraci

- Razbiti `video.routes.js`, `video-moderation.routes.js` i `report.routes.js` na manje controllere.
- Uvesti zajednički `asyncHandler` i standardizovan format grešaka.
- Dodati testove za servise i integracione testove za glavne rute.
- Uvesti validacione sheme po endpoint grupama, umesto da sve žive u velikim route fajlovima.
