import { readFile } from 'node:fs/promises';
export const fixedQuizMigration = '1792454400001_fixed-questions-and-random-category-sources.sql';
export async function upgradeFixedQuizLayout(database, { schema = 'pg_temp' } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid test schema');
  const read = async file => (await readFile(new URL(`../../src/database/migrations/${file}`, import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`);
  if (!(await database.query('SELECT to_regclass($1) AS name', [`${schema}.quiz_questions`])).rows[0].name) {
    await database.query((await read('1792281600000_add-quiz-questions.sql')).split('-- Down Migration')[0]);
  }
  const migration = await read(fixedQuizMigration);
  await database.query(migration.split('-- Down Migration')[0]);
  await database.query((await read('1792540800001_nullable-quiz-source-max-points.sql')).split('-- Down Migration')[0]);
  return migration;
}
