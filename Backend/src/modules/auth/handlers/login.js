import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { logEvent } from '../../../common/logger.js';
import bcrypt from 'bcrypt';
import { createAccessToken } from '../helpers/createAccessToken.js';
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
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) {
      logEvent('auth.login_failed', { email: email, message: 'Wrong password' });
      throw new HttpError(401, { message: 'Invalid credentials' });
    }

    await writePool.query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

    const token = createAccessToken(user);
    const responseBody = {
      user: {
        email: user.email,
        full_name: user.full_name,
        image_url: user.image_url,
        description: user.description,
        eaes_member: user.eaes_member,
      },
      token,
    };
    logEvent('auth.login_success', { email: email, message: 'User logged in' });
    return responseBody;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err?.issues) throw new HttpError(400, { message: 'Invalid data', issues: err.issues });
    console.error(err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
