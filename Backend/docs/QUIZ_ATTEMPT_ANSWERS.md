# Čuvanje i provera odgovora pokušaja

`PUT /api/quiz-attempts/:attemptId/answers/:questionNo`

Zahteva `Authorization: Bearer <token>`, permisiju `quizzes.participate` i
`Content-Type: application/json`. Korisnik mora biti vlasnik pokušaja, uključujući
korisnike sa Owner rolom. `attemptId` je UUID, a `questionNo` pozitivan redni broj
iz `quiz_attempt_questions`, ne ID originalnog pitanja.

Ruta prihvata samo pokušaj u statusu `in_progress` kojem vreme nije isteklo.
Istek se proverava prema vremenu PostgreSQL servera. `expires_at = NULL` znači da
nema vremenskog ograničenja. Trenutni status kviza i njegove naknadne izmene ne
menjaju podešavanja već započetog pokušaja.

## Request body

Single choice:

```json
{ "answer": { "option_no": 2 } }
```

Multiple choice:

```json
{ "answer": { "option_nos": [1, 3] } }
```

Matching:

```json
{
  "answer": {
    "pairs": [
      { "item_no": 1, "option_no": 2 },
      { "item_no": 2, "option_no": 1 },
      { "item_no": 3, "option_no": 2 }
    ]
  }
}
```

- Šalju se stabilni `option_no` / `item_no` iz snapshota, ne pozicije u prikazu.
- Multiple choice zahteva bar jednu opciju, bez duplikata.
- Matching zahteva tačno jedno povezivanje za svaki item. Nepotpuni odgovori se
  odbijaju bez upisa. Više itema sme koristiti istu opciju.
- Sve oznake moraju postojati u snapshotu konkretnog pitanja. Brojevi se šalju
  kao JSON brojevi, ne stringovi. Nepoznate osobine nisu dozvoljene.
- Klijent ne šalje tip pitanja, bodove, tačnost, `checked_at` ili podešavanja.
- PUT zamenjuje ceo odgovor za jedno pitanje. Prazan odgovor ne služi za brisanje.

## Provera i izmene

Svaki validan odgovor, za sva tri tipa, proverava se odmah. Upisuju se `answer`,
`checked_at`, `is_correct`, `awarded_points` i `updated_at`.
Tačni odgovori i objašnjenje dolaze isključivo iz `question_snapshot`, težina iz
`quiz_attempt_questions.max_points`, a podešavanja iz `settings_snapshot`.

Ako je `allow_answer_changes_after_check = false`, drugačiji odgovor nakon prve
provere vraća `409 ANSWER_LOCKED`. Identičan ponovljeni PUT vraća `200` i isti
sačuvani rezultat, bez promene timestampova. Redosled elemenata u `option_nos` i
`pairs` ne predstavlja promenu odgovora.

Ako je podešavanje `true`, svaki novi odgovor se ponovo čuva i proverava.
Prethodni odgovor bez `checked_at` sme se zameniti i kada je podešavanje `false`.
Postojeći default u konfiguraciji kviza je **false**; ova ruta ga ne menja.

## Bodovanje

`exact_match`: maksimalni bodovi samo za potpuno tačan odgovor, inače nula.
Kod multiple choice moraju biti izabrane sve tačne i nijedna netačna opcija;
kod matching sva povezivanja moraju biti tačna.

`partial_credit`:

- Single choice: isto kao `exact_match`.
- Multiple choice: `max_points × max(0, C/T − W/F)`, gde je `C` broj izabranih
  tačnih opcija, `T` ukupan broj tačnih, `W` broj izabranih pogrešnih, a `F`
  ukupan broj pogrešnih. Ako su sve opcije tačne (`F = 0`), kazneni deo je nula.
- Matching: `max_points × broj_tačnih_povezivanja / ukupan_broj_itema`.

Bodovi se jednom zaokružuju na dve decimale, pola centa naviše. `is_correct`
označava potpuno tačan odgovor, čak i kada se za netačan odgovor dodele delimični
bodovi. Ruta ne ažurira konačni rezultat pokušaja.

## Odgovor i dozvoljeni feedback

Prvi upis i kasnije izmene vraćaju `200 OK`:

```json
{
  "success": true,
  "attempt_id": "7b72a061-48a3-43db-b987-de31db8ad258",
  "question_no": 1,
  "answer": { "option_nos": [1] },
  "checked_at": "2026-10-20T12:00:00.000Z",
  "updated_at": "2026-10-20T12:00:00.000Z",
  "feedback": {
    "is_correct": false,
    "awarded_points": 1.5,
    "explanation": "Objašnjenje sačuvano uz pitanje."
  }
}
```

Ovaj primer podrazumeva `correctness_visibility = after_check`,
`explanation_visibility = after_check` i odgovarajuće delimično bodovanje.

Svako feedback podešavanje radi nezavisno:

| Podešavanje sa vrednošću `after_check` | Polje u `feedback` |
| --- | --- |
| `correctness_visibility` | `is_correct` i `awarded_points` |
| `correct_answers_visibility` za choice pitanja | `correct_answers.options: [{ option_no, is_correct }]` za sve opcije |
| `correct_answers_visibility` za matching | `correct_answers.matching_items: [{ item_no, correct_option_no }]` za sve iteme |
| `explanation_visibility` | `explanation`, koji može biti `null` |

`explanation_incorrect_only = true` dodatno skriva objašnjenje za potpuno tačan
odgovor. Kod delimičnih bodova odgovor je i dalje netačan, pa se objašnjenje može
prikazati. Naziv ovog postojećeg polja nije promenjen.

Vrednosti `never` i `after_finish` ne otkrivaju odgovarajuća polja kroz ovu PUT
rutu. Nedozvoljena polja se potpuno izostavljaju; ako ništa nije dozvoljeno,
odgovor sadrži `feedback: {}`. Bodovi prate vidljivost tačnosti jer mogu otkriti
rezultat. `show_final_score` ne otkriva bodove pojedinačnih pitanja.

Zajednički formatter `publicAttemptAnswer` koristi se i za ponovno
učitavanje: završeni `submitted`/`timed_out` pokušaji prikazuju `after_check` i
`after_finish` feedback samo uz `allow_attempt_review = true`; `never` ostaje
skriven. `cancelled` pokušaji ne prikazuju feedback. Dostupnost GET rute po
statusima opisana je ispod; formatter sam po sebi ne odobrava pristup pokušaju.

Odgovori imaju `Cache-Control: private, no-store`.

## Greške

| Status / kod | Značenje |
| --- | --- |
| `400` | Neispravan path ili body; `INVALID_ANSWER` za neispravan sadržaj odgovora |
| `401` | Korisnik nije autentifikovan |
| `403` | Nema permisiju `quizzes.participate` |
| `404 ATTEMPT_NOT_FOUND` | Pokušaj ne postoji ili pripada drugom korisniku |
| `404 ATTEMPT_QUESTION_NOT_FOUND` | Pitanje ne postoji u tom pokušaju |
| `409 ATTEMPT_NOT_IN_PROGRESS` | Pokušaj je završen ili otkazan |
| `409 ATTEMPT_EXPIRED` | Vreme je isteklo; odgovor nije upisan |
| `409 ANSWER_LOCKED` | Izmena već proverenog odgovora je zabranjena |
| `409 ATTEMPT_CONFLICT` | Konflikt transakcija; zahtev može da se ponovi |
| `422 INVALID_ATTEMPT_QUESTION` / `INVALID_ATTEMPT_SETTINGS` | Sačuvan snapshot ne podržava validno bodovanje |

Greške handlera imaju oblik `{ "success": false, "message": "...", "code": "..." }`;
kod nije prisutan kod svih validacionih ili middleware grešaka.

Čuvanje zaključava red pokušaja u transakciji pre čitanja prethodnog odgovora.
To sprečava da paralelni prvi zahtevi zaobiđu zabranu izmene. Rok se ponovo
proverava neposredno pri upisu. Automatska finalizacija u zajedničkom workeru
koristi isto zaključavanje, postojeći obračun sačuvanih bodova i status `timed_out`.
Podrazumevano obrađuje do 250 pokušaja po prolazu, na 30 sekundi.
Istek odmah blokira čuvanje; status se upisuje kada worker obradi pokušaj.
Detalji: [shared worker](../src/workers/README.md).

## Učitavanje pitanja sa sačuvanim odgovorima

`GET /api/quiz-attempts/:attemptId/questions`

Zahteva isti Bearer token, `quizzes.participate` i vlasništvo pokušaja kao PUT.
Body nije potreban. Vraća sva pitanja, bez paginacije, sortirana po `question_no`.
Redosled ponuđenih opcija i matching itema čuva se iz snapshota, uključujući
mešanje koje je urađeno pri kreiranju pokušaja.

| Stanje pokušaja | Rezultat |
| --- | --- |
| `in_progress`, vreme nije isteklo | `200`, pitanja i dozvoljeni `after_check` feedback |
| `in_progress`, vreme isteklo, `allow_attempt_review = true` | `200`, pregled bez izmena; dozvoljeni `after_check` i `after_finish` feedback |
| `submitted` / `timed_out`, `allow_attempt_review = true` | `200`, isti režim pregleda |
| Istekao / `submitted` / `timed_out`, `allow_attempt_review` nije `true` | `403 ATTEMPT_REVIEW_NOT_ALLOWED` |
| `cancelled` | `409 ATTEMPT_NOT_IN_PROGRESS` |

Pristup pre isteka ne zavisi od `allow_attempt_review`. `expires_at = NULL` nema
rok; poređenje roka koristi vreme baze. Nedostajući ili tuđi pokušaj vraća
`404 ATTEMPT_NOT_FOUND`, neispravan UUID `400`.

Odgovor uključuje `settings` iz snapshota pokušaja. Za `submitted` i `timed_out`
vraća i `result` (`id`, `status`, `max_points`, `earned_points`, `score_percentage`,
`passed`, `settings`); konačni poeni i prolaz ostaju `null` kada je `show_final_score`
isključen. Pregled koristi sačuvane odgovore i ocene, bez ponovnog bodovanja ili izmena.

Primer odgovora za pitanje bez sačuvanog odgovora:

```json
{
  "success": true,
  "attempt_id": "7b72a061-48a3-43db-b987-de31db8ad258",
  "status": "in_progress",
  "expires_at": "2026-10-20T12:30:00.000Z",
  "is_expired": false,
  "questions": [
    {
      "question_no": 1,
      "question_id": "37ad3950-d0a0-42bb-96d6-952e9305ea2c",
      "type": "single_choice",
      "content": "Koji odgovor je tačan?",
      "max_points": 3,
      "options": [
        { "option_no": 2, "content": "Odgovor B", "position": 1 },
        { "option_no": 1, "content": "Odgovor A", "position": 2 }
      ],
      "matching_options": [],
      "matching_items": [],
      "answer": null,
      "checked_at": null,
      "updated_at": null,
      "feedback": {},
      "can_edit": true
    }
  ]
}
```

Za matching se vraćaju `matching_options: [{ option_no, content, position }]` i
`matching_items: [{ item_no, content, position }]`, uz prazan `options` niz.
`question_id` može biti `null` ako je originalno pitanje obrisano; njegov snapshot
ostaje dostupan. `max_points` je težina pitanja iz pokušaja.

`answer` sadrži sačuvani objekat u istom formatu kao PUT. `checked_at` pokazuje da
li je odgovor ocenjen, a `updated_at` vreme čuvanja odgovora. Bez odgovora oba
vremena su `null`. Sačuvan, ali neocenjen odgovor se vraća sa praznim `feedback`.

Feedback ima identičan oblik kao u PUT ruti i nastaje pozivom istog formattera.
Tačna rešenja i objašnjenje ne postoje u osnovnom objektu pitanja ili ponuđenim
opcijama; pojavljuju se samo u dozvoljenim poljima `feedback`. Neodgovorena i
neocenjena pitanja ne otkrivaju feedback ni u režimu pregleda.

`can_edit` je `true` samo dok je pokušaj aktivan i nije istekao, i kada odgovor
još nije ocenjen ili je `allow_answer_changes_after_check = true`. U pregledu je
uvek `false`. Frontend može koristiti ovo polje za UI, ali PUT ponovo proverava
status, rok i zaključavanje pri svakom čuvanju.

GET koristi jedan upit nad primarnom bazom za dosledan prikaz pokušaja, pitanja i
poslednjih odgovora. Ne ocenjuje ponovo, ne menja timestampove, rezultate niti
status. Zato istekli pokušaj može i dalje imati `status: "in_progress"`, uz
`is_expired: true`; za feedback se tretira kao završen uz dozvolu pregleda.
Odgovor koristi `Cache-Control: private, no-store`.

## Predaja pokušaja

`POST /api/quiz-attempts/:attemptId/submit`

Body nije potreban. Zahteva autentifikaciju, `quizzes.participate` i vlasništvo
pokušaja. Samo `in_progress` pokušaj kome vreme nije isteklo može da se preda.

Predaja koristi pitanja i već sačuvane ocene pokušaja, bez ponovnog ocenjivanja:

- `total_questions`: stvarni broj redova u `quiz_attempt_questions`.
- `answered_questions`: broj odgovora sa `checked_at IS NOT NULL`.
- `correct_questions`: broj ocenjenih odgovora sa `is_correct = true`.
- Oba minimalna procenta računaju se prema **svim pitanjima**, ne samo odgovorenim.
- Pragovi `min_answered_percentage` i `min_correct_percentage` uzimaju se iz
  `settings_snapshot` i porede bez zaokruživanja. Na primer, 1 od 3 pitanja
  ispunjava prag 33.33%, ali ne 33.34%.

Ako neki uslov nije ispunjen, vraća se `409` i kod
`MIN_ANSWERED_PERCENTAGE_NOT_MET` ili `MIN_CORRECT_PERCENTAGE_NOT_MET`.
Status, vreme završetka i rezultati pokušaja ostaju neizmenjeni. Ako su oba praga
nula, dozvoljena je predaja bez odgovora, uz nula osvojenih bodova.

Uspešna predaja u jednoj transakciji upisuje:

- `status = submitted` i `finished_at` prema trenutnom vremenu baze.
- `earned_points`: zbir `awarded_points` ocenjenih odgovora; neodgovorena i
  neocenjena pitanja doprinose nulom.
- `max_points`: zbir težina **svih** pitanja iz `quiz_attempt_questions`.
- `score_percentage`: `earned_points / max_points * 100`, zaokruženo na dve decimale.
- `passed`: poređenje sačuvanog procenta sa `settings_snapshot.passing_score_percentage`.

Vraća `200 OK` i jedan attempt objekat na vrhu odgovora, uz `success: true`.
Polja su ista kao za jedan element `attempts` niza u
`GET /api/quizzes/:quizId/attempts`:

```json
{
  "success": true,
  "id": "7b72a061-48a3-43db-b987-de31db8ad258",
  "quiz_id": "6305aac5-08be-4aa7-bc7d-0e485d3c9bcb",
  "attempt_no": 1,
  "status": "submitted",
  "started_at": "2026-10-20T12:00:00.000Z",
  "expires_at": "2026-10-20T12:30:00.000Z",
  "finished_at": "2026-10-20T12:20:00.000Z",
  "max_points": 10,
  "earned_points": 7.5,
  "score_percentage": 75,
  "passed": true,
  "settings": {
    "min_answered_percentage": 100,
    "min_correct_percentage": 0,
    "passing_score_percentage": 70,
    "show_final_score": true
  }
}
```

`settings` je u primeru skraćen; ruta vraća ceo sačuvani `settings_snapshot`.
Kada je `show_final_score = false`, `earned_points`, `score_percentage` i `passed`
u odgovoru su `null`, ali su stvarne vrednosti upisane u bazu. Pitanja, odgovori
i broj tačnih pitanja se ne vraćaju u submit odgovoru.

Ostale greške: `400` neispravan UUID, `401` bez autentifikacije, `403` bez
permisije, `404 ATTEMPT_NOT_FOUND` za nepostojeći ili tuđ pokušaj,
`409 ATTEMPT_NOT_IN_PROGRESS` za završen/otkazan pokušaj,
`409 ATTEMPT_EXPIRED` za istek, `409 ATTEMPT_CONFLICT` za konflikt transakcija,
`422 INVALID_ATTEMPT_SETTINGS` za neispravna podešavanja i
`422 INVALID_ATTEMPT_RESULTS` za prazan skup pitanja ili neispravne ocene/težine.

Submit zaključava isti red pokušaja kao PUT odgovora i ponovo proverava rok pri
upisu. Ponovljeni submit već predatog pokušaja vraća `409`, a dalja izmena
odgovora nije dozvoljena. Istek se ovom rutom ne finalizuje automatski.
Odgovor ima `Cache-Control: private, no-store`.
