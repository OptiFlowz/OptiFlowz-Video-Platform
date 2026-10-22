import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { certificateTemplateIdSchema, updateCertificateTemplateSchema, requireCertificateUser } from '../helpers/certificate-templates.validation.js';
import { validateTemplateContent } from '../helpers/templateContent.validation.js';
import { updateCertificateTemplate } from '../repository/certificate-templates.repository.js';

export async function updateCertificateTemplateInternal(params, body, userId) {
  requireCertificateUser(userId);
  const { id } = validateOrThrow(certificateTemplateIdSchema.safeParse(params));
  const updates = validateOrThrow(updateCertificateTemplateSchema.safeParse(body));
  validateTemplateContent(updates);
  const template = await updateCertificateTemplate(writePool, id, userId, updates);
  if (!template) throw new HttpError(404, { message: 'Certificate template not found' });
  return template;
}
