import { writePool } from '../../../../database/index.js';
import { validateOrThrow } from '../../../../common/input.validation.js';
import { createCertificateTemplateSchema, requireCertificateUser } from '../helpers/certificate-templates.validation.js';
import { validateTemplateContent } from '../helpers/templateContent.validation.js';
import { createCertificateTemplate } from '../repository/certificate-templates.repository.js';

export async function createCertificateTemplateInternal(body, userId) {
  requireCertificateUser(userId);
  const template = validateOrThrow(createCertificateTemplateSchema.safeParse(body));
  validateTemplateContent(template);
  return createCertificateTemplate(writePool, userId, template);
}
