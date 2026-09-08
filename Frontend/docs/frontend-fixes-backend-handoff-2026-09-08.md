**Frontend popravke i preostale backend stavke — 8. septembar 2026.**

Obim prati prvih sedam stavki iz sažetka audita, uz izmene stranice plejliste. Backend je pregledan isključivo za čitanje. Nisu menjani njegovi fajlovi niti je dodavana zamenska backend funkcionalnost u Next.js.

| Stavka iz sažetka | Ishod |
| --- | --- |
| 1. Filteri „My videos“ i „My playlists“ | Nisu implementirani: postojeći backend handler-i nemaju tekstualni filter. Potrebna dopuna backend-a. |
| 2. Paginacija video kolekcija | Implementirana kroz zajednički Pagination, sa postojećim `page`/`limit` API parametrima. Prikazuje se opseg i trenutna strana, bez izmišljenog ukupnog broja. |
| 3. Izolacija privatnog keša | Svaka sesija dobija zaseban QueryClient i novo stablo potrošača. Odjava/promena sesije otkazuje prethodne upite, prazni stari keš i uklanja prethodno stanje plejera/upload-a. |
| 4. Prekid veze i health provera | HTTP greške se prepoznaju. Status veze je odvojen od sadržaja: nema zamene cele aplikacije maintenance ekranom i gubitka otvorene forme zbog health provere. |
| 5. „Remember me“ i profil | Centralizovani čitanje, čuvanje i brisanje sesije. Pretraga saradnika i izmena profila koriste odgovarajući storage. Zakašnjeli odgovor starog naloga ne sme da promeni profil ili odjavi novi nalog. |
| 6. Bezbednosni nalazi | Naziv poglavlja prikazuje se kao tekst. Redirekcija posle prijave prihvata samo interne putanje. Google callback zahteva jednokratni nasumičan `state` iz istog taba, sa rokom važenja; nepripadajući callback se odbija pre slanja koda. PKCE/server-side vezivanje transakcije ostaje backend zadatak. |
| 7. Čuvanje brandinga i homepage podešavanja | Nije implementirano: u pregledanom backend-u nema odgovarajućeg API-ja. Postojeća polja nisu povezana sa izmišljenim endpoint-ima ili lokalnim „lažnim“ čuvanjem. |

Na stranici plejliste uklonjeni su spoljni background, okvir, senka i padding kartice oko slike i informacija; unutrašnji raspored i video kartice ostaju. Opis se može više puta proširiti i skratiti, sa `aria-expanded` i `aria-controls`. Sve nove UI boje koriste postojeće CSS promenljive. Novi tekstovi dodati su svim postojećim jezicima.

**Za backend agenta: filteri.** Postojeći `GET /api/video-moderation/my/videos` čita `page`, `limit`, `sort_by` i `sort_dir`; count i lista ograničeni su na `uploaded_by`, bez tekstualne pretrage. `GET /api/playlists-moderation/my/playlists` čita `page`, `limit`, `sort` i `order`; count i lista ograničeni su na `created_by`, takođe bez tekstualne pretrage. Potrebno je dogovoriti i podržati query parametar za tekst (na primer `q`), sa istim uslovom u count i list upitu. Rezultati moraju ostati ograničeni na dozvoljeni nalog; sortiranje i paginacija treba da važe za filtrirani skup. Nakon toga frontend može da poveže postojeća polja uz debounce i reset strane. Trenutno nije napravljeno filtriranje samo učitane strane, jer bi davalo nepotpune rezultate.

Dokaz: [getMyVideos.js](</Users/stefan/Github Projects/OptiFlowz-Video-Platform/Backend/src/modules/videos/video-moderation/handlers/getMyVideos.js>) i [getMyPlaylists.js](</Users/stefan/Github Projects/OptiFlowz-Video-Platform/Backend/src/modules/playlists/playlist-moderation/handlers/getMyPlaylists.js>).

**Za backend agenta: konfiguracija platforme.** U registraciji ruta nisu pronađeni endpoint-i za čitanje/čuvanje brandinga, opisa platforme, logo/brand guide fajlova, tema, vidljivosti homepage sekcija ili redosleda hero slika. Potrebno je definisati ugovor, pravo upravljanja konfiguracijom, trajno čuvanje i javnu konfiguraciju koju frontend može da učita. Ne menjati postojeći API za uloge zbog ove stavke: Access & Roles već ima svoj funkcionalan tok.

Dokaz: [registracija backend ruta](</Users/stefan/Github Projects/OptiFlowz-Video-Platform/Backend/src/routes/index.js>) i [postojeći frontend branding](</Users/stefan/Github Projects/OptiFlowz-Video-Platform/Frontend/app/components/platformPage/settingsPages/brandingAndAppearance.tsx>).

**Za backend agenta: Google OAuth.** Postojeći handler prihvata `code` i poziva `googleClient.getToken(code)`. Nema ugovora za `code_verifier` niti serverskog vezivanja pokrenute transakcije sa callback-om. Frontend sada proverava svoj nasumični state pre razmene; to ne dodaje zaštitu direktnom pozivanju backend endpoint-a. Za PKCE treba koordinisano dodati podršku verifier-u u razmeni koda, a zatim frontend challenge/verifier tok. Ne uključivati challenge pre nego što backend podrži razmenu, jer bi se pokvarila postojeća prijava.

Dokaz: [OAuth handler](</Users/stefan/Github Projects/OptiFlowz-Video-Platform/Backend/src/modules/auth/handlers/oAuthLogin.js>).

**Opciona dopuna backend-a: metadata paginacije.** Trending, continue watching, liked, history i recommendations podržavaju `page`/`limit`, ali ne vraćaju `total` ili `has_next`. Frontend zato omogućava sledeću stranu kada je tekuća puna. Ako je ukupan broj tačan umnožak veličine strane, poslednji pokušaj može vratiti praznu stranu, sa dostupnim povratkom. Dodavanje pouzdanog `has_next` ili ukupnog broja uklonilo bi tu neizvesnost. Trenutna popravka ne zahteva backend izmenu.

Provere: `npm test` prolazi sa 17 testova; `npm run typecheck` i `npm run check:colors` prolaze. Production build prošao je u zasebnoj privremenoj kopiji frontend-a, bez lokalnih `.env` fajlova, kako se ne bi prepisivao `.next` aktivnog dev servera. U Edge-u je provereno proširivanje/skraćivanje opisa i uklanjanje kartice. Testovi sa lokalnim DOM-om proveravaju drugu stranu kolekcije, izolaciju naloga, otkazivanje starih upita, health/401 greške, očuvanje forme, bezbednu redirekciju i OAuth state. Prava Google prijava, veliki upload i backend pisanja nisu izvršavani.

Nova test zavisnost je `jsdom` (samo devDependency); testovi se pokreću preko postojećeg Node test runner-a i TypeScript kompajlera. Izmene auth/session toka namerno prazne prethodno stanje pri odjavi ili promeni naloga; health proveravanje ga čuva.
