import { z } from 'zod';
import bcrypt from 'bcrypt';
import { writePool } from '../../../database/index.js';
import { assignDefaultRole } from '../helpers/auth.shared.js';
import { createAccessToken } from '../helpers/createAccessToken.js';
import { logEvent } from '../../../common/logger.js';
import { HttpError } from '../../../common/httpError.js';

const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  full_name: z.string().min(1).max(120),
  description: z.string().min(0).max(150),
  eaes_member: z.boolean().optional().default(false),
});

export async function registerInternal({ body: inputBody }) {
  let client = null;

  try {
    const { email, password, full_name, description, eaes_member } =
      registerSchema.parse(inputBody);

    const emailNorm = email.trim().toLowerCase();

    const saltRounds = Number(process.env.BCRYPT_ROUNDS || 12);
    const hash = await bcrypt.hash(password, saltRounds);

    client = await writePool.connect();
    await client.query('BEGIN');

    const { rows } = await client.query(
      `
            INSERT INTO users (
              email,
              password_hash,
              full_name,
              description,
              eaes_member
            )
            VALUES ($1, $2, $3, $4, $5)
            RETURNING
              id,
              email,
              full_name,
              created_at,
              description,
              image_url,
              eaes_member,
              authz_version
          `,
      [emailNorm, hash, full_name, description, eaes_member],
    );

    const user = rows[0];

    await assignDefaultRole(client, user.id);
    await client.query('COMMIT');

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
    logEvent('auth.register_success', { email: email, message: 'User registered successfully' });
    return responseBody;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (err?.issues) throw new HttpError(400, { message: 'Invalid data', issues: err.issues });
    if (err?.code === '23505') {
      logEvent('auth.register_failed', {
        email: inputBody?.email,
        message: 'Email already in use',
      });
      throw new HttpError(409, { message: 'Email already in use' });
    }
    console.error(err);
    throw new HttpError(500, { message: 'Server error' });
  } finally {
    if (client) client.release();
  }
}
