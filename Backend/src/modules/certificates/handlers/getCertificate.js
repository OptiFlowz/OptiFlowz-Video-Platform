import { writePool } from '../../../database/index.js';
import { validateOrThrow } from '../../../common/input.validation.js';
import { HttpError } from '../../../common/httpError.js';
import { certificateIdSchema } from '../helpers/certificates.validation.js';
import { getCertificate } from '../repository/certificates.repository.js';

export async function getCertificateInternal(params) {
  const { id } = validateOrThrow(certificateIdSchema.safeParse(params));
  const certificate = await getCertificate(writePool, id);
  if (!certificate) throw new HttpError(404, { message: 'Certificate not found' });
  return certificate;
}
