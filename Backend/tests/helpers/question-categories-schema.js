import { readFile } from 'node:fs/promises';

export const categoryMigration = '1792454400000_question-categories-and-uncategorized-sources.sql';
export async function upgradeQuestionCategories(database, { schema = 'pg_temp' } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid test schema');
  const exists = async name => (await database.query('SELECT to_regclass($1) AS name', [`${schema}.${name}`])).rows[0].name != null;
  const read = async file => (await readFile(new URL(`../../src/database/migrations/${file}`, import.meta.url), 'utf8')).replaceAll('public.', `${schema}.`);
  for (const [table, file] of [
    ['questions', '1791590400001_add-questions.sql'],
    ['question_groups', '1791590400003_add-question-groups.sql'],
    ['quizzes', '1791590400004_add-quizzes.sql'],
    ['quiz_sources', '1792281600001_add-quiz-sources.sql'],
  ]) if (!await exists(table)) await database.query((await read(file)).split('-- Down Migration')[0]);
  let migration = await read(categoryMigration);
  if (!await exists('permissions')) migration = migration.replace(/UPDATE [\w.]+permissions[\s\S]*?;/g, '');
  await database.query(migration.split('-- Down Migration')[0]);
  return migration;
}
