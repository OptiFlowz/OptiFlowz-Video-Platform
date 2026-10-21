# Uvoz i izvoz pitanja: Moodle XML

Obe rute zahtevaju Bearer token i rade sa bankom pitanja prijavljenog korisnika.
Ne kreiraju kvizove, veze sa kvizovima, izvore ili pokušaje. Čak i Owner izvozi svoju banku.
Format je [Moodle XML](https://docs.moodle.org/403/en/Moodle_XML_format), UTF-8.

## POST `/api/quizzes/questions/import`

Potrebna je permisija `questions.create` (Owner je ima implicitno).
Pošalji **multipart/form-data**, jedno polje `file` tipa File, sa `.xml` fajlom.
U Postmanu ne postavljaj ručno Content-Type za form-data: boundary se dodaje automatski.
Alternativno pošalji ceo XML kao body sa `Content-Type: application/xml` ili `text/xml`.
JSON body nije podržan.

Opcioni query parametar `category_id` preusmerava sva pitanja u postojeću sopstvenu kategoriju.
Ako nije zadat, kategorije se čitaju iz XML-a: postojeća kategorija istog imena se koristi,
a nedostajuća se kreira samo uz permisiju `question_categories.create`.
Moodle putanja `$course$/top/Programiranje/Osnove` postaje jedna kategorija `Programiranje/Osnove`.
Naš model je ravan: nema hijerarhije kategorija. Putanja posle uklanjanja Moodle konteksta i
početnog `top` može imati najviše 255 znakova. `$course$/top` predstavlja pitanja bez kategorije.
Ako nema kategorije u fajlu, pitanja ostaju bez kategorije.

```json
{
  "success": true,
  "imported_count": 1,
  "questions": [
    { "id": "novi-uuid", "type": "single_choice", "max_points": 2.75,
      "category": { "id": "uuid-kategorije", "name": "Programiranje/Osnove" } }
  ],
  "warnings": []
}
```

Odgovor je **201**. Svaki uvoz kreira nova pitanja i nove interne identifikatore odgovora.
Ponovljen uvoz istog fajla kreira duplikate; ne ažurira postojeća pitanja po Moodle ID-u ili nazivu.
Cela datoteka se validira pre upisa. Pitanja, odgovori i nove kategorije upisuju se u jednoj
transakciji: greška poništava ceo uvoz. Maksimum: **5 MiB i 1000 pitanja**.

## GET `/api/quizzes/questions/export`

Potrebna je `questions.read_own` ili `questions.read_any`. Izvoz je uvek ograničen na sopstvena pitanja.
Odgovor **200** je `application/xml; charset=utf-8`, attachment `questions-moodle.xml`, `Cache-Control: no-store`.

Opcioni query parametri (mogu se kombinovati):

| Parametar | Primer | Značenje |
| --- | --- | --- |
| `question_ids` | `uuid1,uuid2` | Eksplicitna lista, najviše 1000 UUID-ova |
| `category_id` | `uuid-kategorije` | Samo pitanja kategorije |
| `type` | `single_choice` | `single_choice`, `multiple_choice` ili `matching` |

Bez filtera izvozi se cela sopstvena banka, do 1000 pitanja i 5 MiB.
Nema implicitne paginacije ili tihog skraćivanja: prevelik izvoz zahteva uži filter.
Ako je izričito tražen nedostupan ID ili pitanje ne zadovoljava ostale filtere, odgovor je 404.
Ako nema rezultata, odgovor je 404. Izvoz nepotpunog draft pitanja vraća 422 sa ID-em pitanja.

## Mapiranje i granice kompatibilnosti

| Naš model | Moodle XML |
| --- | --- |
| `single_choice` | `multichoice`, `single=true` |
| `multiple_choice` | `multichoice`, `single=false` |
| `matching` | `matching` (uvoz prihvata i `match`) |
| `content` | `questiontext/text` |
| `explanation` | `generalfeedback/text` |
| `max_points` | `defaultgrade`, default 1 ako nedostaje |
| `category.name` | category putanja |

Moodle `truefalse` se uvozi kao `single_choice` uz upozorenje.
HTML sadržaj i CDATA ostaju sačuvani; `plain_text` se pretvara u bezbedno escapovan HTML
sa `<br>` za novi red. Drugi formati teksta (`markdown`, `moodle_auto_format` itd.) sa nepraznim
sadržajem zahtevaju prethodnu konverziju u HTML ili plain_text. Izvoz koristi HTML.
Frontend treba da koristi isti bezbedan prikaz/sanitizaciju HTML-a kao za ostala autorska pitanja.

Za multiple-choice uvoz mora imati jednake pozitivne težine (npr. 50/50 ili 33.33333/33.33333/33.33333).
Pozitivne frakcije postaju tačne opcije. Negativne/nulte postaju netačne; originalne kazne se ne čuvaju.
Odgovor zato sadrži upozorenje `QUIZ_SCORING_APPLIES`: kod nas bodovanje određuje `quiz.scoring_mode`.
Izvoz deli 100% ravnomerno između tačnih opcija i -100% između netačnih, što odgovara našem
`partial_credit` modelu. Podešavanje kviza `exact_match` nije deo fajla banke pitanja i ne prenosi se.
Single-choice zahteva tačno jednu opciju sa 100%; delimično tačne opcije tog tipa nisu podržane.

Matching čuva ponovljena povezivanja na isti odgovor i dodatne distraktore (prazan Moodle subquestion).
Moodle razlikuje desne odgovore po tekstu: izvoz odbija različite lokalne opcije sa istim tekstom.
Za Moodle izvoz su potrebne najmanje dve leve stavke i tri subquestion reda uključujući distraktore.
Choice izvoz zahteva najmanje dve ponuđene opcije.

Ne čuvamo poseban Moodle naziv pitanja, ID/version, tags, hints, feedback po odgovoru,
combined feedback, penalty ili shuffle podešavanja pitanja. Naziv pri izvozu je `Question <uuid>`;
shuffle i bodovanje se kod nas podešavaju na kvizu. Za izgubljeni feedback/hints/tags se vraćaju
upozorenja. Opšti feedback (`explanation`) se čuva.

Nepodržani tipovi (`essay`, `numerical`, `shortanswer`, `cloze`, plugin tipovi), ugrađeni fajlovi
`<file>`, legacy slike i `@@PLUGINFILE@@` reference vraćaju 422. Ne preskaču se tiho.
Spoljne URL adrese u HTML-u ostaju u tekstu, ne preuzimaju se.
DTD i custom XML entities nisu podržani. Ne prihvata se Moodle `.mbz` backup niti GIFT.

## Korišćenje u Moodle-u

1. U banci pitanja izaberi **Export → Moodle XML format** i preuzmi `.xml`.
2. Pošalji ga našoj POST import ruti; prikaži korisniku eventualni `warnings` niz.
3. Za obrnut smer preuzmi XML preko GET export rute.
4. U Moodle banci izaberi **Import → Moodle XML format**; uključi **Get category from file** ako želiš kategorije iz fajla.

Primer za ručno isprobavanje sva tri tipa je `tests/fixtures/moodle-questions.xml`.
Format i matching mapiranje provereni su prema Moodle dokumentaciji i
[Moodle 4.5 XML importer/exporter kodu](https://github.com/moodle/moodle/blob/MOODLE_405_STABLE/question/format/xml/format.php).
Automatski testovi pokrivaju XML konverziju, HTTP rute i PostgreSQL; ne pokreću Moodle server.

## Greške

- 400: pogrešni parametri, nedostaje fajl, neispravan UTF-8/upload.
- 401/403: autentifikacija ili permisije.
- 404: nedostupna kategorija ili tražena pitanja.
- 413: fajl ili izvoz preko 5 MiB.
- 415: nepodržan HTTP Content-Type.
- 422: neispravan XML, nepodržan tip/format/struktura, preko 1000 pitanja ili nevalidno pitanje.
