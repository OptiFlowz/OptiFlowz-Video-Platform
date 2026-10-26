import { readFile } from 'node:fs/promises';

export const quizCertificateMigration = '1792926000000_quiz-certificate-template.sql';
export async function upgradeCertificateIssuance(database, { schema = 'pg_temp' } = {}) {
  await upgradeQuizCertificates(database, { schema });
  for (const file of ['1792926000001_add-certificates.sql', '1792926000002_certificate-number-per-year.sql']) {
    const sql = await readFile(new URL(`../../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await database.query(sql.split('-- Down Migration')[0].replaceAll('public.', `${schema}.`));
  }
}
export async function upgradeQuizCertificates(database, { schema = 'pg_temp' } = {}) {
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('Invalid test schema');
  for (const file of ['1792627200002_add-certificate-templates.sql',
    '1792713600000_add-system-certificate-templates.sql', quizCertificateMigration]) {
    const sql = await readFile(new URL(`../../src/database/migrations/${file}`, import.meta.url), 'utf8');
    await database.query(sql.split('-- Down Migration')[0].replaceAll('public.', `${schema}.`));
  }
}
