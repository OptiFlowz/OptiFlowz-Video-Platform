# Prelazak sa grupa na kategorije pitanja

Ovaj dokument opisuje prethodnu migraciju. Posle migracije fiksnih pitanja,
izvori koriste samo broj i bodove, a pitanje se bira iz cele kategorije.
Aktuelni ugovor je u `QUIZZES_ENGINE_FRONTEND_GUIDE.md`, odeljci 6–8.

Pokretanje nove migracije:

```sh
npm run migrate:deploy
```

Migracija preimenuje `question_groups` u `question_categories` i dodaje
`questions.category_id`. Pitanje može pripadati jednoj kategoriji ili biti bez
kategorije. Za postojeća pitanja sa više članstava zadržava se prva kategorija
po nazivu, a zatim po ID-ju ako su nazivi jednaki. Ostala članstva se uklanjaju.
ID-jevi kategorija ostaju isti. Preimenovanje permisija čuva njihove ID-jeve i
postojeće dodele rolama. Stari snapshotovi pokušaja ostaju nepromenjeni.

## Promene API-ja

- `/api/quizzes/question-groups` postaje `/api/quizzes/question-categories`,
  sa `:categoryId` u rutama za pojedinačnu kategoriju.
- Pitanje se kreira ili menja kroz `category_id: "uuid"` ili `category_id: null`.
  Izostavljen `category_id` u PATCH-u zadržava postojeću kategoriju.
- Lista i detalji pitanja vraćaju `category: { id, name }` ili `category: null`.
  Filter liste je `category_id`, umesto `group_id`.
- PUT `/:categoryId/questions` zamenjuje članove kategorije. Poslata pitanja se
  premeštaju iz prethodne kategorije, a izostavljena postojeća pitanja ostaju bez
  kategorije. Pitanja se ne brišu.
- Permisije `question_groups.*` postaju `question_categories.*`.
- Izvori kviza koriste `category_id`. Vrednost `null` označava isključivo pitanja
  bez kategorije, koja su istovremeno kandidati u `quiz_questions`.
- Izvor ima samostalni `id`. GET, PATCH i DELETE pojedinačnog izvora koriste
  `/api/quizzes/:quizId/sources/:sourceId`. Posle PUT-a cele raspodele koristi
  nove ID-jeve iz odgovora.

Primer raspodele sa 20% pitanja bez kategorije:

```json
{
  "sources": [
    { "category_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "question_percentage": 80 },
    { "category_id": null, "question_percentage": 20 }
  ]
}
```

Svi izvori i dalje koriste isti režim: procente sa zbirom 100 ili tačne brojeve
sa zbirom `quizzes.question_count`. Jedan kviz može imati najviše jedan izvor
bez kategorije. Ista kategorija može biti navedena samo jednom.

Posle migracije proveri raspoloživost pitanja za postojeće izvore: uklanjanje
dodatnih članstava može smanjiti broj kandidata neke kategorije. Ako kvota ne
može da se ispuni, kreiranje pokušaja vraća 422; kvota se ne popunjava pitanjima
iz drugih kategorija.

Brisanje kategorije ostavlja pitanja bez kategorije i uklanja njene source
veze. Ako preostali izvori narušavaju zbir raspodele, postojeća validacija
odbija brisanje; prvo prilagodi raspodelu izvora.

Rollback vraća samo trenutno članstvo pitanja. Uklonjena dodatna članstva se
ne mogu rekonstruisati. Izvore bez kategorije potrebno je ukloniti pre rollback-a.
