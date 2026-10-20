# Kompletan Quizzes Engine seed

Sva seed logika i podaci nalaze se u jednom fajlu: `quizzes.js`.

Iz Backend direktorijuma:

```powershell
npm run seed:quizzes -- --email aleksandarradojicic0@gmail.com
```

Umesto `--email` može se koristiti `--user-id <uuid>`. Stara komanda
`seed:questions` je alias i sada takođe pravi kompletan kviz.
Konekcija se čita iz `DATABASE_URL` u okruženju ili `.env` fajlu.

Seed u jednoj transakciji pravi:

- Jedan objavljen demo kviz: 10 pitanja po pokušaju, 15 minuta, najviše 3 pokušaja,
  prolaz 70%, obavezno odgovoriti na sva pitanja, partial-credit bodovanje.
- 20 pitanja sa odgovorima i objašnjenjima (8 single choice, 6 multiple choice,
  6 matching). Pitanja prethodnog seeda istog vlasnika prepoznaje po tipu i sadržaju.
- Tri kategorije i dodelu kategorije za svih 20 pitanja.
- Svih 20 veza u `quiz_questions`, sa pozicijama i 1/2/3 poena prema tipu.
- Tri izvora sa raspodelom 40/30/30%: po pokušaju 4/3/3 različita pitanja.
- Dva video requirementa: 50% prvog videa i 30 sekundi drugog
  (ili celo trajanje drugog ako traje manje od 30 sekundi).

Automatski bira dva postojeća javna, objavljena, spremna videa sa poznatim
trajanjem, dajući prednost video zapisima vlasnika. Za tematski odgovarajuće videe
zadaj njihove ID-jeve pri prvom pokretanju:

```powershell
npm run seed:quizzes -- --email aleksandarradojicic0@gmail.com --video-id <prvi-uuid> --video-id <drugi-uuid>
```

Eksplicitno zadati video mora biti dostupan vlasniku kviza i imati poznato trajanje.
Ako nedostaju dva odgovarajuća videa, ceo upis se poništava. Seed ne pravi video
zapise, ne upisuje `watch_progress` i ne pravi niti menja attemptove. Korisnik
mora stvarno da ispuni video uslove pre pokretanja kviza.

Ponovno pokretanje prepoznaje kviz po stabilnom ID-ju vezanom za vlasnika i dopunjava
nedostajuća pitanja, kategorije, dodele kategorija, kandidate, izvore i video requiremente.
Postojeće redove i podešavanja čuva, bez dupliranja ili prepisivanja ručnih izmena.
Na kraju proverava konfiguraciju i ispisuje ID-jeve. Postojeći video requirementi imaju
prednost; opcija `--video-id` bira videe samo za nedostajuće requiremente.
Ako je postojeći kviz ručno izmenjen u neispravnu konfiguraciju, validacija prijavljuje
grešku; seed ga ne resetuje. Ispis sadrži quiz ID, source/category ID-jeve i video ID-jeve
za ručno korišćenje u Postmanu. Provera izbora pitanja radi samo u memoriji.
