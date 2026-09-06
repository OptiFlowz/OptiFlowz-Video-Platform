import { z } from 'zod';
import { getResetRecord } from '../helpers/auth.shared.js';
import { logEvent } from '../../../common/logger.js';
import bcrypt from 'bcrypt';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

const resetSchema = z
  .object({
    email: z.email(),
    token: z.string().min(1).max(64),
    newPassword: z.string().min(8),
  })
  .strict();

export async function passwordResetInternal({ body: inputBody }) {
  const parsed = resetSchema.safeParse(inputBody);
  if (!parsed.success) {
    throw new HttpError(400, { message: 'Invalid input', errors: parsed.error.flatten() });
  }

  try {
    const { token, newPassword, email } = parsed.data;

    const rec = await getResetRecord(token, email);
    if (!rec || rec.used || new Date() > new Date(rec.expires_at)) {
      logEvent('auth.pw_reset_failed', { email: email, message: 'Invalid or expired reset token' });
      throw new HttpError(400, { message: 'Invalid or expired reset token', changed: false });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await writePool.query(
      `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
      `,
      [newHash, rec.user_id],
    );

    await writePool.query(
      `
      UPDATE password_resets
      SET used = TRUE
      WHERE token = $1
      `,
      [token],
    );
    logEvent('auth.pw_reset_success', { email: email, message: 'Password changed' });
    return { message: 'Password has been reset. You can now log in.', changed: true };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('Password reset error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
