import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('attempt questions and answers preserve snapshots and enforce composite relationships and cascades', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  const migration = async file => (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8'))
    .replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  await client.query('CREATE TEMP TABLE users (id uuid PRIMARY KEY)');
  for (const file of ['1791590400001_add-questions.sql', '1791590400004_add-quizzes.sql', '1792195200001_add-quiz-attempts.sql']) {
    await client.query((await migration(file))[0]);
  }
  const [up, down] = await migration('1792195200002_add-quiz-attempt-questions-and-answers.sql');
  await client.query(up);
  const user = randomUUID(), quiz = randomUUID(), source = randomUUID(), attemptA = randomUUID(), attemptB = randomUUID();
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1)', [user]);
  await client.query("INSERT INTO pg_temp.quizzes(id,user_id,title,question_count) VALUES ($1,$2,'Quiz',2)", [quiz, user]);
  await client.query("INSERT INTO pg_temp.questions(id,user_id,type,content) VALUES ($1,$2,'single_choice','Original question')", [source, user]);
  await client.query(`INSERT INTO pg_temp.quiz_attempts(id,quiz_id,user_id,attempt_no,status,settings_snapshot)
    VALUES ($1,$3,$4,1,'submitted','{}'),($2,$3,$4,2,'submitted','{}')`, [attemptA, attemptB, quiz, user]);
  const snapshot = { content: 'Original question', options: [{ option_no: 1, content: 'Answer', is_correct: true }] };
  const answer = { option_no: 1 };
  const addQuestion = async (number = 1, questionId = source, attemptId = attemptA) => (await client.query(`
    INSERT INTO pg_temp.quiz_attempt_questions(attempt_id,question_no,question_id,question_snapshot)
    VALUES ($1,$2,$3,$4) RETURNING *`, [attemptId, number, questionId, snapshot])).rows[0];
  const addAnswer = async (number = 1, attemptId = attemptA) => (await client.query(`
    INSERT INTO pg_temp.quiz_attempt_answers(attempt_id,question_no,answer)
    VALUES ($1,$2,$3) RETURNING *`, [attemptId, number, answer])).rows[0];
  const scenario = async (name, run) => t.test(name, async () => {
    await client.query('TRUNCATE pg_temp.quiz_attempt_answers, pg_temp.quiz_attempt_questions');
    await run();
  });

  await scenario('defaults, JSON payloads, nullable scoring and required fields match the schema', async () => {
    const question = await addQuestion();
    assert.equal(question.max_points, '1.00'); assert.deepEqual(question.question_snapshot, snapshot);
    const savedAnswer = await addAnswer();
    assert.deepEqual(savedAnswer.answer, answer); assert.ok(savedAnswer.updated_at instanceof Date);
    for (const field of ['checked_at', 'is_correct', 'awarded_points']) assert.equal(savedAnswer[field], null);
    for (const [table, fields] of [
      ['quiz_attempt_questions', ['attempt_id', 'question_no', 'question_snapshot', 'max_points']],
      ['quiz_attempt_answers', ['attempt_id', 'question_no', 'answer', 'updated_at']],
    ]) for (const field of fields) await assert.rejects(client.query(`UPDATE pg_temp.${table} SET ${field}=NULL`), { code: '23502' });
    await client.query('UPDATE pg_temp.quiz_attempt_questions SET max_points=2.50');
    const { rows: [graded] } = await client.query(`UPDATE pg_temp.quiz_attempt_answers
      SET checked_at=now(),is_correct=false,awarded_points=0.75 RETURNING *`);
    assert.ok(graded.checked_at instanceof Date); assert.equal(graded.is_correct, false); assert.equal(graded.awarded_points, '0.75');
    assert.equal((await client.query('SELECT max_points FROM pg_temp.quiz_attempt_questions')).rows[0].max_points, '2.50');
  });

  await scenario('composite keys prevent duplicates and answers cannot reference another attempt question', async () => {
    await addQuestion(); await addAnswer();
    await assert.rejects(addQuestion(1, null), { code: '23505', constraint: 'quiz_attempt_questions_pkey' });
    await assert.rejects(addQuestion(2), { code: '23505', constraint: 'quiz_attempt_questions_attempt_question_unique' });
    await assert.rejects(addAnswer(), { code: '23505', constraint: 'quiz_attempt_answers_pkey' });
    await assert.rejects(addAnswer(1, attemptB), { code: '23503', constraint: 'quiz_attempt_answers_question_fkey' });
    await assert.rejects(addAnswer(2), { code: '23503', constraint: 'quiz_attempt_answers_question_fkey' });
    await assert.rejects(addQuestion(1, null, randomUUID()), { code: '23503' });
    await assert.rejects(addQuestion(2, randomUUID()), { code: '23503' });
    await addQuestion(1, source, attemptB); await addAnswer(1, attemptB);
    await addQuestion(2, null); await addQuestion(3, null);
  });

  await scenario('deleting the source question retains snapshots, grading and answers in all attempts', async () => {
    for (const attempt of [attemptA, attemptB]) { await addQuestion(1, source, attempt); await addAnswer(1, attempt); }
    const before = (await client.query('SELECT * FROM pg_temp.quiz_attempt_answers ORDER BY attempt_id')).rows;
    await client.query('DELETE FROM pg_temp.questions WHERE id=$1', [source]);
    const questions = (await client.query('SELECT * FROM pg_temp.quiz_attempt_questions')).rows;
    assert.equal(questions.length, 2);
    for (const question of questions) {
      assert.equal(question.question_id, null); assert.deepEqual(question.question_snapshot, snapshot);
    }
    assert.deepEqual((await client.query('SELECT * FROM pg_temp.quiz_attempt_answers ORDER BY attempt_id')).rows, before);
  });

  await scenario('question and attempt deletion cascade only to their own children', async () => {
    for (const attempt of [attemptA, attemptB]) { await addQuestion(1, null, attempt); await addAnswer(1, attempt); }
    await addQuestion(2, null); await addAnswer(2);
    await client.query('DELETE FROM pg_temp.quiz_attempt_questions WHERE attempt_id=$1 AND question_no=1', [attemptA]);
    assert.deepEqual((await client.query('SELECT question_no FROM pg_temp.quiz_attempt_answers WHERE attempt_id=$1', [attemptA])).rows, [{ question_no: 2 }]);
    await client.query('DELETE FROM pg_temp.quiz_attempts WHERE id=$1', [attemptA]);
    for (const table of ['quiz_attempt_questions', 'quiz_attempt_answers']) {
      assert.deepEqual((await client.query(`SELECT attempt_id,question_no FROM pg_temp.${table}`)).rows, [{ attempt_id: attemptB, question_no: 1 }]);
    }
  });

  await scenario('rollback removes only the new tables and supports reapplying', async () => {
    await addQuestion(1, null, attemptB); await addAnswer(1, attemptB);
    await client.query(down);
    assert.deepEqual((await client.query(`SELECT to_regclass('pg_temp.quiz_attempt_questions') AS questions,
      to_regclass('pg_temp.quiz_attempt_answers') AS answers`)).rows[0], { questions: null, answers: null });
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quiz_attempts')).rows[0].n, 1);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM pg_temp.quizzes')).rows[0].n, 1);
    assert.ok((await client.query("SELECT to_regclass('pg_temp.questions') AS source")).rows[0].source);
    await client.query(up);
    await addQuestion(1, null, attemptB); assert.deepEqual((await addAnswer(1, attemptB)).answer, answer);
  });
});

test('quiz attempts migration constraints, indexes and rollback against session-local PostgreSQL tables', {
  skip: !process.env.TEST_DATABASE_URL,
}, async t => {
  const client = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 10000 });
  await client.connect();
  t.after(() => client.end());
  const migration = async file => (await readFile(new URL(`../src/database/migrations/${file}`, import.meta.url), 'utf8'))
    .replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  await client.query('CREATE TEMP TABLE users (id uuid PRIMARY KEY)');
  const [quizzesUp] = await migration('1791590400004_add-quizzes.sql');
  await client.query(quizzesUp);
  const [up, down] = await migration('1792195200001_add-quiz-attempts.sql');
  await client.query(up);
  const user = randomUUID(), otherUser = randomUUID(), quiz = randomUUID(), otherQuiz = randomUUID();
  await client.query('INSERT INTO pg_temp.users(id) VALUES ($1),($2)', [user, otherUser]);
  await client.query("INSERT INTO pg_temp.quizzes(id,user_id,title,question_count) VALUES ($1,$3,'Quiz',1),($2,$3,'Other quiz',1)", [quiz, otherQuiz, user]);
  const snapshot = { scoring_mode: 'partial_credit', show_final_score: false, min_correct_percentage: 75.25 };
  const insert = async (number = 1, status = 'in_progress', quizId = quiz, userId = user) => (await client.query(`
    INSERT INTO pg_temp.quiz_attempts(quiz_id,user_id,attempt_no,status,settings_snapshot)
    VALUES ($1,$2,$3,$4,$5) RETURNING *`, [quizId, userId, number, status, snapshot])).rows[0];
  const scenario = async (name, run) => t.test(name, async () => {
    await client.query('TRUNCATE pg_temp.quiz_attempts');
    await run();
  });

  await scenario('defaults and nullable result fields match the requested schema', async () => {
    const { rows: [attempt] } = await client.query(`INSERT INTO pg_temp.quiz_attempts(quiz_id,user_id,attempt_no,settings_snapshot)
      VALUES ($1,$2,1,$3) RETURNING *`, [quiz, user, snapshot]);
    assert.match(attempt.id, /^[0-9a-f-]{36}$/);
    assert.equal(attempt.status, 'in_progress');
    assert.ok(attempt.started_at instanceof Date);
    assert.deepEqual(attempt.settings_snapshot, snapshot);
    for (const field of ['expires_at', 'finished_at', 'earned_points', 'max_points', 'score_percentage', 'passed']) {
      assert.equal(attempt[field], null);
    }
    const { rows: [completed] } = await client.query(`UPDATE pg_temp.quiz_attempts SET
      status='submitted', expires_at=now(), finished_at=now(), earned_points=75.25,
      max_points=100.00, score_percentage=75.25, passed=true RETURNING *`);
    assert.equal(completed.earned_points, '75.25'); assert.equal(completed.max_points, '100.00');
    assert.equal(completed.score_percentage, '75.25'); assert.equal(completed.passed, true);
    assert.ok(completed.expires_at instanceof Date); assert.ok(completed.finished_at instanceof Date);
  });

  await scenario('required fields, enum values and foreign keys are enforced', async () => {
    const attempt = await insert();
    for (const field of ['id', 'quiz_id', 'user_id', 'attempt_no', 'status', 'started_at', 'settings_snapshot']) {
      await assert.rejects(client.query(`UPDATE pg_temp.quiz_attempts SET ${field}=NULL`), { code: '23502' });
    }
    await assert.rejects(insert(2, 'invalid'), { code: '22P02' });
    await assert.rejects(insert(2, 'submitted', randomUUID()), { code: '23503' });
    await assert.rejects(insert(2, 'submitted', quiz, randomUUID()), { code: '23503' });
    await assert.rejects(client.query('DELETE FROM pg_temp.quizzes WHERE id=$1', [quiz]), { code: '23503' });
    await assert.rejects(client.query('DELETE FROM pg_temp.users WHERE id=$1', [user]), { code: '23503' });
    assert.equal((await client.query('SELECT id FROM pg_temp.quiz_attempts')).rows[0].id, attempt.id);
  });

  await scenario('attempt numbers are unique per quiz and user, regardless of status', async () => {
    await insert(1, 'submitted');
    await assert.rejects(insert(1, 'cancelled'), { code: '23505', constraint: 'quiz_attempts_quiz_user_attempt_no_unique' });
    await insert(1, 'submitted', otherQuiz);
    await insert(1, 'submitted', quiz, otherUser);
  });

  await scenario('only one in-progress attempt is allowed, including on status updates', async () => {
    const active = await insert();
    await assert.rejects(insert(2), { code: '23505', constraint: 'quiz_attempts_one_active' });
    const ended = await insert(2, 'submitted');
    await insert(3, 'timed_out'); await insert(4, 'cancelled');
    await assert.rejects(client.query("UPDATE pg_temp.quiz_attempts SET status='in_progress' WHERE id=$1", [ended.id]),
      { code: '23505', constraint: 'quiz_attempts_one_active' });
    await insert(1, 'in_progress', otherQuiz); await insert(1, 'in_progress', quiz, otherUser);
    await client.query("UPDATE pg_temp.quiz_attempts SET status='submitted' WHERE id=$1", [active.id]);
    assert.equal((await insert(5)).status, 'in_progress');
  });

  await scenario('user history index and rollback preserve parent tables and allow reapplying', async () => {
    const { rows: [index] } = await client.query(`SELECT indexdef FROM pg_indexes
      WHERE schemaname = (SELECT nspname FROM pg_namespace WHERE oid=pg_my_temp_schema())
      AND indexname='quiz_attempts_user_started_at_idx'`);
    assert.match(index.indexdef, /\(user_id, started_at\)/);
    await insert();
    await client.query(down);
    assert.deepEqual((await client.query(`SELECT to_regclass('pg_temp.quiz_attempts') AS attempts,
      to_regtype('pg_temp.quiz_attempt_status') AS status`)).rows[0], { attempts: null, status: null });
    assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.quizzes')).rows[0].count, 2);
    assert.equal((await client.query('SELECT count(*)::int AS count FROM pg_temp.users')).rows[0].count, 2);
    await client.query(up);
    assert.equal((await insert()).status, 'in_progress');
  });
});
