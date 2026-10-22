import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { HttpError } from '../../../../common/httpError.js';
import { certificateTemplateIdSchema, requireCertificateUser } from '../helpers/certificate-templates.validation.js';
import { deleteCertificateTemplate } from '../repository/certificate-templates.repository.js';

export async function deleteCertificateTemplateInternal(params, userId) {
  requireCertificateUser(userId);
  const { id } = validateOrThrow(certificateTemplateIdSchema.safeParse(params));
  if (!await deleteCertificateTemplate(writePool, id, userId)) throw new HttpError(404, { message: 'Certificate template not found' });
  return { deleted: true };
}
