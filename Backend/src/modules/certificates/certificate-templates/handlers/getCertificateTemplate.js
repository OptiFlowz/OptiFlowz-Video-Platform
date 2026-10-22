import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { certificateTemplateIdSchema, requireCertificateUser } from '../helpers/certificate-templates.validation.js';
import { getCertificateTemplate } from '../repository/certificate-templates.repository.js';

export async function getCertificateTemplateInternal(params, userId) {
  requireCertificateUser(userId);
  const { id } = validateOrThrow(certificateTemplateIdSchema.safeParse(params));
  const template = await getCertificateTemplate(writePool, id, userId);
  if (!template) throw new HttpError(404, { message: 'Certificate template not found' });
  return template;
}
