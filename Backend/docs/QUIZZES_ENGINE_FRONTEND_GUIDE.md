# Quizzes Engine — vodič za frontend

Provereno prema kodu: **20. oktobar 2026.**

Ovaj dokument pokriva banku pitanja, grupe, kvizove, povezivanje pitanja sa
kvizom, izvore pitanja i video requiremente, uključujući proveru i prikaz napretka
gledanja. Podmodul `quiz-attempts` je izostavljen.

Ugovori u ovom dokumentu odgovaraju trenutnim routes, controller, validation i
repository fajlovima u `src/modules/quizzes-engine/`. Posebno su obuhvaćene
novije promene: `groups: [{ id, name }]`, filter `group_id` i permisije `_own`/`_any`.

## Sadržaj

1. [Model podataka i ekrani](#1-model-podataka-i-ekrani)
2. [Zajednički API ugovor](#2-zajednički-api-ugovor)
3. [Autentifikacija i permisije](#3-autentifikacija-i-permisije)
4. [Banka pitanja — Questions](#4-banka-pitanja--questions)
5. [Grupe — Question Groups](#5-grupe--question-groups)
6. [Kvizovi — Quizzes](#6-kvizovi--quizzes)
7. [Kandidati — Quiz Questions](#7-kandidati--quiz-questions)
8. [Izvori — Quiz Sources](#8-izvori--quiz-sources)
9. [Video uslovi — Quiz Requirements](#9-video-uslovi--quiz-requirements)
10. [Tokovi rada i osvežavanje podataka](#10-tokovi-rada-i-osvežavanje-podataka)
11. [Primer frontend klijenta](#11-primer-frontend-klijenta)
12. [Greške i ograničenja](#12-greške-i-ograničenja)
13. [Kontrolna lista za integraciju](#13-kontrolna-lista-za-integraciju)

## 1. Model podataka i ekrani

| Pojam | Namena | Šta frontend uređuje |
| --- | --- | --- |
| Question | Originalno pitanje u banci | Tip, sadržaj, objašnjenje, odgovore i grupe |
| Question group | Organizacija banke pitanja | Naziv, opis i skup članova |
| Quiz | Podešavanja kviza | Naslov, status, broj pitanja, bodovanje i feedback opcije |
| Quiz question | Veza kviza i originalnog pitanja | Položaj i maksimalne poene za taj kviz |
| Quiz source | Kvota jedne grupe u kvizu | Grupu, položaj i procenat ili tačan broj pitanja |
| Quiz requirement | Obavezan video uslov | Video, položaj i minimalno gledanje |

Jedno pitanje može pripadati više grupa i biti povezano sa više kvizova.
Dodavanje pitanja u grupu **ne dodaje** ga automatski u `quiz_questions`.
Dodavanje grupe u `quiz_sources` takođe **ne povezuje** njena pitanja sa kvizom.
Za izvor su kandidati presek članova te grupe i pitanja povezanih sa kvizom.

Praktična podela UI-ja:

- **Banka pitanja:** lista, filteri, kreiranje i editor pitanja.
- **Grupe:** lista, detalji i izbor članova.
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
| Kreiranje resursa/veze | 201 | `question`, `group`, `quiz`, `quiz_question`, `source` ili `requirement` |
| GET pojedinačnog resursa | 200 | Odgovarajuće jedninsko polje |
| Lista | 200 | Odgovarajući niz, `pagination`, `sorting` |
| PATCH | 200 | Ažuriran resurs u jedninskom polju |
| PUT članova grupe | 200 | `group`, `question_ids` |
| PUT izvora kviza | 200 | `sources` |
| DELETE | 200 | `deleted: true` |

DELETE ne vraća 204. Uspešno brisanje izgleda ovako:

```json
{ "success": true, "deleted": true }
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
  "sorting": { "sortBy": "created_at", "sortOrder": "asc" }
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
- `id`, `user_id`, timestampovi, `groups` i ugnježdeni prikazni objekti nisu edit polja.
- PATCH zahteva bar jedno dozvoljeno polje. Izostavljeno znači „sačuvaj postojeće“.
- `null` možeš poslati samo za polja koja su eksplicitno nullable.
- Prazni nizovi često znače „ukloni sve“; detalji su navedeni uz svaku rutu.
- Ne šalji prazan filter `group_id=` ili `quiz_id=`; izostavi ga ako nije izabran.
- Datum parsiraj kao ISO datum. Odgovori mogu imati `Z` ili vremenski offset i
  različitu preciznost razlomka sekunde; ne poredi sirove timestamp stringove.

## 3. Autentifikacija i permisije

### 3.1. Permisije za autorske ekrane

| Resurs | Kreiranje | Čitanje | Izmena | Brisanje |
| --- | --- | --- | --- | --- |
| Kviz | `quizzes.create` | `quizzes.read_own` / `quizzes.read_any` | `quizzes.update_own` / `quizzes.update_any` | `quizzes.delete_own` / `quizzes.delete_any` |
| Pitanje | `questions.create` | `questions.read_own` / `questions.read_any` | `questions.update_own` / `questions.update_any` | `questions.delete_own` / `questions.delete_any` |
| Grupa | `question_groups.create` | `question_groups.read_own` / `question_groups.read_any` | `question_groups.update_own` / `question_groups.update_any` | `question_groups.delete_own` / `question_groups.delete_any` |

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
| PUT članova grupe | `question_groups.update_own` ili `question_groups.update_any` |
| Provera i napredak gledanja za učesnika | `quizzes.participate` |

Pravo na uređivanje kviza ne omogućava povezivanje pitanja/grupa drugog vlasnika.
**Kviz, kandidati i source grupe moraju imati istog vlasnika.** Isto pravilo važi
za pitanje i njegove grupe. Za video requiremente važe posebna pravila dostupnosti
videa iz odeljka 9.

### 3.3. Autorski GET i status `published`

Autorske GET rute za kvizove, pitanja, grupe, kandidate i izvore zahtevaju autorske
read permisije. `published` ne pretvara te rute u javni katalog. Na njima je dozvoljen
i rad sa draft/archived kvizovima u okviru ovlašćenja.

Rute `check` i `progress` za video requiremente koriste prijavljenog učesnika i rade
samo za `published` kviz. Draft i archived vraćaju 404 čak i vlasniku na tim rutama.
Autorska lista requirementa ostaje dostupna uz read permisiju.

## 4. Banka pitanja — Questions

### 4.1. Rute

| Metoda | Putanja | Rezultat |
| --- | --- | --- |
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
| `group_ids` | Opciono | UUID niz grupa istog vlasnika; duplikati se uklanjaju |

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
    { "option_no": 1, "content": "200", "is_correct": false, "position": 1 },
    { "option_no": 2, "content": "404", "is_correct": true, "position": 2 }
  ],
  "matching_options": [],
  "matching_items": [],
  "group_ids": ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]
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
    { "option_no": 1, "content": "200", "is_correct": true, "position": 1 },
    { "option_no": 2, "content": "201", "is_correct": true, "position": 2 },
    { "option_no": 3, "content": "404", "is_correct": false, "position": 3 }
  ],
  "group_ids": []
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
    { "option_no": 10, "content": "Uspešan zahtev", "position": 1 },
    { "option_no": 20, "content": "Resurs nije pronađen", "position": 2 }
  ],
  "matching_items": [
    { "item_no": 1, "content": "200", "correct_option_no": 10, "position": 1 },
    { "item_no": 2, "content": "404", "correct_option_no": 20, "position": 2 }
  ],
  "group_ids": []
}
```

### 4.6. GET lista i filter po grupi

```http
GET /api/quizzes/questions?group_id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&type=single_choice&page=1&limit=20&sortBy=created_at&sortOrder=desc
```

| Parametar | Opcije / značenje |
| --- | --- |
| `type` | Opciono: `single_choice`, `multiple_choice`, `matching` |
| `group_id` | Opcion UUID jedne grupe; ne menja postojeći owner scope |
| `sortBy` | `created_at` (default), `updated_at`, `content`, `type` |
| `sortOrder` | `asc` (default), `desc` |

Filteri se kombinuju sa AND. Pitanje koje pripada više grupa pojavljuje se samo jednom.
`groups` sadrži **sve** njegove grupe, ne samo grupu iz filtera. Nepostojeća grupa
ili grupa bez pitanja u dozvoljenom owner scope-u daje praznu listu, ne 404.
Neispravan UUID je 400. Nema query parametra za pretragu teksta pitanja.

Stavka liste ima: `id`, `user_id`, `type`, `content`, `explanation`, `created_at`,
`updated_at`, `groups`. Lista ne sadrži nizove opcija/stavki; za editor učitaj detalje.

### 4.7. GET detalji i izlazni format grupa

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
      { "option_no": 1, "content": "200", "is_correct": false, "position": 1 },
      { "option_no": 2, "content": "404", "is_correct": true, "position": 2 }
    ],
    "matching_options": [],
    "matching_items": [],
    "groups": [
      { "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "name": "HTTP osnove" }
    ]
  }
}
```

Izlaz je `groups`, a ulaz za uređivanje je `group_ids`:

```ts
const selectedGroupIds = question.groups.map(group => group.id);
const body = { group_ids: selectedGroupIds };
```

Bez grupa dobijaš `groups: []`. Tačni odgovori i objašnjenje u detaljima namenjeni su
autorskom editoru; read permisija daje pristup tom autorskom prikazu.

### 4.8. PATCH — sadržaj, odgovori i članstva

Samo promena teksta:

```json
{ "content": "Izmenjen tekst pitanja", "explanation": null }
```

Promena grupa:

```json
{ "group_ids": ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"] }
```

`group_ids` izostavljen čuva sva članstva; `[]` uklanja sva članstva.
Svaki poslati niz `options`, `matching_options` ili `matching_items` zamenjuje taj
ceo niz; to nije dopuna jedne stavke. Kod promene `type`, svi izostavljeni nizovi
odgovora prazne se, dok izostavljeni tekst i objašnjenje ostaju.

Pri uklanjanju matching opcije ukloni ili preveži sve stavke koje je referenciraju
u **istom PATCH-u**. Backend proverava spojeno konačno stanje i rollback-uje neuspešan upis.

### 4.9. DELETE

Briše originalno pitanje, njegove odgovore, članstva i veze sa kvizovima.
Za uklanjanje samo iz konkretnog kviza koristi DELETE veze iz odeljka 7.
Posle brisanja osveži listu pitanja, otvorene grupe i kandidate relevantnih kvizova.

## 5. Grupe — Question Groups

### 5.1. Rute

| Metoda | Putanja | Rezultat |
| --- | --- | --- |
| POST | `/question-groups` | 201, `{ success, group }` |
| GET | `/question-groups` | 200, `{ success, groups, pagination, sorting }` |
| GET | `/question-groups/:groupId` | 200, `{ success, group }`, uključuje `group.questions` |
| PATCH | `/question-groups/:groupId` | 200, `{ success, group }` |
| DELETE | `/question-groups/:groupId` | 200, `{ success, deleted: true }` |
| PUT | `/question-groups/:groupId/questions` | 200, `{ success, group, question_ids }` |

### 5.2. Kreiranje, izmena i lista

POST primer:

```json
{ "name": "HTTP osnove", "description": "Pitanja o HTTP metodama i statusima" }
```

`name` je obavezan trimovan string 1–255 karaktera. `description` je opcion
trimovan string ili null, default null. Isti vlasnik ne može imati dve grupe istog
naziva prema DB unique ograničenju; duplikat je 409. Različiti vlasnici mogu.

PATCH prihvata `name` i/ili `description`. Za brisanje opisa pošalji
`{ "description": null }`. Članstvo ne uređuješ kroz ovaj PATCH.

GET lista: opcioni `name` traži podstring, bez razlikovanja velikih/malih slova.
`%` i `_` se tretiraju kao tekst, ne wildcard. `sortBy`: `name` (default) ili `id`;
`sortOrder`: `asc` (default) ili `desc`, uz zajednički `page` i `limit`.

Primer: `GET /api/quizzes/question-groups?name=HTTP&page=1&limit=20&sortBy=name&sortOrder=asc`.
Stavke ove liste imaju samo `id`, `user_id`, `name`, `description`.

### 5.3. Detalji grupe i njena pitanja

```json
{
  "success": true,
  "group": {
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
        "groups": [
          { "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "name": "HTTP osnove" }
        ]
      }
    ]
  }
}
```

`group.questions` je ceo nepaginiran niz, sortiran po `created_at ASC`, pa `id ASC`.
Prazna grupa vraća `questions: []`. Svako pitanje ima sve svoje `groups` sa ID-jem
i nazivom, ali nema nizove odgovora. Detalje za editor učitaj sa `/questions/:questionId`.

POST/PATCH grupe i PUT članstava vraćaju osnovni objekat `group` bez `questions`.
Ne pretpostavljaj da svaki response sa poljem `group` sadrži pun detaljni oblik.

### 5.4. PUT — zamenjuje kompletno članstvo

```http
PUT /api/quizzes/question-groups/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/questions
```

```json
{
  "question_ids": [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222"
  ]
}
```

Sva pitanja moraju imati istog vlasnika kao grupa. Duplikati se uklanjaju.
`{ "question_ids": [] }` prazni grupu. Izostavljen `question_ids` je greška 400.
Članstva pitanja u **drugim grupama ostaju**. Ako je neki ID nepostojeći ili tuđ,
dobijaš 404 i ceo upis se poništava.

Odgovor sadrži osnovni `group` i konačni `question_ids` sortiran po UUID-u; to nije
UI redosled pitanja. Ova veza nema `position` niti rutu za reordering.

### 5.5. DELETE

Briše grupu i njena članstva, ali čuva originalna pitanja. Brišu se i source veze
ka grupi. Ako bi preostali izvori nekog kviza imali neispravan zbir, brisanje se
odbija sa 400; prvo uskladi ceo skup izvora kroz PUT. Brisanje poslednjeg izvora
može ostaviti kviz bez izvora, što je dozvoljeno.

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

Sva navedena polja dostupna su u create body-ju i PATCH-u. Samo `title` i
`question_count` su obavezni prilikom kreiranja.

| Polje | Tip / dozvoljene vrednosti | Default |
| --- | --- | --- |
| `title` | Trimovan string, 1–255 karaktera | Obavezno |
| `description` | Trimovan string ili null | null |
| `status` | `draft`, `published`, `archived` | `draft` |
| `question_count` | Pozitivan ceo broj | Obavezno |
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
znači bez tog ograničenja. `question_count` je ciljna veličina izbora, ne trenutni
broj povezanih kandidata, pa kandidata može biti više.

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
  "question_count": 10,
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
{ "title": "Novi naslov", "status": "published" }
```

Status se menja običnim PATCH-om; nema posebne publish rute. I POST može primiti
`published`. Postavljanje tog statusa trenutno **nije kompletna validacija spremnosti
kviza**: ne garantuje dovoljan broj validnih kandidata niti izvodljive grupne kvote.
Frontend treba da omogući pripremu draft-a i pre objavljivanja prikaže provere
iz odeljka 10.

Ako postoje izvori u režimu tačnih brojeva, promena `question_count` može biti
odbijena sa 400 zbog neusklađenog zbira. Postupak promene opisan je u odeljku 8.5.

### 6.6. DELETE

Brisanje kviza uklanja njegove kandidate, izvore i video requiremente; originalna
pitanja, grupe i videi ostaju. Druge reference u bazi mogu blokirati DELETE;
kontroler nemapiranu DB grešku vraća kao generički 500. Nemoj pretpostaviti da svaki
neuspeh brisanja ima posebno definisan 409 odgovor. Za povlačenje iz upotrebe dostupan
je PATCH sa `status: "archived"`.

## 7. Kandidati — Quiz Questions

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

### 7.2. Dodavanje kandidata

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
decimale, default 1. Nula poena nije dozvoljena.

Isto pitanje može biti povezano sa različitim kvizovima, ali ne dva puta sa istim:
ponovljeno dodavanje vraća 409. Za više pitanja šalješ više POST zahteva; ne postoji
bulk-create endpoint za kandidate.

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
bez `groups`, timestampova i odgovora. Za otvaranje editora originalnog pitanja
učitaj `/questions/:questionId` uz odgovarajuću question read permisiju.

### 7.3. Lista, izmena i uklanjanje

GET lista ima zajedničku paginaciju i `sortBy`: `position` (default), `max_points`,
`question_id`; `sortOrder`: `asc` (default) ili `desc`. Nema dodatnih filtera.

Svaki element GET liste dodatno sadrži `question.groups: [{ "id": "uuid-grupe",
"name": "Naziv grupe" }]`. Vraćaju se sve grupe tog pitanja, sortirane po ID-ju;
ako pitanje nema grupe, `question.groups` je `[]`. Članstvo u više grupa ne
duplira pitanja i ne utiče na paginaciju.

PATCH menja `position` i/ili `max_points`:

```json
{ "position": 1, "max_points": 3 }
```

Ne menja `question_id` niti sadržaj originalnog pitanja. Za drag-and-drop pošalji
jedan PATCH za pomereno pitanje, sa njegovom novom `position`, pa ponovo učitaj
listu. Ostala pitanja u zahvaćenom rasponu pomeraju se automatski:

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
Dodavanje/uklanjanje kandidata ne menja automatski `quiz.question_count` ni izvore.
Zato posle ove operacije ponovo izračunaj da li je kviz i dalje konfiguraciono spreman.

## 8. Izvori — Quiz Sources

### 8.1. Rute

| Metoda | Putanja | Rezultat |
| --- | --- | --- |
| POST | `/:quizId/sources` | 201, `{ success, source }` |
| PUT | `/:quizId/sources` | 200, `{ success, sources }` |
| GET | `/:quizId/sources` | 200, `{ success, sources, pagination, sorting }` |
| GET | `/:quizId/sources/:groupId` | 200, `{ success, source }` |
| PATCH | `/:quizId/sources/:groupId` | 200, `{ success, source }` |
| DELETE | `/:quizId/sources/:groupId` | 200, `{ success, deleted: true }` |

Identitet izvora je `(quiz_id, group_id)`; nema samostalni `id`.
Grupa mora imati istog vlasnika kao kviz. Isti `group_id` može biti samo jedan izvor
istog kviza. Jedna grupa sme biti izvor više kvizova.

### 8.2. Režimi raspodele

| Polje | Pravilo | Default na POST-u / stavci PUT-a |
| --- | --- | --- |
| `group_id` | Obavezan UUID | Nema |
| `position` | Ceo broj 0–2147483647 | 0 |
| `question_percentage` | > 0 i <= 100, do dve decimale, ili null | null |
| `question_count` | Pozitivan ceo broj do 2147483647, ili null | null |

**Tačno jedno** od poslednja dva polja mora imati vrednost. Izostavljeno se na
POST-u/PUT-u pretvara u null. Ceo kviz mora koristiti jedan režim:

- Procenti: zbir svih `question_percentage` mora biti tačno **100**.
- Tačni brojevi: zbir svih source `question_count` mora biti jednak `quiz.question_count`.
- Prazan skup izvora je dozvoljen; tada se koristi samo skup kandidata kviza.

Grupa može imati više pitanja od svoje kvote. Izvor sam ne pravi kandidate.
Presek `quiz_questions` i `question_group_items` određuje raspoloživa pitanja.
Pitanje koje pripada više izvornih grupa može se iskoristiti samo jednom i pokriti
samo jednu kvotu. Zbog preklapanja nije dovoljno samo porediti veličinu svake grupe
sa njenom kvotom: zbirna raspodela mora moći da koristi različita pitanja.

`max_points` dolazi sa veze `quiz_questions`, a ne iz grupe ili izvora.
Za procente koji daju necelo pitanje, postojeći izbor koristi najveće ostatke da
dobije tačno traženi broj; kod jednakih ostataka prednost imaju manji `position`,
pa `group_id`. Primer: 50/50% od 3 pitanja daje 2 i 1, ne 1.5 i 1.5.

### 8.3. Preporučeni UI: čuvanje cele tabele kroz PUT

```http
PUT /api/quizzes/33333333-3333-4333-8333-333333333333/sources
```

```json
{
  "sources": [
    {
      "group_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "position": 0,
      "question_percentage": 60,
      "question_count": null
    },
    {
      "group_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "position": 1,
      "question_percentage": 40,
      "question_count": null
    }
  ]
}
```

PUT zamenjuje ceo skup izvora u jednoj transakciji. Stare izvore koji nisu poslati
uklanja. `sources` je obavezan niz sa najviše 1000 stavki i bez ponovljenih grupa.
`{ "sources": [] }` uklanja sve izvore.

Odgovor PUT-a je `{ success: true, sources: [...] }`, bez `pagination` i `sorting`.
Svaki izvor ima isti oblik kao sledeći pojedinačni primer:

```json
{
  "success": true,
  "source": {
    "quiz_id": "33333333-3333-4333-8333-333333333333",
    "group_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    "position": 0,
    "question_percentage": 60,
    "question_count": null,
    "group": {
      "id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "name": "HTTP osnove",
      "description": "Pitanja o HTTP metodama i statusima"
    }
  }
}
```

Za kviz sa `question_count: 10`, primer režima tačnih brojeva je:

```json
{
  "sources": [
    {
      "group_id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      "position": 0,
      "question_percentage": null,
      "question_count": 6
    },
    {
      "group_id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "position": 1,
      "question_percentage": null,
      "question_count": 4
    }
  ]
}
```

Za lokalnu proveru procentnog zbira koristi stotinke: saberi
`Math.round(value * 100)` i očekuj 10000. Server svakako ponavlja validaciju.

### 8.4. POST, PATCH, DELETE i sortiranje

POST prima jednu stavku iz PUT niza, bez `sources` omotača. Na praznom kvizu jedan
procentualni izvor mora biti 100%; jedan izvor u režimu broja mora pokriti ceo
`quiz.question_count`. POST sa 60%, pa drugi POST sa 40% **ne radi**: prvi zahtev
bi ostavio neispravan zbir. Za početnu raspodelu sa više grupa koristi PUT.

PATCH prihvata `position`, `question_percentage`, `question_count`, ali ne `group_id`.
Izostavljena polja čuva. PATCH samo pozicije je jednostavan:

```json
{ "position": 2 }
```

Promena procenta samo jednog izvora najčešće će narušiti zbir i dati 400. Za prelazak
režima moraš postaviti staro polje na null, a novo na vrednost; za više izvora koristi
jedan PUT cele raspodele. DELETE jednog izvora takođe može dati 400 ako preostali
izvori više ne čine validan zbir. Uklanjanje poslednjeg izvora je dozvoljeno.

GET lista: `sortBy` je `position` (default), `group_id`, `question_percentage` ili
`question_count`; default smer `asc`; null vrednosti su poslednje. Podržani su `page`
i `limit`, nema dodatnog filtera. Ugnježdeni `group` nije detaljan objekat sa pitanjima.

### 8.5. Promena veličine kviza kada izvori koriste tačne brojeve

Kviz i raspodela trenutno nemaju zajedničku rutu za atomsku izmenu. Da promeniš,
na primer, ukupni broj sa 10 na 12:

1. Sačuvaj trenutnu tabelu izvora u editoru i pripremi novu sa zbirom 12.
2. Preporučeno: privremeno postavi kviz na `draft` da se ne koristi delimično stanje.
3. `PUT /:quizId/sources` sa `{ "sources": [] }`.
4. `PATCH /:quizId` sa `{ "question_count": 12 }`.
5. PUT nove kompletne raspodele čiji je zbir 12.
6. Proveri stanje i po potrebi vrati `published`.

Ovo je niz nezavisnih zahteva, ne jedna transakcija. Posle greške ponovo učitaj stanje
kviza i izvora i omogući nastavak čuvanja. U procentnom režimu zbir ostaje 100 pri
promeni broja pitanja, ali ponovo proveri raspoloživost kandidata za nove kvote.

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
    "position": 0
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
{ "min_watch_percentage": null, "min_watch_seconds": 60 }
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
{ "success": true, "requirements_met": false }
```

Korisnik dolazi iz access tokena; ne šalješ `user_id`. Rezultat je objekat sa boolean
poljem, ne goli JSON `false`. Potrebna je `quizzes.participate` permisija.
Kviz mora biti published; nepostojeći/draft/archived daju 404.

Ako kviz nema requiremente, rezultat je `requirements_met: true`.

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
| `requirements_met` | Da li je ispunjen svaki requirement |

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

## 10. Tokovi rada i osvežavanje podataka

### 10.1. Kreiranje kompletne konfiguracije

1. Učitaj dozvoljene akcije korisnika i pripremi autorske ekrane.
2. Napravi grupe kroz POST `/question-groups` i sačuvaj ID-jeve.
3. Napravi pitanja; dodaj grupe kroz `group_ids` ili kasnije grupnim PUT-om.
4. Napravi `draft` kviz sa ciljanim `question_count`.
5. Poveži kandidate kroz POST `/:quizId/questions`; postavi poene i položaje.
6. Ako koristiš grupe za raspodelu, proveri preseke sa kandidatima i sačuvaj sve
   izvore jednim PUT-om. Bez izvora ovaj korak možeš preskočiti.
7. Dodaj potrebne video requiremente. Ako nisu potrebni, ostavi prazan skup.
8. Proveri popunjenost pitanja, broj kandidata, kvote, vlasništvo i video pragove.
9. Postavi `status: "published"` običnim PATCH-om kviza.

Nema jedne create rute koja automatski kreira sve ove entitete ili veze.
Nemoj POST-ovati `questions`, `sources`, `requirements` ili `groups` unutar quiz body-ja.
Dozvoljene input šeme su stroge i takav payload će biti odbijen.

### 10.2. Učitavanje editora kviza

Posle uspešnog GET-a kviza, nezavisne tabove možeš učitati paralelno:

- GET `/:quizId/questions` — kandidati i poeni.
- GET `/:quizId/sources` — raspodela po grupama.
- GET `/quiz-requirements?quiz_id=...` — video uslovi i kartice.

Svaki tab ima sopstvenu paginaciju. Za prebrojavanje svih kandidata koristi njegov
`pagination.total`, ne `questions.length` prve strane. Za edit cele source tabele
učitaj sve njene strane pre PUT-a, da ne bi obrisao izvore sa drugih strana.

### 10.3. Predloženi query/cache ključevi

U ključeve privatnih podataka uključi korisnika i sve filtere; pri promeni naloga
očisti cache. Sledeće tabele su preporuka za frontend, ne ugrađeno serversko ponašanje.

| Query | Primer oblika ključa |
| --- | --- |
| Lista pitanja | `["questions", userId, { type, group_id, page, limit, sortBy, sortOrder }]` |
| Detalji pitanja | `["question", userId, questionId]` |
| Lista/detalji grupa | `["question-groups", userId, query]`, `["question-group", userId, groupId]` |
| Lista/detalji kvizova | `["quizzes", userId, query]`, `["quiz", userId, quizId]` |
| Kandidati | `["quiz-questions", userId, quizId, query]` |
| Izvori | `["quiz-sources", userId, quizId, query]` |
| Video uslovi | `["quiz-requirements", userId, query]` |
| Napredak gledanja | `["quiz-requirements-progress", userId, quizId]` |

| Mutacija | Šta ponovo učitati / invalidirati |
| --- | --- |
| Tekst/tip/odgovori pitanja | Detalje i liste pitanja, prikaze grupa, kandidate koji prikazuju tekst |
| Promena `group_ids` | Detalje/liste pitanja, stare i nove detalje grupa, preglede raspoloživosti izvora |
| Preimenovanje grupe | Liste/detalje grupa, `groups` u pitanjima i `group` u izvorima |
| PUT članova grupe | Detalje grupe, pitanja čija se članstva menjaju, liste pitanja i provere source kandidata |
| Veza kviza i pitanja | Listu kandidata i UI proveru raspoloživosti izvora |
| Podešavanja/status kviza | Detalje i liste kvizova; pri `question_count` promeni i proveru izvora |
| PUT/PATCH/DELETE izvora | Sve strane source liste i njen lokalni zbir |
| Mutacija requirementa | Autorske liste/detalje, participant check i progress |
| Brisanje originalnog pitanja/grupe | Sve liste i otvorene detalje koji su ga referencirali |

### 10.4. Lokalno uređivanje formi

- Razdvoji read model (`groups`) i write model (`group_ids`).
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
grupa. Naziv baze/promenljive okruženja prilagodi svom frontend projektu.

```ts
type GroupRef = { id: string; name: string };
type Pagination = {
  page: number; limit: number; total: number; totalPages: number;
  hasNextPage: boolean; hasPreviousPage: boolean;
};
type QuestionSummary = {
  id: string; user_id: string;
  type: "single_choice" | "multiple_choice" | "matching";
  content: string; explanation: string | null;
  created_at: string; updated_at: string; groups: GroupRef[];
};
type QuestionListResponse = {
  success: true; questions: QuestionSummary[];
  pagination: Pagination; sorting: { sortBy: string; sortOrder: "asc" | "desc" };
};
type QuestionListQuery = {
  page?: number; limit?: number; type?: QuestionSummary["type"];
  group_id?: string;
  sortBy?: "created_at" | "updated_at" | "content" | "type";
  sortOrder?: "asc" | "desc";
};
type SourceInput = {
  group_id: string; position?: number;
  question_percentage?: number | null; question_count?: number | null;
};
type Source = {
  quiz_id: string; group_id: string; position: number;
  question_percentage: number | null; question_count: number | null;
  group: { id: string; name: string; description: string | null };
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
    setQuestionGroups(questionId: string, groups: GroupRef[]) {
      return request<{ success: true; question: QuestionSummary }>(
        "/questions/" + encodeURIComponent(questionId),
        { method: "PATCH", body: { group_ids: groups.map(group => group.id) } },
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

`setQuestionGroups` tip koristi summary kao podskup; stvarni response dodatno sadrži
nizove odgovora. Za editor uvedi detaljan tip koji uključuje `options`,
`matching_options`, `matching_items` iz odeljka 4. Ne uklanjaj ta polja pri lokalnom
ažuriranju cache-a ako ih ekran koristi.

## 12. Greške i ograničenja

### 12.1. Oblik grešaka

Većina kontrolera vraća:

```json
{ "success": false, "message": "Question not found" }
```

Validation helper vraća 400 i prvu poruku greške. Trenutno nema zajedničkog
`errors: [{ field, message }]` ugovora. UI može lokalno vezati pravila za inpute,
a serversku `message` prikazati u poruci forme.

Permisijski middleware nije potpuno isti za sve rute. `requirePermission` može
vratiti 403 bez `success` polja:

```json
{ "message": "Insufficient permissions", "requiredPermission": "questions.create" }
```

Resource access middleware obično vraća `{ success: false, message }`.
Zato grešku uvek prepoznaj preko **HTTP statusa**, ne samo preko `success`.

### 12.2. Statusi i tipični primeri

| Status | Primer | Frontend postupak |
| --- | --- | --- |
| 400 | Neispravan UUID, nepoznato polje, prazan PATCH, nevalidan zbir izvora, oba watch praga popunjena | Prikaži poruku i sačuvaj lokalne izmene forme |
| 401 | Nema tokena, istekao token, neaktivan nalog ili promenjeno ovlašćenje tokena | Pokreni postojeći auth tok i spreči petlju ponavljanja |
| 403 | Nedostaje potrebna permisija | Prikaži zabranu akcije; ne ponavljaj isti zahtev automatski |
| 404 | Resurs ne postoji ili je izvan own scope-a; participant provera za neobjavljen kviz | Osveži prikaz dostupnosti, ukloni zastareli izbor |
| 409 | Dupli naziv grupe istog vlasnika, isti kandidat/izvor/video requirement već povezan | Ponovo učitaj postojeće stanje |
| 500 | Nemapirana DB/servis greška | Prikaži generičku poruku i omogući kontrolisan retry |

Primeri serverskih poruka korisnih pri povezivanju formi:

- `One or more question groups were not found`
- `One or more questions were not found`
- `This question is already linked to the quiz`
- `This group is already a source for the quiz`
- `This video is already a requirement for the quiz`
- `Exactly one of question_percentage and question_count must be set`
- `Source percentages must sum to 100; replace the complete allocation using PUT`
- `Source question counts must sum to the quiz question_count; replace the complete allocation using PUT`
- `Exactly one of min_watch_percentage and min_watch_seconds must be set`
- `min_watch_seconds requires a known video duration and cannot exceed it`

Nemoj parsirati tekst poruke kao stabilan machine-readable kod. Većina ruta iz
ovog vodiča ne vraća poseban `code`.

### 12.3. Bitna trenutna ograničenja

- Liste pitanja/grupa/kvizova nemaju filter po proizvoljnom `user_id`.
- Lista banke pitanja nema full-text/name/content pretragu; ima `type` i `group_id`.
- Nema ugrađenog bulk povezivanja kandidata ili bulk reordering rute.
- Nema quiz thumbnail/upload rute ni quiz `visibility` polja u ovim šemama.
- Grupne detalje dobijaš cele; nema paginacije `group.questions` u tom odgovoru.
- Source CRUD validira vlasništvo, režim i ukupne kvote, ali čuvanje source tabele
  samo po sebi ne potvrđuje dovoljan broj različitih, popunjenih kandidata.
- Publish PATCH ne radi kompletnu proveru svih delova kviza.
- Ugnježdeni odgovori `group`, `question`, `groups` zavise od konteksta; nisu svi
  jednaki detaljnim resursima. Vidi odeljke 4, 5, 7 i 8.
- Ne tretiraj karticu nedostupnog videa kao ispunjen ili uklonjen uslov.
- Medijske greške mogu biti generički 500 kroz requirement kontroler; frontend
  ne treba da zavisi od garantovanog specifičnog statusa za svaki medijski problem.

## 13. Kontrolna lista za integraciju

- [ ] Sve rute koriste `/api/quizzes` prefiks i važeći access token.
- [ ] UI akcije prate permisije, uključujući Owner i `_any` scope.
- [ ] Reader/admin liste se ne tretiraju automatski kao sopstvene liste.
- [ ] Filteri, sorting i pagination ulaze u query ključeve; novi filter vraća prvu stranu.
- [ ] Pitanja se čitaju preko `groups: [{ id, name }]`, a upisuju preko `group_ids`.
- [ ] Početne liste i ugnježdeni summary objekti se razlikuju od detaljnih objekata.
- [ ] Choice i matching editori čuvaju stabilne brojeve opcija i stavki.
- [ ] PUT članstva i izvora šalje kompletan nameravani skup, učitan sa svih strana.
- [ ] `quiz_questions` kandidati i source grupa povezani su nezavisno i imaju istog vlasnika.
- [ ] Izvori koriste jedan režim, tačan zbir i dovoljno različitih kandidata.
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
- `src/database/migrations/1792281600001_add-quiz-sources.sql` — validacija raspodele izvora.
- `src/database/sql/videoCardFragments.js` i `src/modules/videos/helpers/videoCardMedia.js` — video kartice i mediji.

Pregled po rutama obuhvata 34 kombinacije HTTP metode i putanje, bez podmodula
`quiz-attempts`. Primeri su dokumentacioni i ne izvršavaju API zahteve.
