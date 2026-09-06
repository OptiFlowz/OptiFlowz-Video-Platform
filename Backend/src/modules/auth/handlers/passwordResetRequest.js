import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { logEvent } from '../../../common/logger.js';
import crypto from 'crypto';
import axios from 'axios';
import { HttpError } from '../../../common/httpError.js';

const passwordResetRequestSchema = z
  .object({
    email: z.string().email(),
  })
  .strict();

export async function passwordResetRequestInternal({ body: inputBody }) {
  const parsed = passwordResetRequestSchema.safeParse(inputBody);
  if (!parsed.success) {
    throw new HttpError(400, {
      message: 'Invalid input',
      errors: parsed.error.flatten(),
    });
  }

  const { email } = parsed.data;

  try {
    // 1) Find the user
    const { rows } = await writePool.query(`SELECT id FROM users WHERE email = $1`, [email]);

    // Always respond 200 (avoid leaking which emails exist)
    if (rows.length === 0) {
      logEvent('auth.pw_reset_req_failed', { email: email, message: 'No user' });
      return {
        message: 'If that email is registered, you’ll receive reset instructions.',
      };
    }

    const userId = rows[0].id;

    // 2) Generate reset token & expiry
    const token = crypto.randomBytes(3).toString('hex').toUpperCase();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 1000 * 60 * 5);

    await writePool.query(
      `
      INSERT INTO password_resets(user_id, token, expires_at, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) WHERE used = FALSE
      DO UPDATE
        SET token      = EXCLUDED.token,
            expires_at = EXCLUDED.expires_at,
            created_at = EXCLUDED.created_at
      `,
      [userId, token, expiresAt, createdAt],
    );

    // 3) Fire n8n webhook to send email
    await axios.post(
      process.env.N8N_PASSWORD_RESET_URL,
      {
        email,
        resetToken: token,
        expiresAt,
      },
      {
        headers: {
          Authorization: process.env.N8N_SECRET,
          'Content-Type': 'application/json',
        },
      },
    );

    logEvent('auth.pw_reset_req_success', { email: email, message: 'Password reset sent' });
    return {
      message: 'If that email is registered, you’ll receive reset instructions.',
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    console.error('Password reset request error:', err);
    throw new HttpError(500, { message: 'Server error' });
  }
}
