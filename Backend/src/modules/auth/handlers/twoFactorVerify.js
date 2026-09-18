import speakeasy from 'speakeasy';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { decryptTotpSecret } from '../helpers/totpSecret.js';

const verifySchema = z.object({ token: z.string().regex(/^\d{6}$/) }).strict();

export async function twoFactorVerifyInternal({ body }, actorUserId = null) {
  if (!actorUserId) throw new HttpError(401, { message: 'Unauthorized' });

  const parsed = verifySchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, { message: 'A six-digit token is required' });

  try {
    const { rows: [user] } = await writePool.query(
      `SELECT status, authz_version, is_2fa_enabled,
              totp_secret_encrypted, totp_last_used_step
       FROM public.users WHERE id = $1`,
      [actorUserId],
    );
    if (!user || user.status !== 'active') {
      throw new HttpError(401, { message: 'Unauthorized' });
    }
    if (user.is_2fa_enabled) {
      throw new HttpError(409, { message: '2FA is already enabled for this account' });
    }
    if (!user.totp_secret_encrypted) {
      throw new HttpError(400, { message: '2FA setup has not been started' });
    }

    const secret = decryptTotpSecret(user.totp_secret_encrypted, actorUserId);
    const time = Math.floor(Date.now() / 1000);
    const result = speakeasy.totp.verifyDelta({
      secret, encoding: 'base32', token: parsed.data.token,
      algorithm: 'sha1', digits: 6, step: 30, window: 1, time,
    });
    if (result === undefined) {
      throw new HttpError(401, { message: 'Invalid or already used 2FA token' });
    }
    const step = Math.floor(time / 30) + result.delta;
    if (step <= Number(user.totp_last_used_step)) {
      throw new HttpError(401, { message: 'Invalid or already used 2FA token' });
    }

    // Confirm only the secret we verified; a concurrent setup may replace it.
    // Consuming the time step and enabling 2FA happen in one atomic update.
    const { rowCount } = await writePool.query(
      `UPDATE public.users
       SET is_2fa_enabled = true, totp_last_used_step = $2
       WHERE id = $1 AND is_2fa_enabled = false AND status = 'active'
         AND totp_secret_encrypted = $3 AND authz_version = $4
         AND totp_last_used_step < $2
       RETURNING id`,
      [actorUserId, step, user.totp_secret_encrypted, user.authz_version],
    );
    if (rowCount !== 1) {
      throw new HttpError(409, { message: 'Account changed during verification. Please try again.' });
    }

    return { message: '2FA enabled' };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Do not expose or log tokens, secrets, or decryption/database errors.
    throw new HttpError(500, { message: 'Unable to verify two-factor authentication' });
  }
}
