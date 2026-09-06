import { z } from 'zod';
import { getResetRecord } from '../helpers/auth.shared.js';
import { logEvent } from '../../../common/logger.js';
import { HttpError } from '../../../common/httpError.js';

const verifySchema = z
  .object({
    email: z.string().email(),
    token: z.string().min(1).max(64),
  })
  .strict();

export async function passwordResetVerifyInternal({ body: inputBody }) {
  const parsed = verifySchema.safeParse(inputBody);
  if (!parsed.success) {
    throw new HttpError(400, {
      valid: false,
      message: 'Invalid input',
      errors: parsed.error.flatten(),
    });
  }

  try {
    const { token, email } = parsed.data;
    const rec = await getResetRecord(token, email);

    if (!rec || rec.used || new Date() > new Date(rec.expires_at)) {
      logEvent('auth.pw_reset_verification_failed', {
        email: email,
        message: 'Invalid or expired reset token',
      });
      throw new HttpError(400, { valid: false, message: 'Invalid or expired reset token' });
    }

    return { valid: true };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('Password reset verify error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
