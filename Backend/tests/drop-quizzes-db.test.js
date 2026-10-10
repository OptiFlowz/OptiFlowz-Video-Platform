import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import pg from 'pg';

test('quiz removal drops its schema and grants while preserving other modules', {
  skip: !process.env.TEST_DATABASE_URL,
}, async (t) => {
  const client = new pg.Client({
    connectionString: process.env.TEST_DATABASE_URL,
    connectionTimeoutMillis: 5000,
    statement_timeout: 10000,
  });
  await client.connect();
  t.after(() => client.end());

  // All migration writes target session-local objects, never public tables.
  await client.query(`
    CREATE TEMP TABLE users (id integer PRIMARY KEY);
    CREATE TEMP TABLE videos (id integer PRIMARY KEY);
    CREATE TEMP TABLE playlists (id integer PRIMARY KEY);
    CREATE TEMP TABLE roles (id integer PRIMARY KEY);
    CREATE TEMP TABLE permissions (id integer PRIMARY KEY, key text UNIQUE);
    CREATE TEMP TABLE role_permissions (
      role_id integer REFERENCES pg_temp.roles(id),
      permission_id integer REFERENCES pg_temp.permissions(id) ON DELETE CASCADE,
      PRIMARY KEY (role_id, permission_id)
    );
    CREATE TYPE pg_temp.quiz_answer_result AS ENUM ('correct', 'incorrect');
    CREATE TEMP TABLE quizzes (
      id integer PRIMARY KEY,
      created_by integer REFERENCES pg_temp.users(id)
    );
    CREATE TEMP TABLE quiz_questions (
      id integer PRIMARY KEY,
      quiz_id integer REFERENCES pg_temp.quizzes(id),
      video_id integer REFERENCES pg_temp.videos(id),
      playlist_id integer REFERENCES pg_temp.playlists(id)
    );
    CREATE TEMP TABLE quiz_attempts (
      id integer PRIMARY KEY,
      quiz_id integer REFERENCES pg_temp.quizzes(id),
      user_id integer REFERENCES pg_temp.users(id)
    );
    CREATE TEMP TABLE quiz_attempt_questions (
      attempt_id integer REFERENCES pg_temp.quiz_attempts(id),
      question_id integer REFERENCES pg_temp.quiz_questions(id),
      result pg_temp.quiz_answer_result
    );
    CREATE TEMP TABLE quiz_matching_pairs (question_id integer REFERENCES pg_temp.quiz_questions(id));
    CREATE TEMP TABLE quiz_question_options (question_id integer REFERENCES pg_temp.quiz_questions(id));
    CREATE TEMP TABLE quiz_question_sources (
      quiz_id integer REFERENCES pg_temp.quizzes(id),
      video_id integer REFERENCES pg_temp.videos(id),
      playlist_id integer REFERENCES pg_temp.playlists(id)
    );
    CREATE TEMP TABLE quiz_access_rules (
      quiz_id integer REFERENCES pg_temp.quizzes(id),
      required_quiz_id integer REFERENCES pg_temp.quizzes(id),
      video_id integer REFERENCES pg_temp.videos(id),
      playlist_id integer REFERENCES pg_temp.playlists(id)
    );
    INSERT INTO users VALUES (1);
    INSERT INTO videos VALUES (1);
    INSERT INTO playlists VALUES (1);
    INSERT INTO roles VALUES (1);
    INSERT INTO quizzes VALUES (1, 1);
    INSERT INTO quiz_questions VALUES (1, 1, 1, 1);
    INSERT INTO quiz_attempts VALUES (1, 1, 1);
    INSERT INTO quiz_attempt_questions VALUES (1, 1, 'correct');
    INSERT INTO quiz_matching_pairs VALUES (1);
    INSERT INTO quiz_question_options VALUES (1);
    INSERT INTO quiz_question_sources VALUES (1, 1, 1);
    INSERT INTO quiz_access_rules VALUES (1, 1, 1, 1);
    INSERT INTO permissions VALUES
      (1, 'quizzes.create'), (2, 'quizzes.manage_own'), (3, 'quizzes.manage_any'),
      (4, 'quizzes.participate'), (5, 'quizzes.certificates'), (6, 'videos.create');
    INSERT INTO role_permissions SELECT 1, id FROM permissions;
  `);

  const migration = await readFile(new URL(
    '../src/database/migrations/1791590400000_drop-quizzes-module.sql', import.meta.url,
  ), 'utf8');
  const [up, down] = migration.replaceAll('public.', 'pg_temp.').split('-- Down Migration');
  await client.query(up);

  const { rows: objects } = await client.query(`
    SELECT relname FROM pg_class WHERE relnamespace = pg_my_temp_schema() AND relname ~ '^quiz'
    UNION ALL
    SELECT typname FROM pg_type WHERE typnamespace = pg_my_temp_schema() AND typname ~ '^_?quiz'
  `);
  assert.deepEqual(objects, []);
  for (const table of ['users', 'videos', 'playlists', 'roles', 'permissions', 'role_permissions']) {
    const { rows } = await client.query(`SELECT count(*)::integer AS count FROM pg_temp.${table}`);
    assert.equal(rows[0].count, 1, `${table} preserves unrelated records`);
  }
  assert.deepEqual((await client.query('SELECT key FROM pg_temp.permissions')).rows, [{ key: 'videos.create' }]);
  assert.deepEqual((await client.query('SELECT permission_id FROM pg_temp.role_permissions')).rows, [{ permission_id: 6 }]);

  // A partially cleaned schema can safely run the migration again.
  await client.query(up);
  await assert.rejects(client.query(down), { message: /quizzes module removal is irreversible/ });
});
