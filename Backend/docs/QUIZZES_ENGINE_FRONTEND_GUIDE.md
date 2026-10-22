# Quizzes Engine — vodič za frontend

Provereno prema kodu: **20. oktobar 2026.**

Ovaj dokument pokriva banku pitanja, kategorije, kvizove, povezivanje pitanja sa
kvizom, izvore pitanja i video requiremente, uključujući proveru i prikaz napretka
gledanja. Podmodul `quiz-attempts` je izostavljen.

Ugovori u ovom dokumentu odgovaraju trenutnim routes, controller, validation i
repository fajlovima u `src/modules/quizzes-engine/`. Posebno su obuhvaćene
novije promene: `category: { id, name } | null`, filter `category_id` i permisije `_own`/`_any`.

## Sadržaj

1. [Model podataka i ekrani](#1-model-podataka-i-ekrani)
2. [Zajednički API ugovor](#2-zajednički-api-ugovor)
3. [Autentifikacija i permisije](#3-autentifikacija-i-permisije)
4. [Banka pitanja — Questions](#4-banka-pitanja--questions)
5. [Kategorije — Question Categories](#5-kategorije--question-categories)
6. [Kvizovi — Quizzes](#6-kvizovi--quizzes)
7. [Fiksna pitanja — Quiz Questions](#7-fiksna-pitanja--quiz-questions)
8. [Izvori — Quiz Sources](#8-izvori--quiz-sources)
9. [Video uslovi — Quiz Requirements](#9-video-uslovi--quiz-requirements)
10. [Tokovi rada i osvežavanje podataka](#10-tokovi-rada-i-osvežavanje-podataka)
11. [Primer frontend klijenta](#11-primer-frontend-klijenta)
12. [Greške i ograničenja](#12-greške-i-ograničenja)
13. [Kontrolna lista za integraciju](#13-kontrolna-lista-za-integraciju)

## 1. Model podataka i ekrani

| Pojam | Namena | Šta frontend uređuje |
| --- | --- | --- |
| Question | Originalno pitanje u banci | Tip, sadržaj, objašnjenje, odgovore i kategorije |
| Question category | Organizacija banke pitanja | Naziv, opis i skup članova |
| Quiz | Podešavanja kviza | Naslov, status, bodovanje i feedback opcije |
| Quiz question | Veza kviza i originalnog pitanja | Položaj i maksimalne poene za taj kviz |
| Quiz source | Kvota jedne kategorije u kvizu | Kategoriju, položaj, broj pitanja i bodove po pitanju |
| Quiz requirement | Obavezan video uslov | Video, položaj i minimalno gledanje |

Jedno pitanje može pripadati najviše jednoj kategoriji (ili nijednoj) i biti povezano sa više kvizova.
Dodavanje pitanja u kategoriju **ne dodaje** ga automatski u `quiz_questions`.
Dodavanje kategorije u `quiz_sources` takođe **ne povezuje** njena pitanja sa kvizom.
Svaka veza u `quiz_questions` je fiksno pitanje uključeno u svaki pokušaj. Izvor bira iz cele kategorije u banci, isključujući sva fiksna pitanja tog kviza.

Praktična podela UI-ja:

- **Banka pitanja:** lista, filteri, kreiranje i editor pitanja.
- **Kategorije:** lista, detalji i izbor članova.
- **Editor kviza:** podešavanja, kandidati, izvori i video uslovi kao odvojeni tabovi.
- **Prikaz video uslova za učesnika:** status ispunjenosti i kartice videa.

## 2. Zajednički API ugovor

### 2.1. Base URL i headers

Sve putanje u nastavku imaju prefiks **`/api/quizzes`**.
Na primer, `/questions` znači `GET https://<server>/api/quizzes/questions`.

```http
Authorization: Bearer <access-token>
Accept: application/json
Content-Type: application/json
```

`Content-Type` je potreban kada šalješ JSON body. Sve rute u ovom vodiču zahtevaju
autentifikaciju. Privremeni 2FA token nije access token. UUID vrednosti u primerima
zameni stvarnim ID-jevima iz odgovora servera.

### 2.2. Response envelope

Podaci su neposredno na vrhu odgovora; ne postoji zajednički `data` omotač:

```json
{
  "success": true,
  "question": {
    "id": "11111111-1111-4111-8111-111111111111"
  }
}
```

Ovo je skraćen primer envelope-a; stvarna polja pitanja navedena su u odeljku 4.

| Operacija | HTTP status | Dodatna polja uz `success: true` |
| --- | --- | --- |
| Kreiranje resursa/veze | 201 | `question`, `category`, `quiz`, `quiz_question`, `source` ili `requirement` |
| GET pojedinačnog resursa | 200 | Odgovarajuće jedninsko polje |
| Lista | 200 | Odgovarajući niz, `pagination`, `sorting` |
| PATCH | 200 | Ažuriran resurs u jedninskom polju |
| PUT članova kategorije | 200 | `category`, `question_ids` |
| PUT izvora kviza | 200 | `sources` |
| DELETE | 200 | `deleted: true` |

DELETE ne vraća 204. Uspešno brisanje izgleda ovako:

```json
{
  "success": true,
  "deleted": true
}
```

### 2.3. Paginacija i sortiranje

Sve paginirane liste koriste iste parametre:

| Query | Tip | Default | Pravilo |
| --- | --- | --- | --- |
| `page` | Ceo broj | 1 | Najmanje 1 |
| `limit` | Ceo broj | 20 | 1–100 |
| `sortBy` | String iz allowliste | Zavisno od liste | Vidi odgovarajući odeljak |
| `sortOrder` | `asc` ili `desc` | `asc` | Mala slova |

Primer liste pitanja:

```json
{
  "success": true,
  "questions": [],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 0,
    "totalPages": 0,
    "hasNextPage": false,
    "hasPreviousPage": false
  },
  "sorting": {
    "sortBy": "created_at",
    "sortOrder": "asc"
  }
}
```

`total` računa filtriran skup dostupan korisniku. Strana iza poslednje vraća prazan
niz, ali zadržava stvarni `total`. `hasPreviousPage` je `page > 1`, čak i za praznu
stranu. Prazan skup ima `totalPages: 0`.

API nema `offset` query. Za jednake vrednosti sortiranja koristi dodatni stabilni
UUID kriterijum. Pri promeni filtera ili sortiranja u UI-ju vrati `page` na 1.
Za izbor svih članova ili izvora učitaj **sve strane**, ne samo prvih 20/100.

### 2.4. Body, PATCH i prazne vrednosti

- Body brojevi su JSON brojevi, booleani su `true`/`false`; ne šalji string `"50"`.
- Query parametri putuju kao stringovi; `page` i `limit` backend pretvara u brojeve.
- Šeme za body i query odbijaju nepoznata polja. Ne šalji ceo response nazad u PATCH.
- `id`, `user_id`, timestampovi, `category` i ugnježdeni prikazni objekti nisu edit polja.
- PATCH zahteva bar jedno dozvoljeno polje. Izostavljeno znači „sačuvaj postojeće“.
- `null` možeš poslati samo za polja koja su eksplicitno nullable.
- Prazni nizovi često znače „ukloni sve“; detalji su navedeni uz svaku rutu.
- Ne šalji prazan filter `category_id=` ili `quiz_id=`; izostavi ga ako nije izabran.
- Datum parsiraj kao ISO datum. Odgovori mogu imati `Z` ili vremenski offset i
  različitu preciznost razlomka sekunde; ne poredi sirove timestamp stringove.

## 3. Autentifikacija i permisije

### 3.1. Permisije za autorske ekrane

| Resurs | Kreiranje | Čitanje | Izmena | Brisanje |
| --- | --- | --- | --- | --- |
| Kviz | `quizzes.create` | `quizzes.read_own` / `quizzes.read_any` | `quizzes.update_own` / `quizzes.update_any` | `quizzes.delete_own` / `quizzes.delete_any` |
| Pitanje | `questions.create` | `questions.read_own` / `questions.read_any` | `questions.update_own` / `questions.update_any` | `questions.delete_own` / `questions.delete_any` |
| Kategorija | `question_categories.create` | `question_categories.read_own` / `question_categories.read_any` | `question_categories.update_own` / `question_categories.update_any` | `question_categories.delete_own` / `question_categories.delete_any` |

`*_own` važi za resurse vlasnika jednakog prijavljenom korisniku. `*_any` dozvoljava
rad nad resursima drugih korisnika; globalne liste tada vraćaju sve dostupne vlasnike.
Ne postoji dodatni `user_id` query filter na ovim listama. Nemoj pretpostaviti da
je administratorska lista ograničena na sopstvene resurse.

Kreiranje uvek postavlja prijavljenog korisnika kao vlasnika. Čak ni sa `_any`
permisijom ne prosleđuješ `user_id` u create body-ju. Pri uređivanju tuđeg resursa
backend zadržava njegovog vlasnika.

**Owner ima sve permisije** kroz serversku proveru `hasPermission`. Početni grantovi
iz migracije daju Viewer-u `quizzes.participate`, Uploader-u autorske `_own` permisije
i participate, Administrator-u sve navedene permisije. Stvarni grantovi mogu biti
izmenjeni, pa UI ne treba da odlučuje samo na osnovu imena role.

### 3.2. Permisije za podresurse kviza

| Operacija | Permisija |
| --- | --- |
| Čitanje kandidata, izvora i autorskih video requirementa | `quizzes.read_own` ili `quizzes.read_any` |
| Dodavanje/izmena/uklanjanje kandidata, izvora i requirementa | `quizzes.update_own` ili `quizzes.update_any` |
| PUT članova kategorije | `question_categories.update_own` ili `question_categories.update_any` |
| Provera i napredak gledanja za učesnika | `quizzes.participate` |

Pravo na uređivanje kviza ne omogućava povezivanje pitanja/kategorija drugog vlasnika.
**Kviz, kandidati i source kategorije moraju imati istog vlasnika.** Isto pravilo važi
za pitanje i njegove kategorije. Za video requiremente važe posebna pravila dostupnosti
videa iz odeljka 9.

### 3.3. Autorski GET i status `published`

Autorske GET rute za kvizove, pitanja, kategorije, kandidate i izvore zahtevaju autorske
read permisije. `published` ne pretvara te rute u javni katalog. Na njima je dozvoljen
i rad sa draft/archived kvizovima u okviru ovlašćenja.

Rute `check` i `progress` za video requiremente koriste prijavljenog učesnika i rade
samo za `published` kviz. Draft i archived vraćaju 404 čak i vlasniku na tim rutama.
Autorska lista requirementa ostaje dostupna uz read permisiju.

## 4. Banka pitanja — Questions

Pitanje ima `max_points`: pozitivan broj do 99999999.99, sa najviše dve decimale.
POST podrazumeva `1`, PATCH menja vrednost samo kada je poslata, a GET pojedinačnog
pitanja, liste i pitanja unutar kategorije vraćaju ovu vrednost.

Uvoz/izvoz banke preko Moodle XML-a: [ugovor, primeri i ograničenja](QUESTIONS_MOODLE_IMPORT_EXPORT.md).

### 4.1. Rute

| Metoda | Putanja | Rezultat |
| --- | --- | --- |
| POST | `/questions/import` | 201, `{ success, imported_count, questions, warnings }` |
| GET | `/questions/export` | 200, XML attachment |
| POST | `/questions` | 201, `{ success, question }` |
| GET | `/questions` | 200, `{ success, questions, pagination, sorting }` |
| GET | `/questions/:questionId` | 200, `{ success, question }` |
| PATCH | `/questions/:questionId` | 200, `{ success, question }` |
| DELETE | `/questions/:questionId` | 200, `{ success, deleted: true }` |

### 4.2. Polja i validacije

| Polje | Kreiranje | Pravilo |
| --- | --- | --- |
| `type` | Obavezno | `single_choice`, `multiple_choice`, `matching` |
| `content` | Obavezno | String, trimuje se; CRUD dozvoljava prazan draft |
| `explanation` | Default `null` | String ili null; trimuje se |
| `options` | Default `[]` | Odgovori choice pitanja |
| `matching_options` | Default `[]` | Ponuđeni odgovori za matching |
| `matching_items` | Default `[]` | Stavke koje treba povezati |
| `category_id` | Opciono | UUID jedne kategorije istog vlasnika ili null |

Choice opcija: `{ option_no, content, is_correct, position }`.
`is_correct` je opcion i default je `false`. Matching opcija:
`{ option_no, content, position }`. Matching stavka:
`{ item_no, content, correct_option_no, position }`.

`option_no` i `item_no` su celi brojevi 1–32767, jedinstveni unutar svog niza.
`position` je ceo broj 1–2147483647. Pozicije mogu imati praznine; nisu identifikatori.
Opcije/stavke se prikazuju po `position`, a pri jednakim pozicijama po svom broju.
Prilikom drag-and-drop promene čuvaj brojeve opcija/stavki, menjaj pozicije.

Choice pitanje ne sme imati neprazne matching nizove. Matching pitanje ne sme imati
neprazan `options`. Svaki `correct_option_no` mora referencirati `option_no` ponuđenog
odgovora istog pitanja. Više matching stavki sme koristiti istu tačnu opciju.

CRUD dozvoljava nepotpuna pitanja za editor. Za upotrebljivo pitanje proveri u UI-ju:

- Popunjen tekst pitanja i svih poslatih opcija/stavki.
- Single choice: tačno jedan tačan odgovor.
- Multiple choice: najmanje jedan tačan odgovor.
- Matching: najmanje jedna opcija i jedna stavka, sa validnim povezivanjem.

Ne postoji zasebno `status`/`published` polje pitanja niti ruta za aktivaciju pitanja.

### 4.3. POST — single choice primer

```http
POST /api/quizzes/questions
```

```json
{
  "type": "single_choice",
  "content": "Koji HTTP status označava da resurs nije pronađen?",
  "explanation": "404 označava Not Found.",
  "options": [
    {
      "option_no": 1,
      "content": "200",
      "is_correct": false,
      "position": 1
    },
    {
      "option_no": 2,
      "content": "404",
      "is_correct": true,
      "position": 2
    }
  ],
  "matching_options": [],
  "matching_items": [],
  "category_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}
```

Sačuvaj `response.question.id` za kasnije povezivanje sa kvizom.

### 4.4. POST — multiple choice primer

```json
{
  "type": "multiple_choice",
  "content": "Koji HTTP statusi pripadaju uspešnim odgovorima?",
  "explanation": "Uspešni statusi su u opsegu 2xx.",
  "options": [
    {
      "option_no": 1,
      "content": "200",
      "is_correct": true,
      "position": 1
    },
    {
      "option_no": 2,
      "content": "201",
      "is_correct": true,
      "position": 2
    },
    {
      "option_no": 3,
      "content": "404",
      "is_correct": false,
      "position": 3
    }
  ],
  "category_id": null
}
```

Koristi isti POST endpoint. Nije potrebno slati neprimenljive prazne nizove.

### 4.5. POST — matching primer

```json
{
  "type": "matching",
  "content": "Poveži status sa značenjem.",
  "explanation": "200 je uspeh, a 404 znači da resurs nije pronađen.",
  "matching_options": [
    {
      "option_no": 10,
      "content": "Uspešan zahtev",
      "position": 1
    },
    {
      "option_no": 20,
      "content": "Resurs nije pronađen",
      "position": 2
    }
  ],
  "matching_items": [
    {
      "item_no": 1,
      "content": "200",
      "correct_option_no": 10,
      "position": 1
    },
    {
      "item_no": 2,
      "content": "404",
      "correct_option_no": 20,
      "position": 2
    }
  ],
  "category_id": null
}
```

### 4.6. GET lista i filter po kategoriji

```http
GET /api/quizzes/questions?category_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&type=single_choice&page=1&limit=20&sortBy=created_at&sortOrder=desc
```

| Parametar | Opcije / značenje |
| --- | --- |
| `type` | Opciono: `single_choice`, `multiple_choice`, `matching` |
| `category_id` | Opcion UUID jedne kategorije; ne menja postojeći owner scope |
| `sortBy` | `created_at` (default), `updated_at`, `content`, `type` |
| `sortOrder` | `asc` (default), `desc` |

Filteri se kombinuju sa AND. Svako pitanje ima najviše jednu kategoriju.
`category` sadrži njen `id` i `name`, ili je null. Nepostojeća kategorija
ili kategorija bez pitanja u dozvoljenom owner scope-u daje praznu listu, ne 404.
Neispravan UUID je 400. Nema query parametra za pretragu teksta pitanja.

Stavka liste ima: `id`, `user_id`, `type`, `content`, `explanation`, `created_at`,
`updated_at`, `category`. Lista ne sadrži nizove opcija/stavki; za editor učitaj detalje.

### 4.7. GET detalji i izlazni format kategorija

GET pojedinačnog pitanja, POST i PATCH vraćaju isti detaljni oblik:

```json
{
  "success": true,
  "question": {
    "id": "11111111-1111-4111-8111-111111111111",
    "user_id": "99999999-9999-4999-8999-999999999999",
    "type": "single_choice",
    "content": "Koji HTTP status označava da resurs nije pronađen?",
    "explanation": "404 označava Not Found.",
    "created_at": "2026-10-20T08:00:00Z",
    "updated_at": "2026-10-20T08:00:00Z",
    "options": [
      {
        "option_no": 1,
        "content": "200",
        "is_correct": false,
        "position": 1
      },
      {
        "option_no": 2,
        "content": "404",
        "is_correct": true,
        "position": 2
      }
    ],
    "matching_options": [],
    "matching_items": [],
    "category": {
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "name": "HTTP osnove"
    }
  }
}
```

Izlaz je `category: { id, name } | null`, a ulaz za uređivanje `category_id`:

```ts
const body = { category_id: question.category?.id ?? null };
```

Bez kategorije dobijaš `category: null`. Tačni odgovori i objašnjenje u detaljima
namenjeni su autorskom editoru; read permisija daje pristup tom prikazu.

### 4.8. PATCH — sadržaj, odgovori i članstva

Samo promena teksta:

```json
{
  "content": "Izmenjen tekst pitanja",
  "explanation": null
}
```

Promena kategorija:

```json
{
  "category_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
}
```

`category_id` izostavljen čuva postojeću kategoriju; `null` uklanja dodelu kategorije.
Svaki poslati niz `options`, `matching_options` ili `matching_items` zamenjuje taj
ceo niz; to nije dopuna jedne stavke. Kod promene `type`, svi izostavljeni nizovi
odgovora prazne se, dok izostavljeni tekst i objašnjenje ostaju.

Pri uklanjanju matching opcije ukloni ili preveži sve stavke koje je referenciraju
u **istom PATCH-u**. Backend proverava spojeno konačno stanje i rollback-uje neuspešan upis.

### 4.9. DELETE

Briše originalno pitanje, njegove odgovore, članstva i veze sa kvizovima.
Za uklanjanje samo iz konkretnog kviza koristi DELETE veze iz odeljka 7.
Posle brisanja osveži listu pitanja, otvorene kategorije i kandidate relevantnih kvizova.

## 5. Kategorije — Question Categories

### 5.1. Rute

| Metoda | Putanja | Rezultat |
| --- | --- | --- |
| POST | `/question-categories` | 201, `{ success, category }` |
| GET | `/question-categories` | 200, `{ success, categories, pagination, sorting }` |
| GET | `/question-categories/:categoryId` | 200, `{ success, category }`, uključuje `category.questions` |
| PATCH | `/question-categories/:categoryId` | 200, `{ success, category }` |
| DELETE | `/question-categories/:categoryId` | 200, `{ success, deleted: true }` |
| PUT | `/question-categories/:categoryId/questions` | 200, `{ success, category, question_ids }` |

### 5.2. Kreiranje, izmena i lista

POST primer:

```json
{
  "name": "HTTP osnove",
  "description": "Pitanja o HTTP metodama i statusima"
}
```

`name` je obavezan trimovan string 1–255 karaktera. `description` je opcion
trimovan string ili null, default null. Isti vlasnik ne može imati dve kategorije istog
naziva prema DB unique ograničenju; duplikat je 409. Različiti vlasnici mogu.

PATCH prihvata `name` i/ili `description`. Za brisanje opisa pošalji
`{ "description": null }`. Članstvo ne uređuješ kroz ovaj PATCH.

GET lista: opcioni `name` traži podstring, bez razlikovanja velikih/malih slova.
`%` i `_` se tretiraju kao tekst, ne wildcard. `sortBy`: `name` (default) ili `id`;
`sortOrder`: `asc` (default) ili `desc`, uz zajednički `page` i `limit`.

Primer: `GET /api/quizzes/question-categories?name=HTTP&page=1&limit=20&sortBy=name&sortOrder=asc`.
Stavke ove liste imaju samo `id`, `user_id`, `name`, `description`.

### 5.3. Detalji kategorije i njena pitanja

```json
{
  "success": true,
  "category": {
    "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "user_id": "99999999-9999-4999-8999-999999999999",
    "name": "HTTP osnove",
    "description": "Pitanja o HTTP metodama i statusima",
    "questions": [
      {
        "id": "11111111-1111-4111-8111-111111111111",
        "user_id": "99999999-9999-4999-8999-999999999999",
        "type": "single_choice",
        "content": "Koji HTTP status označava da resurs nije pronađen?",
        "explanation": "404 označava Not Found.",
        "created_at": "2026-10-20T08:00:00Z",
        "updated_at": "2026-10-20T08:00:00Z",
        "category": {
          "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          "name": "HTTP osnove"
        }
      }
    ]
  }
}
```

`category.questions` je ceo nepaginiran niz, sortiran po `created_at ASC`, pa `id ASC`.
Prazna kategorija vraća `questions: []`. Svako pitanje ima svoju `category` sa ID-jem
i nazivom, ali nema nizove odgovora. Detalje za editor učitaj sa `/questions/:questionId`.

POST/PATCH kategorije i PUT članstava vraćaju osnovni objekat `category` bez `questions`.
Ne pretpostavljaj da svaki response sa poljem `category` sadrži pun detaljni oblik.

### 5.4. PUT — zamenjuje kompletno članstvo

```http
PUT /api/quizzes/question-categories/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/questions
```

```json
{
  "question_ids": [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"
  ]
}
```

Sva pitanja moraju imati istog vlasnika kao kategorija. Duplikati se uklanjaju.
`{ "question_ids": [] }` prazni kategoriju. Izostavljen `question_ids` je greška 400.
Poslata pitanja se **premeštaju iz prethodne kategorije**. Izostavljena pitanja dobijaju `category_id = null`. Ako je neki ID nepostojeći ili tuđ,
dobijaš 404 i ceo upis se poništava.

Odgovor sadrži osnovni `category` i konačni `question_ids` sortiran po UUID-u; to nije
UI redosled pitanja. Ova veza nema `position` niti rutu za reordering.

### 5.5. DELETE

Briše kategoriju i postavlja `questions.category_id` njenih pitanja na null, čuvajući originalna pitanja. Brišu se i source veze
ka kategoriji. Ukupan broj pitanja pogođenih kvizova automatski se smanjuje za uklonjene izvore. Fiksne veze ostaju.

## 6. Kvizovi — Quizzes

### 6.1. Rute

| Metoda | Putanja | Rezultat |
| --- | --- | --- |
| POST | `/` | 201, `{ success, quiz }` |
| GET | `/` | 200, `{ success, quizzes, pagination, sorting }` |
| GET | `/:quizId` | 200, `{ success, quiz }` |
| PATCH | `/:quizId` | 200, `{ success, quiz }` |
| DELETE | `/:quizId` | 200, `{ success, deleted: true }` |

POST/GET `/` znače `/api/quizzes`, bez dodatnog `/quizzes` segmenta.

### 6.2. Podešavanja i default vrednosti

`questions_per_page` određuje željeni broj pitanja po stranici na frontendu. Backend ga čuva i vraća, ali ne paginira pitanja prema toj vrednosti. Novi attempt ga kopira u `settings_snapshot`; promena kviza ne menja postojeće snapshotove. Za stare attemptove bez tog polja frontend može koristiti 1.

Podešavanja su dostupna u create body-ju i PATCH-u, osim izvedenog `question_count`. Samo `title` je obavezan prilikom kreiranja. `question_count` je samo izlazno polje i ne šalje se u POST/PATCH.

| Polje | Tip / dozvoljene vrednosti | Default |
| --- | --- | --- |
| `title` | Trimovan string, 1–255 karaktera | Obavezno |
| `description` | Trimovan string ili null | null |
| `status` | `draft`, `published`, `archived` | `draft` |
| `question_count` | Samo čitanje: broj fiksnih + zbir source brojeva | 0 |
| `questions_per_page` | Pozitivan ceo broj; informativan broj pitanja po stranici | 1 |
| `time_limit_seconds` | Pozitivan ceo broj ili null | null |
| `max_attempts` | Pozitivan ceo broj ili null | null |
| `passing_score_percentage` | Broj 0–100, do dve decimale | 50 |
| `shuffle_questions` | Boolean | true |
| `shuffle_options` | Boolean | true |
| `has_certificate` | Boolean | false |
| `min_answered_percentage` | Broj 0–100, do dve decimale | 0 |
| `min_correct_percentage` | Broj 0–100, do dve decimale | 0 |
| `correctness_visibility` | Feedback enum | `after_finish` |
| `correct_answers_visibility` | Feedback enum | `after_finish` |
| `explanation_visibility` | Feedback enum | `after_finish` |
| `explanation_incorrect_only` | Boolean | false |
| `allow_answer_changes_after_check` | Boolean | false |
| `allow_attempt_review` | Boolean | true |
| `show_final_score` | Boolean | true |
| `scoring_mode` | `exact_match`, `partial_credit` | `exact_match` |

Pozitivni celi brojevi su 1–2147483647. `null` za vreme/broj dozvoljenih pokušaja
znači bez tog ograničenja. `question_count` se automatski računa kao broj fiksnih pitanja + zbir `question_count` izvora. Prazan kviz ima 0; pokretanje takvog kviza vraća 422.

Feedback enum za sva tri visibility polja:

| Vrednost | Značenje konfiguracije |
| --- | --- |
| `never` | Ne prikazuj tu vrstu feedback-a |
| `after_check` | Prikaz nakon provere odgovora |
| `after_finish` | Prikaz nakon završetka |

`correctness_visibility` kontroliše informaciju da li je odgovor tačan;
`correct_answers_visibility` tačne odgovore; `explanation_visibility` objašnjenje.
`explanation_incorrect_only` dodatno ograničava objašnjenje na netačne odgovore.
`min_answered_percentage` i `min_correct_percentage` su konfiguracioni pragovi za
predaju; nisu zamena za prag prolaznosti `passing_score_percentage`.

Ove CRUD rute čuvaju i vraćaju konfiguraciju. Sam upis `has_certificate: true` ne
generiše sertifikat. Ovaj vodič ne definiše izvršavanje feedback-a niti formule
bodovanja; ne implementiraj serversko bodovanje na osnovu same vrednosti enum-a.

### 6.3. POST primer sa svim podešavanjima

```json
{
  "title": "HTTP i osnove weba",
  "description": "Kviz za proveru osnovnih pojmova.",
  "status": "draft",
  "time_limit_seconds": 900,
  "max_attempts": 3,
  "passing_score_percentage": 70,
  "shuffle_questions": true,
  "shuffle_options": true,
  "has_certificate": false,
  "min_answered_percentage": 100,
  "min_correct_percentage": 0,
  "correctness_visibility": "after_check",
  "correct_answers_visibility": "after_finish",
  "explanation_visibility": "after_check",
  "explanation_incorrect_only": true,
  "allow_answer_changes_after_check": false,
  "allow_attempt_review": true,
  "show_final_score": true,
  "scoring_mode": "partial_credit"
}
```

Odgovor `quiz` sadrži sva podešavanja iz tabele, plus `id`, `user_id`, `created_at`,
`updated_at`. Isto važi za stavke liste i GET/PATCH pojedinačnog kviza.
GET detalja kviza ne ugrađuje kandidate, izvore ili video uslove; učitaj njihove rute.

### 6.4. Lista kvizova

```http
GET /api/quizzes?title=HTTP&status=draft&page=1&limit=20&sortBy=updated_at&sortOrder=desc
```

Filteri: opcioni `title` (podstring, case-insensitive, literalni wildcard karakteri)
i `status`. `sortBy`: `created_at` (default), `updated_at`, `title`, `status`,
`question_count`, `passing_score_percentage`. Default smer je `asc`.
Sort statusa prati DB enum redosled; ne oslanjaj se na abecedni red.

### 6.5. PATCH i objavljivanje

```json
{
  "title": "Novi naslov",
  "status": "published"
}
```

Status se menja običnim PATCH-om; nema posebne publish rute. I POST može primiti
`published`. Postavljanje tog statusa trenutno **nije kompletna validacija spremnosti
kviza**: ne garantuje dovoljan broj validnih kandidata niti izvodljive kategorijske kvote.
Frontend treba da omogući pripremu draft-a i pre objavljivanja prikaže provere
iz odeljka 10.

Slanje `question_count` u POST/PATCH kviza vraća 400. Veličinu menjaj dodavanjem/uklanjanjem fiksnih pitanja ili izmenom brojeva u sources.

### 6.6. DELETE

Brisanje kviza uklanja njegove kandidate, izvore i video requiremente; originalna
pitanja, kategorije i videi ostaju. Druge reference u bazi mogu blokirati DELETE;
kontroler nemapiranu DB grešku vraća kao generički 500. Nemoj pretpostaviti da svaki
neuspeh brisanja ima posebno definisan 409 odgovor. Za povlačenje iz upotrebe dostupan
je PATCH sa `status: "archived"`.

## 7. Fiksna pitanja — Quiz Questions

### 7.1. Rute

| Metoda | Putanja | Rezultat |
| --- | --- | --- |
| POST | `/:quizId/questions` | 201, `{ success, quiz_question }` |
| GET | `/:quizId/questions` | 200, `{ success, questions, pagination, sorting }` |
| GET | `/:quizId/questions/:questionId` | 200, `{ success, quiz_question }` |
| PATCH | `/:quizId/questions/:questionId` | 200, `{ success, quiz_question }` |
| DELETE | `/:quizId/questions/:questionId` | 200, `{ success, deleted: true }` |

Ovde `questions` predstavlja listu **veza**, različitu od liste banke pitanja.
Identitet veze čine `(quiz_id, question_id)`; nema zaseban `id`.

### 7.2. Dodavanje fiksnog pitanja

```http
POST /api/quizzes/33333333-3333-4333-8333-333333333333/questions
```

```json
{
  "question_id": "11111111-1111-4111-8111-111111111111",
  "position": 0,
  "max_points": 2.5
}
```

`question_id` je obavezan UUID pitanja istog vlasnika kao kviz. `position` je ceo broj
0–2147483647, default 0. `max_points` je JSON broj > 0 i <= 99999999.99, do dve
decimale. Ako ga izostaviš, kopira se trenutni `questions.max_points`. Eksplicitna
vrednost ima prednost. Kasnija izmena pitanja u banci ne menja bodove već povezanih
pitanja u kvizovima niti snapshotove pokušaja. Nula poena nije dozvoljena.

Isto pitanje može biti povezano sa različitim kvizovima, ali ne dva puta sa istim:
ponovljeno dodavanje vraća 409. Za više pitanja šalješ više POST zahteva; ne postoji
bulk-create endpoint za fiksna pitanja.

```json
{
  "success": true,
  "quiz_question": {
    "quiz_id": "33333333-3333-4333-8333-333333333333",
    "question_id": "11111111-1111-4111-8111-111111111111",
    "position": 0,
    "max_points": 2.5,
    "question": {
      "id": "11111111-1111-4111-8111-111111111111",
      "type": "single_choice",
      "content": "Koji HTTP status označava da resurs nije pronađen?",
      "explanation": "404 označava Not Found."
    }
  }
}
```

GET pojedinačne veze i PATCH vraćaju isti oblik. `question` je skraćen objekat,
bez `category`, timestampova i odgovora. Za otvaranje editora originalnog pitanja
učitaj `/questions/:questionId` uz odgovarajuću question read permisiju.

### 7.3. Lista, izmena i uklanjanje

GET lista ima zajedničku paginaciju i `sortBy`: `position` (default), `max_points`,
`question_id`; `sortOrder`: `asc` (default) ili `desc`. Nema dodatnih filtera.

Svaki element GET liste dodatno sadrži `question.category: { "id": "uuid-kategorije",
"name": "Naziv kategorije" }`. Ako pitanje nema kategoriju, vrednost je `null`.

PATCH menja `position` i/ili `max_points`:

```json
{
  "position": 1,
  "max_points": 3
}
```

Ne menja `question_id` niti sadržaj originalnog pitanja. Za drag-and-drop pošalji
jedan PATCH za pomereno pitanje, sa njegovom novom `position`, pa ponovo učitaj
obe liste. Ostala fiksna pitanja i source blokovi u zahvaćenom rasponu pomeraju se automatski:

- Sa veće na manju poziciju (npr. 4 → 1): pitanja na pozicijama `[1, 4)` dobijaju `+1`.
- Sa manje na veću (npr. 1 → 4): pitanja na pozicijama `(1, 4]` dobijaju `-1`.
- Ista pozicija ili PATCH samo za `max_points`: redosled ostaje isti.

Promene su u jednoj transakciji; paralelne izmene istog kviza se serijalizuju.
`max_points` ostalih pitanja se ne menja. Odgovor i dalje vraća samo izmenjenu
vezu kao `quiz_question`. Ne postoji posebna bulk reorder ruta.
Pozicije kreću od 0, za razliku od odgovora unutar pitanja čije pozicije kreću od 1.
Jednake pozicije su dozvoljene; za liste dodatni kriterijum je `question_id ASC`.
Postojeće rupe i jednake pozicije se ne normalizuju. Već započeti pokušaji
zadržavaju sačuvani redosled pitanja.

DELETE briše **samo vezu**, čuva originalno pitanje i njegova članstva.
Dodavanje/uklanjanje fiksnog pitanja automatski menja `quiz.question_count`. Posle promene osveži detalje kviza i obe liste stavki. Broj pitanja u izvorima se ne menja; dostupnost se proverava pri pokretanju.

## 8. Izvori — Quiz Sources

Izvor predstavlja blok nasumičnih pitanja iz **cele kategorije istog vlasnika**.
Pitanja iz izvora ne dodaju se u `quiz_questions`. Sva fiksna pitanja tog kviza
isključena su iz nasumičnog izbora. Jedno pitanje se pojavljuje najviše jednom po pokušaju.

### 8.1. Rute

| Metoda | Putanja | Rezultat |
| --- | --- | --- |
| POST | `/:quizId/sources` | 201, `{ success, source }` |
| PUT | `/:quizId/sources` | 200, `{ success, sources }` |
| GET | `/:quizId/sources` | 200, `{ success, sources, pagination, sorting }` |
| GET | `/:quizId/sources/:sourceId` | 200, `{ success, source }` |
| PATCH | `/:quizId/sources/:sourceId` | 200, `{ success, source }` |
| DELETE | `/:quizId/sources/:sourceId` | 200, `{ success, deleted: true }` |

`sourceId` je samostalni `source.id`, različit od `category_id`.

### 8.2. Polja i primeri

| Polje | Pravilo | Default |
| --- | --- | --- |
| `category_id` | Obavezan UUID kategorije ili null za pitanja bez kategorije | Nema |
| `question_count` | Obavezan pozitivan ceo broj, najviše 2147483647 | Nema |
| `max_points` | Broj >0, do 99999999.99, najviše dve decimale; `null` preuzima bodove svakog pitanja iz banke | 1 |
| `position` | Položaj bloka, ceo broj 0–2147483647 | 0 |

`question_percentage` više ne postoji i njegovo slanje vraća 400.
`category_id: null` bira isključivo pitanja bez kategorije u banci vlasnika kviza.
Jedna kategorija i null mogu se pojaviti najviše jednom u izvorima istog kviza.

Primer POST body-ja:

```json
{
  "category_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "question_count": 3,
  "max_points": 2,
  "position": 1
}
```

Primer PUT body-ja:

```json
{
  "sources": [
    { "category_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "question_count": 3, "max_points": 2, "position": 1 },
    { "category_id": null, "question_count": 2, "max_points": 1, "position": 3 }
  ]
}
```

Uz 5 fiksnih pitanja ovaj primer daje `quiz.question_count = 10`.
Zbir izvora se ne poredi sa unapred zadatim brojem kviza: backend računa zbir.
Odgovor za svaki izvor sadrži `id`, `quiz_id`, sva četiri polja iz tabele i
`category: { id, name, description } | null`.

### 8.3. Izmena i brisanje

`max_points: null` koristi `questions.max_points` svakog izabranog pitanja u trenutku kreiranja pokušaja. Eksplicitan broj nadjačava bodove iz banke. Ako polje izostaviš pri kreiranju izvora, ostaje default `1`. Izabrani bodovi se čuvaju u `quiz_attempt_questions.max_points` i kasnije izmene banke ili izvora ne menjaju postojeći pokušaj.

PATCH prihvata `question_count`, `max_points` i `position`; izostavljena polja se
čuvaju. `category_id` se menja zamenom izvora kroz PUT ili DELETE + POST.
Promena pozicije pomera ostala fiksna pitanja i source blokove u zahvaćenom rasponu.
Posle pomeranja osveži obe liste. `max_points` ostalih stavki se čuva.

PUT šalje kompletan `sources` niz (0–1000 stavki) i atomski zamenjuje sve izvore.
`{ "sources": [] }` ostavlja samo fiksna pitanja. PUT pravi nove source ID-jeve.
DELETE uklanja samo izvor; kategorija, originalna pitanja i fiksne veze ostaju.
Svaka izmena broja izvora automatski ažurira broj pitanja i `updated_at` kviza.

### 8.4. Lista i redosled

GET lista: `page` od 1, `limit` 1–100 (default 20), `sortBy`:
`position` (default), `id`, `category_id`, `max_points`, `question_count`;
`sortOrder`: `asc` (default) ili `desc`. NULL vrednosti su poslednje, dodatni redosled `id ASC`.

Editor može spojiti liste fiksnih pitanja i izvora u jedan prikaz po `position`.
Kod jednakih pozicija fiksno pitanje ide pre source bloka, a zatim odlučuje UUID.
Ako je `shuffle_questions=false`, pokušaj prati taj redosled; pitanja unutar source
bloka su nasumično izabrana i poređana. Ako je true, meša se ceo izabrani skup.

### 8.5. Spremnost kviza

Čuvanje izvora proverava vlasništvo, brojeve, bodove i jedinstvenost kategorije.
Potreban broj kandidata i validnost izabranih pitanja proveravaju se pri pokretanju;
ako kategorija nema dovoljno pitanja nakon isključenja fiksnih, rezultat je 422.
Prazan kviz takođe ne može da započne pokušaj. Sačuvani pokušaji zadržavaju svoje
pitanje snapshotove, redosled, bodove i prethodni `settings.question_count`.

## 9. Video uslovi — Quiz Requirements

### 9.1. Rute

| Metoda | Putanja | Rezultat |
| --- | --- | --- |
| POST | `/quiz-requirements` | 201, `{ success, requirement }` |
| GET | `/quiz-requirements` | 200, `{ success, requirements, pagination, sorting }` |
| GET | `/quiz-requirements/:quizId/:videoId` | 200, `{ success, requirement }` sa `video_card` |
| PATCH | `/quiz-requirements/:quizId/:videoId` | 200, `{ success, requirement }` |
| DELETE | `/quiz-requirements/:quizId/:videoId` | 200, `{ success, deleted: true }` |
| GET | `/quiz-requirements/:quizId/check` | 200, `{ success, requirements_met }` |
| GET | `/quiz-requirements/:quizId/progress` | 200, `{ success, quiz_id, requirements_met, requirements }` |

Ovde putanja nije `/:quizId/requirements`. POST prima `quiz_id` u body-ju, a lista
koristi opcioni `quiz_id` query. Identitet requirementa je `(quiz_id, video_id)`.

### 9.2. Izbor videa i validacije

| Polje | Pravilo | Default za POST |
| --- | --- | --- |
| `quiz_id` | Obavezan UUID kviza | Nema |
| `video_id` | Obavezan UUID dostupnog videa | Nema |
| `is_active` | Boolean; null nije dozvoljen | true |
| `position` | Ceo broj 0–2147483647 | 0 |
| `min_watch_percentage` | > 0 i <= 100, do dve decimale, ili null | null |
| `min_watch_seconds` | Ceo broj 1–2147483647 ili null | null |

Tačno jedan prag mora imati vrednost. Na istom kvizu možeš kombinovati procente
za jedan video i sekunde za drugi. Za isti video ne možeš dodati dva requirementa;
ponovljeni POST vraća 409.

Pri dodavanju/izmeni video mora imati `mux_status = ready` i biti:

- Javan, sa `published_at <= sada`; ili
- Javan/privatan video vlasnika kviza.

Za zahtev u sekundama trajanje mora biti poznato, a prag ne sme biti veći od trajanja.
Procentni prag nema istu create proveru poznatog trajanja; ako ono kasnije nije
pozitivno, procentni uslov ne može biti ispunjen.

Kod uređivanja tuđeg kviza sa `_any` permisijom izbor videa za upis koristi **vlasnika
kviza**, dok GET `video_card` prikazuje dostupnost **prijavljenom gledaocu**.
Zato administrator može imati pristup requirementu, ali dobiti `video_card: null`
za privatni video drugog vlasnika. Sama read-any permisija kviza nije video dozvola.

### 9.3. POST primeri

Procenat gledanja:

```json
{
  "quiz_id": "33333333-3333-4333-8333-333333333333",
  "video_id": "44444444-4444-4444-8444-444444444444",
  "min_watch_percentage": 75,
  "min_watch_seconds": null,
  "position": 0
}
```

Sekunde gledanja, za drugi video koji traje najmanje 60 sekundi:

```json
{
  "quiz_id": "33333333-3333-4333-8333-333333333333",
  "video_id": "55555555-5555-4555-8555-555555555555",
  "min_watch_percentage": null,
  "min_watch_seconds": 60,
  "position": 1
}
```

POST i PATCH vraćaju samo podatke veze, bez kartice:

```json
{
  "success": true,
  "requirement": {
    "quiz_id": "33333333-3333-4333-8333-333333333333",
    "video_id": "44444444-4444-4444-8444-444444444444",
    "min_watch_percentage": 75,
    "min_watch_seconds": null,
    "position": 0,
    "is_active": true
  }
}
```

### 9.4. Autorska lista, detalji, PATCH i DELETE

```http
GET /api/quizzes/quiz-requirements?quiz_id=33333333-3333-4333-8333-333333333333&page=1&limit=20&sortBy=position&sortOrder=asc
```

Bez `quiz_id`, lista sadrži requiremente dostupnih kvizova prema own/any scope-u.
Sa tim filterom kviz mora biti dostupan; nepostojeći/nedostupan kviz daje 404.
Podržani `sortBy`: `position` (default), `quiz_id`, `video_id`,
`min_watch_percentage`, `min_watch_seconds`. Default smer je `asc`, null vrednosti poslednje.

Lista i GET pojedinačnog requirementa dodaju `video_card` uz osnovna polja.
Nije potrebno da kviz bude published za ove autorske rute.

PATCH prihvata samo pragove i `position`, ne `quiz_id` ili `video_id`.
Za prelazak sa procenta na sekunde pošalji oba praga:

```json
{
  "min_watch_percentage": null,
  "min_watch_seconds": 60
}
```

Za promenu videa ukloni staru vezu i kreiraj novu. DELETE uklanja samo uslov,
ne briše video ni korisnikov napredak gledanja. Nema bulk replace/reorder rute
za requiremente; promene više pozicija idu pojedinačnim PATCH zahtevima.

### 9.5. Kartica videa

Kada je dostupna, `video_card` ima sledeća polja:

| Polje | Namena |
| --- | --- |
| `id`, `title` | Identitet i naslov videa |
| `duration_seconds`, `view_count`, `created_at` | Trajanje, broj pregleda i datum |
| `uploader_id`, `uploader_name` | Podaci o autoru |
| `people` | Niz `{ id, name, image_url }` |
| `progress_seconds`, `percentage_watched` | Podaci watch-progress kartice prijavljenog gledaoca, mogu biti null |
| `thumbnail_url` | Sačuvani thumbnail ili null |
| `mux_thumbnail_url` | Generisan thumbnail ili null |
| `preview_url` | Animirani preview ili null |
| `media_expires_at` | Unix vreme isteka potpisanih medija u sekundama ili null |

Za sliku u UI-ju možeš koristiti `thumbnail_url ?? mux_thumbnail_url` i placeholder.
Ako dobiješ `media_expires_at`, pred istekom ponovo učitaj karticu; datum računaš
sa `new Date(media_expires_at * 1000)`. Dostupnost medija zavisi i od video konfiguracije.
`video_card` može biti null; to ne uklanja requirement iz odgovora.

`progress_seconds` je podatak kartice, a ispunjenost requirementa se računa iz
**`total_watch_seconds`**. Ne koristi poziciju reprodukcije ili procenat sa kartice
kao zamenu za `is_met` iz progress odgovora.

### 9.6. Brza provera uslova

```http
GET /api/quizzes/quiz-requirements/33333333-3333-4333-8333-333333333333/check
```

```json
{
  "success": true,
  "requirements_met": false
}
```

Korisnik dolazi iz access tokena; ne šalješ `user_id`. Rezultat je objekat sa boolean
poljem, ne goli JSON `false`. Potrebna je `quizzes.participate` permisija.
Kviz mora biti published; nepostojeći/draft/archived daju 404.

Ako kviz nema aktivne requiremente, rezultat je `requirements_met: true`.

### 9.7. Detaljan napredak po videu

```http
GET /api/quizzes/quiz-requirements/33333333-3333-4333-8333-333333333333/progress
```

Primer ispod predstavlja video od 200 sekundi, prag 75%, odgledano ukupno 120 sekundi.
Kartica je u ovom primeru nedostupna trenutnom gledaocu:

```json
{
  "success": true,
  "quiz_id": "33333333-3333-4333-8333-333333333333",
  "requirements_met": false,
  "requirements": [
    {
      "quiz_id": "33333333-3333-4333-8333-333333333333",
      "video_id": "44444444-4444-4444-8444-444444444444",
      "min_watch_percentage": 75,
      "min_watch_seconds": null,
      "position": 0,
      "is_active": true,
      "total_watch_seconds": 120,
      "required_watch_seconds": 150,
      "watched_percentage": 60,
      "is_met": false,
      "completion_percentage": 80,
      "video_card": null
    }
  ]
}
```

| Polje | Značenje |
| --- | --- |
| `total_watch_seconds` | Ukupno registrovano gledanje ovog korisnika; bez zapisa je 0 |
| `required_watch_seconds` | Prag u sekundama, iz procenta ili eksplicitnog praga; može biti null |
| `watched_percentage` | Deo ukupnog trajanja videa, ograničen na 100; null za nepoznato/nepozitivno trajanje |
| `completion_percentage` | Procenat ispunjenosti samog uslova, ograničen na 100; null ako nije izračunljiv |
| `is_met` | Serverska odluka da li je taj uslov ispunjen |
| `requirements_met` | Da li je ispunjen svaki aktivni requirement |

Formula za sekunde: `total_watch_seconds >= min_watch_seconds`.
Za procenat: `duration_seconds > 0` i
`total_watch_seconds * 100 >= duration_seconds * min_watch_percentage`.
Prikazni procenti skraćuju se na dve decimale; server odlučuje po neskraćenoj
vrednosti, pa frontend ne treba da ponovo izvodi `is_met` iz prikazanog procenta.

Progress lista je **nepaginirana**, sortirana po `position`, pa `video_id`.
Ista published/participate pravila važe kao za check. Prazan kviz vraća:

```json
{
  "success": true,
  "quiz_id": "33333333-3333-4333-8333-333333333333",
  "requirements_met": true,
  "requirements": []
}
```

Obe participant rute imaju `Cache-Control: private, no-store`. Ove rute samo čitaju
napredak; ne upisuju gledanje. Za snimanje gledanja koristi postojeći video playback
tok. Posle povratka iz plejera ponovo učitaj progress; u aktivnom ekranu možeš ga
osvežavati u razumnim intervalima.

`is_active` se prima kroz POST/PATCH i vraća u podacima requirementa. Na primer,
PATCH `/quiz-requirements/:quizId/:videoId` sa `{ "is_active": false }` deaktivira
uslov. Izostavljeno polje pri PATCH-u zadržava postojeću vrednost.
Administrativna lista i pojedinačni GET vraćaju i neaktivne uslove.
`check`, `progress`, eligibility i pokretanje attempta uzimaju u obzir samo aktivne
uslove; `progress` izostavlja neaktivne stavke. Ako nema aktivnih uslova, vraća
`requirements_met: true` i `requirements: []`.

## 10. Tokovi rada i osvežavanje podataka

### 10.1. Kreiranje kompletne konfiguracije

1. Učitaj dozvoljene akcije korisnika i pripremi autorske ekrane.
2. Napravi kategorije kroz POST `/question-categories` i sačuvaj ID-jeve.
3. Napravi pitanja; dodeli kategoriju kroz `category_id` ili kasnije PUT-om kategorije.
4. Napravi `draft` kviz bez `question_count`.
5. Poveži fiksna pitanja kroz POST `/:quizId/questions`; postavi poene i položaje.
6. Po potrebi dodaj izvore sa brojem i bodovima za nasumična pitanja iz cele kategorije. Isključi fiksna pitanja kada računaš dostupnost.
7. Dodaj potrebne video requiremente. Ako nisu potrebni, ostavi prazan skup.
8. Proveri popunjenost pitanja, broj kandidata, kvote, vlasništvo i video pragove.
9. Postavi `status: "published"` običnim PATCH-om kviza.

Nema jedne create rute koja automatski kreira sve ove entitete ili veze.
Nemoj POST-ovati `questions`, `sources`, `requirements` ili `categories` unutar quiz body-ja.
Dozvoljene input šeme su stroge i takav payload će biti odbijen.

### 10.2. Učitavanje editora kviza

Posle uspešnog GET-a kviza, nezavisne tabove možeš učitati paralelno:

- GET `/:quizId/questions` — kandidati i poeni.
- GET `/:quizId/sources` — raspodela po kategorijama.
- GET `/quiz-requirements?quiz_id=...` — video uslovi i kartice.

Svaki tab ima sopstvenu paginaciju. Za prebrojavanje svih kandidata koristi njegov
`pagination.total`, ne `questions.length` prve strane. Za edit cele source tabele
učitaj sve njene strane pre PUT-a, da ne bi obrisao izvore sa drugih strana.

### 10.3. Predloženi query/cache ključevi

U ključeve privatnih podataka uključi korisnika i sve filtere; pri promeni naloga
očisti cache. Sledeće tabele su preporuka za frontend, ne ugrađeno serversko ponašanje.

| Query | Primer oblika ključa |
| --- | --- |
| Lista pitanja | `["questions", userId, { type, category_id, page, limit, sortBy, sortOrder }]` |
| Detalji pitanja | `["question", userId, questionId]` |
| Lista/detalji kategorija | `["question-categories", userId, query]`, `["question-category", userId, categoryId]` |
| Lista/detalji kvizova | `["quizzes", userId, query]`, `["quiz", userId, quizId]` |
| Kandidati | `["quiz-questions", userId, quizId, query]` |
| Izvori | `["quiz-sources", userId, quizId, query]` |
| Video uslovi | `["quiz-requirements", userId, query]` |
| Napredak gledanja | `["quiz-requirements-progress", userId, quizId]` |

| Mutacija | Šta ponovo učitati / invalidirati |
| --- | --- |
| Tekst/tip/odgovori pitanja | Detalje i liste pitanja, prikaze kategorija, kandidate koji prikazuju tekst |
| Promena `category_id` | Detalje/liste pitanja, stare i nove detalje kategorija, preglede raspoloživosti izvora |
| Preimenovanje kategorije | Liste/detalje kategorija, `category` u pitanjima i `category` u izvorima |
| PUT članova kategorije | Detalje kategorije, pitanja čija se članstva menjaju, liste pitanja i provere source kandidata |
| Veza kviza i pitanja | Liste fiksnih pitanja i izvora, detalje/listu kvizova i provere raspoloživosti |
| Podešavanja/status kviza | Detalje i liste kvizova; promene strukture osvežavaju i automatski `question_count` |
| PUT/PATCH/DELETE izvora | Sve strane source liste i njen lokalni zbir |
| Mutacija requirementa | Autorske liste/detalje, participant check i progress |
| Brisanje originalnog pitanja/kategorije | Sve liste i otvorene detalje koji su ga referencirali |

### 10.4. Lokalno uređivanje formi

- Razdvoji read model (`category`) i write model (`category_id`).
- Drži sve matching nizove lokalno i pošalji međusobno usklađeno konačno stanje.
- Promenu tipa pitanja tretiraj kao promenu editora odgovora; prazne nizove nakon
  promene tipa nemoj zameniti zastarelim vrednostima iz prethodnog cache-a.
- Source tabelu uređuj lokalno, pa snimi celim PUT-om. Ne autosave-uj svaki procenat
  pojedinačnim zahtevom dok zbir nije validan.
- POST zahteve ne ponavljaj automatski posle neizvesnog mrežnog ishoda: kreiranje
  pitanja/kvizova nema idempotency ključ. Prvo osveži listu i proveri rezultat.
- Ako više korisnika istovremeno uređuje isti resurs, nema verzije/ETag/If-Match
  ugovora. Pre slanja zamene celog članstva ili izvora korisno je osvežiti podatke.

## 11. Primer frontend klijenta

Ovaj TypeScript primer pokazuje postojeće envelope-e, query parametre i mapiranje
kategorija. Naziv baze/promenljive okruženja prilagodi svom frontend projektu.

```ts
type CategoryRef = { id: string; name: string };
type Pagination = {
  page: number; limit: number; total: number; totalPages: number;
  hasNextPage: boolean; hasPreviousPage: boolean;
};
type QuestionSummary = {
  id: string; user_id: string;
  type: "single_choice" | "multiple_choice" | "matching";
  content: string; explanation: string | null;
  created_at: string; updated_at: string; category: CategoryRef | null;
};
type QuestionListResponse = {
  success: true; questions: QuestionSummary[];
  pagination: Pagination; sorting: { sortBy: string; sortOrder: "asc" | "desc" };
};
type QuestionListQuery = {
  page?: number; limit?: number; type?: QuestionSummary["type"];
  category_id?: string;
  sortBy?: "created_at" | "updated_at" | "content" | "type";
  sortOrder?: "asc" | "desc";
};
type SourceInput = {
  category_id: string | null; position?: number;
  question_count: number; max_points?: number | null;
};
type Source = {
  id: string; quiz_id: string; category_id: string | null; position: number;
  question_count: number; max_points: number | null;
  category: { id: string; name: string; description: string | null } | null;
};

class ApiError extends Error {
  constructor(public status: number, message: string, public payload: unknown) {
    super(message);
  }
}

function createQuizzesApi(serverBaseUrl: string, getToken: () => string) {
  const base = serverBaseUrl.replace(/\/$/, "") + "/api/quizzes";

  async function request<T>(path: string, options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown; signal?: AbortSignal;
  } = {}): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json", Authorization: "Bearer " + getToken(),
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    const response = await fetch(base + path, {
      method: options.method ?? "GET", headers, signal: options.signal,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    // Proxy/server greška ne mora imati JSON body.
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.success === false) {
      throw new ApiError(response.status, payload?.message ?? "Zahtev nije uspeo", payload);
    }
    return payload as T;
  }

  return {
    listQuestions(query: QuestionListQuery = {}, signal?: AbortSignal) {
      const params = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== "") params.set(key, String(value));
      }
      const suffix = params.size ? "?" + params.toString() : "";
      return request<QuestionListResponse>("/questions" + suffix, { signal });
    },
    setQuestionCategory(questionId: string, category: CategoryRef | null) {
      return request<{ success: true; question: QuestionSummary }>(
        "/questions/" + encodeURIComponent(questionId),
        { method: "PATCH", body: { category_id: category?.id ?? null } },
      );
    },
    replaceSources(quizId: string, sources: SourceInput[]) {
      return request<{ success: true; sources: Source[] }>(
        "/" + encodeURIComponent(quizId) + "/sources",
        { method: "PUT", body: { sources } },
      );
    },
    checkRequirements(quizId: string) {
      return request<{ success: true; requirements_met: boolean }>(
        "/quiz-requirements/" + encodeURIComponent(quizId) + "/check",
      );
    },
  };
}
```

`setQuestionCategories` tip koristi summary kao podskup; stvarni response dodatno sadrži
nizove odgovora. Za editor uvedi detaljan tip koji uključuje `options`,
`matching_options`, `matching_items` iz odeljka 4. Ne uklanjaj ta polja pri lokalnom
ažuriranju cache-a ako ih ekran koristi.

## 12. Greške i ograničenja

### 12.1. Oblik grešaka

Većina kontrolera vraća:

```json
{
  "success": false,
  "message": "Question not found"
}
```

Validation helper vraća 400 i prvu poruku greške. Trenutno nema zajedničkog
`errors: [{ field, message }]` ugovora. UI može lokalno vezati pravila za inpute,
a serversku `message` prikazati u poruci forme.

Permisijski middleware nije potpuno isti za sve rute. `requirePermission` može
vratiti 403 bez `success` polja:

```json
{
  "message": "Insufficient permissions",
  "requiredPermission": "questions.create"
}
```

Resource access middleware obično vraća `{ success: false, message }`.
Zato grešku uvek prepoznaj preko **HTTP statusa**, ne samo preko `success`.

### 12.2. Statusi i tipični primeri

| Status | Primer | Frontend postupak |
| --- | --- | --- |
| 400 | Neispravan UUID, nepoznato polje, prazan PATCH, nevalidan broj/bodovi izvora, oba watch praga popunjena | Prikaži poruku i sačuvaj lokalne izmene forme |
| 401 | Nema tokena, istekao token, neaktivan nalog ili promenjeno ovlašćenje tokena | Pokreni postojeći auth tok i spreči petlju ponavljanja |
| 403 | Nedostaje potrebna permisija | Prikaži zabranu akcije; ne ponavljaj isti zahtev automatski |
| 404 | Resurs ne postoji ili je izvan own scope-a; participant provera za neobjavljen kviz | Osveži prikaz dostupnosti, ukloni zastareli izbor |
| 409 | Dupli naziv kategorije istog vlasnika, isti kandidat/izvor/video requirement već povezan | Ponovo učitaj postojeće stanje |
| 500 | Nemapirana DB/servis greška | Prikaži generičku poruku i omogući kontrolisan retry |

Primeri serverskih poruka korisnih pri povezivanju formi:

- `Question category not found`
- `One or more questions were not found`
- `This question is already linked to the quiz`
- `This category is already a source for the quiz`
- `This video is already a requirement for the quiz`
- `Exactly one of min_watch_percentage and min_watch_seconds must be set`
- `min_watch_seconds requires a known video duration and cannot exceed it`

Nemoj parsirati tekst poruke kao stabilan machine-readable kod. Većina ruta iz
ovog vodiča ne vraća poseban `code`.

### 12.3. Bitna trenutna ograničenja

- Liste pitanja/kategorija/kvizova nemaju filter po proizvoljnom `user_id`.
- Lista banke pitanja nema full-text/name/content pretragu; ima `type` i `category_id`.
- Nema ugrađenog bulk povezivanja kandidata ili bulk reordering rute.
- Nema quiz thumbnail/upload rute ni quiz `visibility` polja u ovim šemama.
- Grupne detalje dobijaš cele; nema paginacije `category.questions` u tom odgovoru.
- Source CRUD validira vlasništvo, broj pitanja i bodove, ali čuvanje source tabele
  samo po sebi ne potvrđuje dovoljan broj različitih, popunjenih kandidata.
- Publish PATCH ne radi kompletnu proveru svih delova kviza.
- Ugnježdeni odgovori `category`, `question`, `categories` zavise od konteksta; nisu svi
  jednaki detaljnim resursima. Vidi odeljke 4, 5, 7 i 8.
- Ne tretiraj karticu nedostupnog videa kao ispunjen ili uklonjen uslov.
- Medijske greške mogu biti generički 500 kroz requirement kontroler; frontend
  ne treba da zavisi od garantovanog specifičnog statusa za svaki medijski problem.

## 13. Kontrolna lista za integraciju

- [ ] Sve rute koriste `/api/quizzes` prefiks i važeći access token.
- [ ] UI akcije prate permisije, uključujući Owner i `_any` scope.
- [ ] Reader/admin liste se ne tretiraju automatski kao sopstvene liste.
- [ ] Filteri, sorting i pagination ulaze u query ključeve; novi filter vraća prvu stranu.
- [ ] Pitanja se čitaju preko `category: { id, name } | null`, a upisuju preko `category_id`.
- [ ] Početne liste i ugnježdeni summary objekti se razlikuju od detaljnih objekata.
- [ ] Choice i matching editori čuvaju stabilne brojeve opcija i stavki.
- [ ] PUT članstva i izvora šalje kompletan nameravani skup, učitan sa svih strana.
- [ ] `quiz_questions` fiksna pitanja i source kategorija povezani su nezavisno i imaju istog vlasnika.
- [ ] Izvori koriste pozitivan broj pitanja i imaju dovoljno kandidata nakon isključenja fiksnih pitanja.
- [ ] Pitanja/opcije/stavke su popunjeni pre objavljivanja.
- [ ] Video requirement ima tačno jedan prag, a video je dostupan i odgovarajućeg trajanja.
- [ ] Progress ekran koristi serverski `is_met`, podržava `video_card: null` i prazne requiremente.
- [ ] UI razlikuje 401, 403, 404, 409 i obične greške forme.
- [ ] Posle promena osvežava se svaki povezani prikaz iz odeljka 10.3.

### Izvori ugovora u repozitorijumu

- `src/modules/quizzes-engine/quizzes-engine.routes.js` — prefiksi podmodula.
- `src/modules/quizzes-engine/helpers/quizAuthorization.js` — scope permisija i vlasništvo.
- `src/modules/authorization/permission.constants.js` i `authorization.service.js` — ključevi i Owner.
- Routes, controllers, `helpers/*.validation.js`, handlers i repositories šest podmodula opisanih u ovom dokumentu.
- `src/common/response.js` i `src/common/input.validation.js` — envelope i validation greške.
- `src/database/migrations/1792281600001_add-quiz-sources.sql` — istorijska šema izvora.
- `src/database/sql/videoCardFragments.js` i `src/modules/videos/helpers/videoCardMedia.js` — video kartice i mediji.

Pregled po rutama obuhvata 34 kombinacije HTTP metode i putanje, bez podmodula
`quiz-attempts`. Primeri su dokumentacioni i ne izvršavaju API zahteve.
