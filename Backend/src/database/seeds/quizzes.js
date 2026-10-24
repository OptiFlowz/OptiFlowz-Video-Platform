import 'dotenv/config';
import pg from 'pg';
import { z } from 'zod';
import { validateQuestionForActivation } from '../../modules/quizzes-engine/questions/helpers/questions.validation.js';
import { createQuestion } from '../../modules/quizzes-engine/questions/repository/questions.repository.js';
import { v5 as uuidv5 } from 'uuid';
import { createQuizSchema } from '../../modules/quizzes-engine/quizzes/helpers/quizzes.validation.js';
import { createQuestionCategorySchema } from '../../modules/quizzes-engine/question-categories/helpers/question-categories.validation.js';
import { createQuizRequirementSchema, validateVideoDuration } from '../../modules/quizzes-engine/quiz-requirements/helpers/quiz-requirements.validation.js';
import { createQuizRequirement, lockAccessibleVideo } from '../../modules/quizzes-engine/quiz-requirements/repository/quiz-requirements.repository.js';
import { replaceQuizSourcesSchema } from '../../modules/quizzes-engine/quiz-sources/helpers/quiz-sources.validation.js';
import { getAttemptQuestionPool, getAttemptSources } from '../../modules/quizzes-engine/quiz-attempts/repository/quiz-attempts.repository.js';
import { selectAttemptQuestions, snapshotQuizSettings, validateCandidates } from '../../modules/quizzes-engine/quiz-attempts/helpers/attemptQuestions.js';

function choice(type, content, explanation, answers, correct) {
  return {
    type, content, explanation, category_id: null, matching_options: [], matching_items: [],
    options: answers.map((answer, index) => ({
      option_no: index + 1, content: answer, is_correct: correct.includes(index + 1), position: index + 1,
    })),
  };
}

function matching(content, explanation, options, items) {
  return {
    type: 'matching', content, explanation, category_id: null, options: [],
    matching_options: options.map((answer, index) => ({ option_no: index + 1, content: answer, position: index + 1 })),
    matching_items: items.map(([item, correct], index) => ({
      item_no: index + 1, content: item, correct_option_no: correct, position: index + 1,
    })),
  };
}

const seedQuestions = [
  choice('single_choice', 'Koliko bitova ima jedan bajt?', 'Jedan bajt sadrži osam bitova.',
    ['4', '8', '16', '32'], [2]),
  choice('single_choice', 'Koji HTTP metod se uobičajeno koristi za preuzimanje resursa?', 'GET služi za preuzimanje reprezentacije resursa.',
    ['POST', 'DELETE', 'GET', 'PATCH'], [3]),
  choice('single_choice', 'Koji SQL izraz koristiš za čitanje podataka iz tabele?', 'SELECT bira podatke iz baze.',
    ['INSERT', 'UPDATE', 'DROP', 'SELECT'], [4]),
  choice('single_choice', 'Koji HTTP status označava da resurs nije pronađen?', 'Status 404 znači Not Found.',
    ['200', '201', '404', '500'], [3]),
  choice('single_choice', 'Šta znači vrednost null u JSON dokumentu?', 'null predstavlja eksplicitno odsustvo vrednosti.',
    ['Broj nula', 'Odsustvo vrednosti', 'Prazan niz', 'Prazan string'], [2]),
  choice('single_choice', 'Koji simbol počinje jednolinijski komentar u JavaScriptu?', 'Dve kose crte započinju jednolinijski komentar.',
    ['//', '<!--', '**', '--'], [1]),
  choice('single_choice', 'Koji uslov u SQL upitu filtrira pojedinačne redove pre grupisanja?', 'WHERE filtrira redove; HAVING filtrira grupe.',
    ['ORDER BY', 'WHERE', 'GROUP BY', 'LIMIT'], [2]),
  choice('single_choice', 'Koja Git komanda prikazuje stanje radnog direktorijuma?', 'git status prikazuje izmene i stanje pripreme za commit.',
    ['git push', 'git init', 'git status', 'git clone'], [3]),
  choice('multiple_choice', 'Koje od navedenih vrednosti su validne JSON vrednosti?', 'JSON podržava booleane, null i nizove, ali ne undefined.',
    ['true', 'null', '[1, 2, 3]', 'undefined'], [1, 2, 3]),
  choice('multiple_choice', 'Koje prakse pomažu u zaštiti korisničkih naloga?', 'Jedinstvene lozinke i drugi faktor smanjuju rizik kompromitovanja naloga.',
    ['Jedinstvena lozinka za svaki servis', 'Dvofaktorska autentifikacija', 'Deljenje lozinke u javnom četu', 'Ista lozinka na svim servisima'], [1, 2]),
  choice('multiple_choice', 'Koje SQL naredbe mogu menjati redove u postojećoj tabeli?', 'INSERT dodaje, UPDATE menja, a DELETE uklanja redove.',
    ['INSERT', 'SELECT', 'UPDATE', 'DELETE'], [1, 3, 4]),
  choice('multiple_choice', 'Koji od navedenih tipova postoje u PostgreSQL-u?', 'uuid, jsonb i boolean su PostgreSQL tipovi podataka.',
    ['uuid', 'jsonb', 'boolean', 'html_element'], [1, 2, 3]),
  choice('multiple_choice', 'Koje HTTP status kodove svrstavamo u uspešne odgovore?', 'Uspešni HTTP odgovori pripadaju opsegu 2xx.',
    ['200', '201', '204', '403'], [1, 2, 3]),
  choice('multiple_choice', 'Koje JavaScript metode niza vraćaju novi niz?', 'map i filter vraćaju nove nizove; push vraća dužinu, a forEach undefined.',
    ['map', 'push', 'filter', 'forEach'], [1, 3]),
  matching('Poveži HTTP status sa njegovim značenjem.', '200 označava uspeh, 404 nepostojeći resurs, a 500 internu grešku servera.',
    ['Resurs nije pronađen', 'Interna greška servera', 'Uspešan zahtev'], [['200', 3], ['404', 1], ['500', 2]]),
  matching('Poveži SQL naredbu sa njenom namenom.', 'SELECT čita, INSERT dodaje, a UPDATE menja postojeće podatke.',
    ['Dodavanje redova', 'Izmena redova', 'Čitanje podataka'], [['SELECT', 3], ['INSERT', 1], ['UPDATE', 2]]),
  matching('Poveži ekstenziju fajla sa tipom sadržaja.', 'JSON čuva strukturirane podatke, CSS stilove, a HTML strukturu stranice.',
    ['Stilovi stranice', 'Struktura web stranice', 'Strukturirani podaci'], [['.json', 3], ['.css', 1], ['.html', 2]]),
  matching('Poveži Git komandu sa njenom osnovnom namenom.', 'clone kopira repozitorijum, commit beleži pripremljene izmene, a log prikazuje istoriju.',
    ['Prikazuje istoriju commitova', 'Kopira repozitorijum', 'Beleži pripremljene izmene'], [['git clone', 2], ['git commit', 3], ['git log', 1]]),
  matching('Poveži ograničenje baze sa njegovim značenjem.', 'NOT NULL zahteva vrednost, UNIQUE sprečava duplikate prema pravilima ograničenja, a FOREIGN KEY održava referencijalni integritet.',
    ['Veza sa referenciranim ključem', 'Zabranjena NULL vrednost', 'Jedinstvenost vrednosti'], [['NOT NULL', 2], ['UNIQUE', 3], ['FOREIGN KEY', 1]]),
  matching('Poveži JavaScript operator sa njegovom namenom.', '=== poredi bez konverzije tipa, && je logičko AND, a ! logička negacija.',
    ['Logička negacija', 'Stroga jednakost', 'Logičko AND'], [['===', 2], ['&&', 3], ['!', 1]]),
];

// A stable ID per owner makes reruns safe even after the quiz has been renamed.
function seedQuizId(userId) {
  return uuidv5('optiflowz:quizzes-engine:demo:v1', userId);
}

async function findSeedQuiz(client, userId) {
  const { rows } = await client.query('SELECT * FROM public.quizzes WHERE id = $1 FOR UPDATE', [seedQuizId(userId)]);
  if (rows[0] && rows[0].user_id !== userId) throw new Error('Seed quiz belongs to another user');
  return rows[0] || null;
}

async function seedQuizVideos(client, userId, videoIds = [], quizId = seedQuizId(userId)) {
  const { rows: existing } = await client.query(
    'SELECT video_id, position FROM public.quiz_requirements WHERE quiz_id = $1 ORDER BY position, video_id', [quizId],
  );
  if (existing.length >= 2) return [];
  const existingIds = existing.map(requirement => requirement.video_id);
  if (!videoIds.length) {
    const { rows } = await client.query(`
      SELECT id FROM public.videos
      WHERE mux_status = 'ready' AND visibility = 'public' AND published_at <= now() AND duration_seconds >= 1
      ORDER BY (uploaded_by = $1) DESC, id LIMIT 2 FOR SHARE
    `, [userId]);
    videoIds = rows.map(video => video.id);
  }
  videoIds = [...new Set([...existingIds, ...videoIds])].slice(0, 2);
  if (videoIds.length !== 2 || new Set(videoIds).size !== 2) {
    throw new Error('Two distinct available videos are required. Pass --video-id <uuid> twice; no data was saved.');
  }
  const videos = [];
  for (const id of videoIds) {
    if (existingIds.includes(id)) continue;
    const video = await lockAccessibleVideo(client, id, userId);
    if (!video || !Number.isFinite(Number(video.duration_seconds)) || Number(video.duration_seconds) < 1) {
      throw new Error(`Video ${id} must be accessible, ready and have a positive duration`);
    }
    const usedPositions = [...existing.map(requirement => requirement.position), ...videos.map(item => item.seed_position)];
    videos.push({ ...video, seed_position: usedPositions.includes(0) ? 1 : 0 });
  }
  return videos;
}

async function seedCompleteQuiz(client, userId, questions, videos, existingQuiz = null) {
  const quizId = seedQuizId(userId);
  const settings = createQuizSchema.parse({
    title: 'Demo kviz — osnove programiranja i weba',
    description: 'Seed primer: banka od 20 pitanja, 2 fiksna + 8 nasumičnih iz tri kategorije i dva video uslova.',
    status: 'published', time_limit_seconds: 900, max_attempts: 3,
    passing_score_percentage: 70, shuffle_questions: true, shuffle_options: true,
    min_answered_percentage: 100, min_correct_percentage: 0,
    correctness_visibility: 'after_check', correct_answers_visibility: 'after_finish',
    explanation_visibility: 'after_check', explanation_incorrect_only: true,
    allow_answer_changes_after_check: false, allow_attempt_review: true,
    show_final_score: true, scoring_mode: 'partial_credit', certificate_template_id: null,
  });
  // Field names come only from the strict application schema above, never CLI input.
  const fields = Object.keys(settings);
  let quiz = existingQuiz;
  if (!quiz) {
    const { rows } = await client.query(`
    INSERT INTO public.quizzes (id, user_id, ${fields.join(', ')})
    VALUES ($1, $2, ${fields.map((_, index) => `$${index + 3}`).join(', ')}) RETURNING *
  `, [quizId, userId, ...fields.map(field => settings[field])]);
    quiz = rows[0];
  }

  const categoryDefinitions = [
    { type: 'single_choice', label: 'Jedan tačan odgovor', count: 3, points: 1 },
    { type: 'multiple_choice', label: 'Više tačnih odgovora', count: 2, points: 2 },
    { type: 'matching', label: 'Povezivanje pojmova', count: 3, points: 3 },
  ];
  const sources = [];
  for (const [position, definition] of categoryDefinitions.entries()) {
    const categoryId = uuidv5(`group:${definition.type}`, quizId);
    const category = createQuestionCategorySchema.parse({
      name: `Demo kviz — ${definition.label}`,
      description: `Kategorija za kompletan seed kviz (${definition.type}).`,
    });
    await client.query(`INSERT INTO public.question_categories (id, user_id, name, description)
      VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO NOTHING`, [categoryId, userId, category.name, category.description]);
    const { rows: ownedCategories } = await client.query(
      'SELECT id FROM public.question_categories WHERE id = $1 AND user_id = $2 FOR SHARE', [categoryId, userId],
    );
    if (!ownedCategories.length) throw new Error('Seed category belongs to another user');
    const members = questions.filter(question => question.type === definition.type);
    await client.query(`UPDATE public.questions SET category_id=$1
      WHERE id=ANY($2::uuid[]) AND category_id IS NULL`, [categoryId, members.map(question => question.id)]);
    sources.push({ category_id: categoryId, position: position + 2, max_points: definition.points, question_count: definition.count });
  }
  const fixed = ['single_choice', 'multiple_choice'].map(type => questions.find(question => question.type === type));
  // Normalize only this demo's known question links when upgrading an older seed.
  await client.query('DELETE FROM public.quiz_questions WHERE quiz_id=$1 AND question_id=ANY($2::uuid[]) AND NOT (question_id=ANY($3::uuid[]))',
    [quizId, questions.map(q => q.id), fixed.map(q => q.id)]);
  await client.query(`INSERT INTO public.quiz_questions (quiz_id, question_id, position, max_points)
    SELECT $1, question_id, position, max_points FROM jsonb_to_recordset($2::jsonb)
      AS input(question_id uuid, position integer, max_points numeric)
    ON CONFLICT (quiz_id, question_id) DO NOTHING`, [quizId, JSON.stringify(
    fixed.map((question, position) => ({ question_id: question.id, position,
      max_points: categoryDefinitions.find(category => category.type === question.type).points })),
  )]);
  const parsed = replaceQuizSourcesSchema.parse({ sources });
  for (const source of parsed.sources) {
    await client.query(`INSERT INTO public.quiz_sources (quiz_id, category_id, position, max_points, question_count)
      VALUES ($1, $2, $3, $4, $5) ON CONFLICT (quiz_id, category_id) WHERE category_id IS NOT NULL DO UPDATE SET position=EXCLUDED.position, max_points=EXCLUDED.max_points, question_count=EXCLUDED.question_count`,
    [quizId, source.category_id, source.position, source.max_points, source.question_count]);
  }
  for (const video of videos) {
    const position = video.seed_position;
    const requirement = createQuizRequirementSchema.parse({
      quiz_id: quizId, video_id: video.id, position,
      min_watch_percentage: position === 0 ? 50 : null,
      min_watch_seconds: position === 1 ? Math.min(30, Math.floor(Number(video.duration_seconds))) : null,
    });
    validateVideoDuration(requirement, video);
    await createQuizRequirement(client, requirement);
  }
  return (await client.query('SELECT * FROM public.quizzes WHERE id=$1', [quizId])).rows[0];
}

async function describeSeedQuiz(client, quiz) {
  const candidates = await getAttemptQuestionPool(client, quiz.id);
  const sources = await getAttemptSources(client, quiz.id);
  if (candidates.some(question => question.user_id !== quiz.user_id)
    || sources.some(source => source.user_id !== quiz.user_id)) throw new Error('Seed ownership mismatch');
  // Validate that quotas can be satisfied in memory; never create an attempt.
  const selection = selectAttemptQuestions(candidates, sources, snapshotQuizSettings(quiz));
  validateCandidates(selection);
  const { rows: requirements } = await client.query(`SELECT r.*, v.title AS video_title
    FROM public.quiz_requirements r JOIN public.videos v ON v.id = r.video_id
    WHERE r.quiz_id = $1 ORDER BY r.position, r.video_id`, [quiz.id]);
  const { rows: [{ count: attempts }] } = await client.query(
    'SELECT count(*)::integer AS count FROM public.quiz_attempts WHERE quiz_id = $1', [quiz.id],
  );
  return {
    id: quiz.id, title: quiz.title, status: quiz.status, bank_pool_count: candidates.length, fixed_count: candidates.filter(q => q.is_fixed).length,
    question_count: quiz.question_count, selection_valid: selection.length === quiz.question_count,
    sources: sources.map(source => ({ category_id: source.category_id, max_points: source.max_points,
      question_count: source.question_count, candidates: candidates.filter(q => !q.is_fixed && q.category_id === source.category_id).length })),
    requirements, existing_attempts: attempts,
  };
}

// Usage: npm run seed:quizzes -- --user-id <uuid>
// Or:   npm run seed:quizzes -- --email <email>
// Both seed:questions (legacy alias) and seed:quizzes seed the complete quiz.
// Uses DATABASE_URL from the environment/.env. Normalizes demo links/sources; preserves question content and attempts.
async function main() {
  const args = process.argv.slice(2);
  let flag, owner;
  const videoIds = [];
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index], value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    if (key === '--video-id') videoIds.push(z.string().uuid().parse(value).toLowerCase());
    else if (['--user-id', '--email'].includes(key) && !owner) { flag = key; owner = value; }
    else throw new Error(`Unknown or duplicate argument: ${key}`);
  }
  if (!owner || (videoIds.length !== 0 && (videoIds.length !== 2 || new Set(videoIds).size !== 2))) {
    throw new Error('Usage: npm run seed:quizzes -- --email <email> | --user-id <uuid> [--video-id <uuid> --video-id <uuid>]');
  }
  if (flag === '--user-id') z.string().uuid().parse(owner);
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const questions = seedQuestions.map(validateQuestionForActivation);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  try {
    await client.connect();
    await client.query('BEGIN');
    const { rows: users } = await client.query(
      flag === '--user-id'
        ? 'SELECT id, email FROM public.users WHERE id = $1 FOR SHARE'
        : 'SELECT id, email FROM public.users WHERE lower(email) = lower($1) FOR SHARE',
      [owner],
    );
    if (users.length !== 1) throw new Error('Expected exactly one existing owner');
    const user = users[0];
    // Serialize repeated seed runs for this user so they do not insert duplicates.
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`seed:questions:${user.id}`]);
    const existingQuiz = await findSeedQuiz(client, user.id);
    const videos = await seedQuizVideos(client, user.id, videoIds);
    const result = { user_id: user.id, email: user.email, quiz_reused: Boolean(existingQuiz), inserted: 0, skipped: 0, questions: [] };
    for (const question of questions) {
      const { rows: existing } = await client.query(
        'SELECT id FROM public.questions WHERE user_id = $1 AND type = $2 AND content = $3 ORDER BY id LIMIT 1',
        [user.id, question.type, question.content],
      );
      const saved = existing[0] || await createQuestion(client, user.id, question);
      result[existing.length ? 'skipped' : 'inserted'] += 1;
      result.questions.push({ id: saved.id, type: question.type });
    }
    const quiz = await seedCompleteQuiz(client, user.id, result.questions, videos, existingQuiz);
    result.quiz = await describeSeedQuiz(client, quiz);
    await client.query('COMMIT');
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

main().catch(error => {
  console.error(`Quiz seed failed: ${error.message}`);
  process.exitCode = 1;
});
