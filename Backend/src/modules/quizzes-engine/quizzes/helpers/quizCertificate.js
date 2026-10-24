import { HttpError } from '../../../../common/httpError.js';

const invalidTemplate = () => new HttpError(422, {
  message: 'Certificate template not found or unavailable', field: 'certificate_template_id',
});

export async function requireAccessibleCertificateTemplate(database, templateId, userId) {
  if (templateId == null) return;
  const { rows } = await database.query(`
    SELECT id FROM public.certificate_templates
    WHERE id = $1 AND (is_system = true OR user_id = $2)
  `, [templateId, userId]);
  if (!rows.length) throw invalidTemplate();
}

export function mapQuizCertificateError(error) {
  // A template can be deleted between the access check and the write.
  return error.code === '23503' && error.constraint === 'quizzes_certificate_template_id_fkey'
    ? invalidTemplate() : error;
}
