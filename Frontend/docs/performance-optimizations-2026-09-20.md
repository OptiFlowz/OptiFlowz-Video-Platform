# Prvih 10 optimizacija — EAES i OptiFlowz

Datum: 20. septembar 2026. Izmene su lokalne; nije urađen deploy.

## Implementirano na obe platforme

| # | Optimizacija | Rezultat |
|---|---|---|
| 1 | Učitavanje prevoda po potrebi | U početnom paketu ostaje engleski; ostalih 39 jezika učitava se zasebno i kešira. Brze promene jezika, retry i English fallback su pokriveni testovima. |
| 2 | Izdvojena mapa sveta | Veliki SVG skup podataka više nije deo zajedničkih ikonica. Mapa se učitava u analitici i zadržava zoom/pan zadat pre završetka učitavanja. |
| 3 | Player po potrebi | Mux player se učitava tek uz aktivnu video sesiju. Postojeći persistent provider ostaje vlasnik sesije i mini-playera. EAES konfiguracija više ne uvlači player preko zajedničkog React chunka. |
| 4 | Infinite scroll komentara i odloženi odgovori | Uklonjeno duplo preuzimanje celog stabla radi brojanja. Početno stiže 20 glavnih komentara; naredne grupe dopunjavaju listu pri skrolovanju, bez brojeva stranica ili izbora veličine strane. Odgovori se učitavaju pri otvaranju niti i dopunjavaju na isti način. Broj komentara dolazi iz već učitanih video podataka. |
| 5 | Podela CSS-a | Stilovi za analitiku, kvizove, administraciju i editore izdvojeni su uz odgovarajuće komponente. Zastavice više nisu globalni import. Provereno je da su sva pravila i deklaracije sačuvani. |
| 6 | Preview na hover/focus | Animirani preview se traži tek nakon namere korisnika; potpisani URL ostaje neizmenjen. Obične sličice koriste lazy loading. |
| 7 | Sadržaj u početnom HTML-u | Uklonjeno globalno čekanje na mount. EAES prerenderuje početnu stranicu i zadržava SPA fallback; Next šalje javni header i hero u HTML-u. Autorizacija i izbor jezika čekaju hidrataciju gde je potrebno. |
| 8 | Hero slike | Prva slika ima prioritet; ostale se odlažu. OptiFlowz koristi responsive Next Image. Oba slidera zadržavaju prethodnu sliku dok sledeća nije spremna. EAES čisti tajmere i animation frame pozive. |
| 9 | Postepeno učitavanje playlisti | Po 20 videa, sa prikazom svake pristigle strane. Automatski se traže strane potrebne za aktivni video i naslednika; ostalo stiže na scroll. Autoplay više ne zavisi od postojanja DOM elementa sledećeg videa. |
| 10 | Odloženi tabovi i manje ponovljenog rada | Search i channel učitavaju pune liste aktivnog taba. Countovi neaktivnih tabova koriste limit=1, uz keš posećenih tabova. Memoizovani su izvedeni rezultati dugih lista; nepotreban fallback zahtev za videe u postovima je uklonjen. |

## Izmereni rezultat

Početni JavaScript referenciran iz produkcionog HTML-a početne stranice (script i preload/modulepreload, deduplikovano, bez eksternih widget skripti i legacy nomodule paketa):

| Platforma | Pre | Posle | Smanjenje |
|---|---:|---:|---:|
| EAES | 6.588.967 B | 802.347 B | 87,8% |
| OptiFlowz | 6.318.892 B | 734.154 B | 88,4% |

Gzip nivo 9, zbir pojedinačnih lokalnih JS fajlova: EAES 1.984.022 → 269.907 B; OptiFlowz 1.760.284 → 221.903 B. Ovo je poređenje veličine paketa, ne tvrdnja o istom procentu ubrzanja niti merenje produkcionog vremena učitavanja.

U browser scenariju sa 100 glavnih komentara, broj početnih zahteva za komentare/odgovore pao je sa 202 na 1 u oba projekta. Na mobilnom nema tog zahteva dok korisnik ne otvori panel; zatim stiže prva strana.

Neto promena produkcionih TypeScript/TSX fajlova u app direktorijumu, uključujući nove fajlove: EAES −344 linije, OptiFlowz −319 linija. Testovi i CSS nisu uključeni u taj obračun. Sama pojednostavljena logika komentara uklanja 556 linija u EAES-u i 557 u OptiFlowz-u.

## Validacija

- EAES: 115/115 testova; OptiFlowz: 111/111 testova.
- Produkcioni build, TypeScript, provera centralnih boja i git diff --check prolaze u oba projekta.
- Desktop i mobilne browser provere: upload, quizzes, platform settings, search, channel i video; bez JavaScript pageerror događaja.
- Vizuelno provereni početni prikazi i izdvojeni stilovi. Upoređeni skupovi originalnih i izdvojenih CSS pravila/deklaracija.
- Infinite scroll je proveren u browseru na desktopu i mobilnom u oba projekta: 20 → 40 → 45 glavnih komentara i 20 → 25 odgovora, bez gubitka prethodnih redova ili zahteva nakon kraja. Devet testova komentara pokriva dopunu, retry, mutacije, neposredan prikaz novog odgovora, prekid zahteva, mobilne niti i promenu širine ekrana.
- Dodati testovi za lazy jezike, inicijalni render, preview i hero učitavanje, kasno učitanu mapu, komentare/replies, playlist/autoplay i odložene liste.
- Ažurirani zastareli test mockovi i očekivanja; prethodni problemi potvrđeni na čistoj polaznoj verziji.

## Preostala ograničenja i hosting

Browser API odgovori su kontrolisani test podaci. Nije meren produkcioni API, niti je testirano stvarno Mux strimovanje od početka do kraja.

Postojeći playlist API nema lookup pozicije videa. Direktan link na video duboko u playlisti zato mora da učita prethodne strane do tog videa; već pristigli sadržaj prikazuje se odmah.

Countovi neaktivnih tabova i dalje koriste zasebne postojeće endpointove. Smanjen je njihov payload; nije obećano uklanjanje svih poziva. Semantika ukupnog broja komentara pri brisanju prati postojeći backend.

EAES statički hosting mora da sačuva pravila iz public/_redirects: / služi index.html, a ostale aplikacione rute __spa-fallback.html. Postojeći public shell je prerenderovan; liste koje zahtevaju API i prijavljene korisnike i dalje se učitavaju u browseru.

