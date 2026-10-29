# Pregled i brisanje pokušaja za vlasnika kviza

Sve rute zahtevaju `Authorization: Bearer <token>`. `quizId` i `attemptId` su UUID.
Odgovori imaju `Cache-Control: private, no-store`.

## Permisije

| Operacija | Sopstveni kvizovi | Svi kvizovi |
| --- | --- | --- |
| Pregled liste i detalja | `quizzes.attempts.read_own` | `quizzes.attempts.read_any` |
| Brisanje pokušaja | `quizzes.attempts.delete_own` | `quizzes.attempts.delete_any` |

`own` označava vlasnika **kviza** (`quizzes.user_id`), a ne korisnika koji je radio
pokušaj. Uploader dobija obe `own` permisije, Administrator sve četiri, a Owner
zadržava globalni bypass. Za prilagođene role potrebno je dodeliti odgovarajuće
permisije. Permisija za pregled ne daje pravo brisanja.

Rute rade i za draft i archived kvizove, kao i za sve statuse pokušaja.
`quizzes.participate` i obične `quizzes.read_*` permisije same po sebi ne daju
pristup ovom pregledu. Postojeći `GET /api/quizzes/:quizId/attempts` i dalje
vraća samo pokušaje prijavljenog učesnika.

## Lista pokušaja svih učesnika

```http
GET /api/quizzes/:quizId/results?page=1&limit=20&sortBy=started_at&sortOrder=desc
```

Opcioni query parametri:

| Parametar | Vrednosti / default |
| --- | --- |
| `user_id` | UUID učesnika čiji pokušaji se traže |
| `status` | `in_progress`, `submitted`, `timed_out`, `cancelled` |
| `passed` | `true` ili `false`; ne uključuje pokušaje sa `passed: null` |
| `page` | Pozitivan ceo broj; default `1` |
| `limit` | Od `1` do `100`; default `20` |
| `sortBy` | `started_at`, `finished_at`, `attempt_no`, `status`, `earned_points`, `score_percentage`; default `started_at` |
| `sortOrder` | `asc` ili `desc`; default `desc` |

Filteri se kombinuju i primenjuju i na `pagination.total`. Sortiranje koristi
`id ASC` kada su vrednosti jednake; `null` vrednosti idu na kraj. Nepostojeći
učesnik ili prazna stranica vraćaju praznu listu, ne grešku.

```json
{
  "success": true,
  "attempts": [
    {
      "id": "attempt-uuid",
      "quiz_id": "quiz-uuid",
      "attempt_no": 1,
      "status": "submitted",
      "started_at": "2026-10-29T10:00:00Z",
      "expires_at": "2026-10-29T10:30:00Z",
      "finished_at": "2026-10-29T10:20:00Z",
      "earned_points": 8,
      "max_points": 10,
      "score_percentage": 80,
      "passed": true,
      "user": { "id": "user-uuid", "full_name": "Ime Prezime", "image_url": null }
    }
  ],
  "pagination": {
    "page": 1, "limit": 20, "total": 1, "totalPages": 1,
    "hasNextPage": false, "hasPreviousPage": false
  },
  "sorting": { "sortBy": "started_at", "sortOrder": "desc" }
}
```

Konačni rezultati se čitaju iz baze, bez ponovnog ocenjivanja. Kod nezavršenog
pokušaja `earned_points`, `score_percentage` i `passed` ostaju `null`;
`max_points` može već biti poznat. `user` sadrži trenutne javne podatke učesnika,
bez email adrese i drugih privatnih polja. Lista ne učitava pitanja i odgovore.

## Detaljan pregled pokušaja

```http
GET /api/quizzes/:quizId/results/:attemptId
```

Vraća `{ "success": true, "attempt": { ... } }`. `attempt` sadrži sva polja
jedne stavke liste, plus:

- `settings`: originalni `settings_snapshot` pokušaja.
- `is_expired`: da li je `expires_at` u prošlosti; ne menja status pokušaja.
- `questions`: sva pitanja, sortirana po `question_no`.

Svako pitanje sadrži `question_no`, `question_id`, `max_points`, kompletan
`question_snapshot`, `answer`, `checked_at`, `updated_at`, `is_correct`,
`awarded_points` i `can_edit: false`.

`question_snapshot` sadrži originalni tekst, tip, objašnjenje i ponuđene odgovore
sa tačnim rešenjima (`options[].is_correct` ili
`matching_items[].correct_option_no`). Izmene ili brisanje originalnog pitanja
ne menjaju snapshot; nakon brisanja originala `question_id` može biti `null`.

Ako odgovor nije sačuvan, `answer` i polja ocenjivanja su `null`. Ako je sačuvan
ali nije proveren, `answer` ostaje dostupan, a `checked_at`, `is_correct` i
`awarded_points` su `null`. GET ne ocenjuje, ne finalizuje i ne menja podatke.

Ovo je ovlašćeni pregled autora: prikazuje sačuvane bodove, tačnost i rešenja
nezavisno od `show_final_score`, `allow_attempt_review` i pravila vidljivosti
feedbacka za učesnika. Ne daje pravo menjanja tuđih odgovora kroz participant rute.

## Brisanje pojedinačnog pokušaja

```http
DELETE /api/quizzes/:quizId/attempts/:attemptId
```

Body nije potreban. Uspeh: `200 { "success": true, "deleted": true }`.

Trajno briše pokušaj bilo kog statusa i njegove redove iz
`quiz_attempt_questions` i `quiz_attempt_answers`. Originalna pitanja i kviz
ostaju. Izdati sertifikati ostaju sa sačuvanim snapshotovima, dok njihova
referenca `quiz_attempt_id` postaje `null`.

Obrisani pokušaj više ne ulazi u `max_attempts` limit. Brojevi preostalih pokušaja
se ne menjaju; sledeći dobija `MAX(attempt_no) + 1` među preostalim pokušajima
(ili `1` ako nema nijednog). Zbog toga broj poslednjeg obrisanog pokušaja može
biti ponovo upotrebljen. Za identitet pokušaja koristiti UUID, ne `attempt_no`.
Brisanje deli transakciono zaključavanje istorije sa kreiranjem pokušaja i
zaključavanje reda sa čuvanjem/proverom odgovora, predajom i expiration workerom.

## Greške i migracija

- `400`: neispravan UUID, filter, sortiranje ili paginacija.
- `401`: korisnik nije autentifikovan.
- `403`: nema odgovarajuću permisiju.
- `404`: kviz nije dostupan autoru, pokušaj ne postoji ili ne pripada kvizu iz URL-a.
- `409` pri brisanju: `ATTEMPT_CONFLICT` kod konkurentne izmene koja zahteva ponavljanje zahteva.

Primeniti novu migraciju
`1793232000000_add-quiz-attempt-management-permissions.sql` preko
`npm run migrate:deploy`. Za zadržavanje izdatih sertifikata potrebna je i
prethodna migracija `1793059200000_certificate-attempt-on-delete-set-null.sql`.

Testovi: `npm run test:quiz-attempt-management` uz `TEST_DATABASE_URL` za
izolovane PostgreSQL/HTTP integracione testove.
