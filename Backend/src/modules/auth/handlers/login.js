import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { logEvent } from '../../../common/logger.js';
import bcrypt from 'bcrypt';
import { finishFirstFactor } from '../helpers/login.shared.js';
import { HttpError } from '../../../common/httpError.js';

const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export async function loginInternal({ body: inputBody }) {
  try {
    const { email, password } = loginSchema.parse(inputBody);
    const emailNorm = email.trim().toLowerCase();

    const { rows } = await writePool.query(
      'SELECT id, email, password_hash, full_name, image_url, description, eaes_member, authz_version FROM users WHERE lower(email) = $1',
      [emailNorm],
    );
    if (!rows.length) {
      logEvent('auth.login_failed', { email: email, message: 'No user' });
      throw new HttpError(401, { message: 'No account found with that email address.' });
    }

    const user = rows[0];
    const ok = user.password_hash !== null && await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      logEvent('auth.login_failed', { email: email, message: 'Wrong password' });
      throw new HttpError(401, { message: 'Invalid credentials' });
    }

    const result = await finishFirstFactor(user);
    if (result.success) logEvent('auth.login_success', { email, message: 'User logged in' });
    return result;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err?.issues) throw new HttpError(400, { message: 'Invalid data', issues: err.issues });
    throw new HttpError(500, { message: 'Server error' });
  }
}
