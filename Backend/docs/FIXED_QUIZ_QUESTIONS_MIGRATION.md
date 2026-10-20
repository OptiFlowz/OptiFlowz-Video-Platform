# Fiksna pitanja i nasumični izvori

Primeni novu migraciju komandom `npm run migrate:deploy`.

- Sve postojeće veze `quiz_questions` postaju fiksna pitanja: svaka ulazi u svaki novi pokušaj.
- `quiz_sources` bira iz cele kategorije u banci vlasnika kviza. Fiksna pitanja istog kviza su isključena iz izbora. `category_id: null` bira pitanja bez kategorije.
- Izvor sada ima obavezan pozitivan `question_count` i `max_points` po pitanju (default 1). `question_percentage` je uklonjen.
- `quizzes.question_count` je izveden broj fiksnih pitanja + zbir source brojeva. POST/PATCH kviza više ne prihvata ovo polje. Novi prazan kviz ima 0 pitanja i ne može započeti pokušaj.
- Dodavanje, izmena i uklanjanje veza/izvora, kao i kaskadno brisanje pitanja ili kategorije, ažuriraju zbir u istoj transakciji.
- `position` određuje zajednički redosled fiksnih pitanja i source blokova. PATCH pomeranje jedne stavke pomera i ostale stavke oba tipa u zahvaćenom rasponu. Na istoj poziciji fiksna pitanja prethode izvorima, uz UUID kao dodatni kriterijum. `shuffle_questions=true` meša ceo izabrani skup.

## Prelazak postojećih podataka

Migracija pretvara procentualne izvore u brojeve koristeći prethodni
`quizzes.question_count` i metod najvećeg ostatka. Kod jednakog ostatka odlučuju
`position`, pa `category_id` (null poslednji), pa ID izvora. Izvori koji dobiju
0 pitanja uklanjaju se jer novi model dozvoljava samo pozitivne brojeve.
Izvori koji već imaju broj zadržavaju ga; preostali ID-jevi izvora se čuvaju.
Novi `max_points` postojećih izvora je 1 — proveri ga ako želiš drugačije bodovanje.

Postojeći skup kandidata se ne smanjuje automatski: sva njegova pitanja su sada
fiksna. Ako su ranije sva pitanja kategorije bila povezana sa kvizom, nema
preostalih kandidata za nasumičan izbor. Ukloni fiksne veze za pitanja koja želiš
da budu nasumična ili smanji/ukloni izvor. Nedovoljno kandidata vraća 422 pri
kreiranju pokušaja. Ukupan broj pitanja može biti veći nego pre migracije jer
se fiksna pitanja sada dodaju broju pitanja iz izvora.

Već kreirani attemptovi, njihovi odgovori, snapshotovi i bodovi ne menjaju se.
Nastavak pokušaja koristi originalni izbor pitanja. Novi pokušaji koriste novu strukturu.

Rollback vraća izvore u prethodni režim tačnih brojeva. Originalni procenti,
uklonjeni izvori sa nultom kvotom i prethodni ručni broj kviza ne rekonstruišu se.

## Primer konfiguracije

POST `/api/quizzes`: `{ "title": "Moj kviz" }`.

Dodaj pet fiksnih pitanja preko POST `/:quizId/questions`, a zatim PUT `/:quizId/sources`:

```json
{
  "sources": [
    { "category_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "question_count": 3, "max_points": 2, "position": 5 },
    { "category_id": null, "question_count": 2, "max_points": 1, "position": 6 }
  ]
}
```

GET kviza vraća `question_count: 10`. GET/PATCH/DELETE pojedinačnog izvora i dalje
koriste `/:quizId/sources/:sourceId`; posle PUT zamene preuzmi nove ID-jeve iz odgovora.
Sve postojeće provere permisija i vlasništva ostaju na snazi.
