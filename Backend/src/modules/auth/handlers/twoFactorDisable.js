import speakeasy from 'speakeasy';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { decryptTotpSecret } from '../helpers/totpSecret.js';
import { verifyTwoFactorReauthentication } from '../helpers/twoFactorReauthentication.js';

const disableSchema = z.object({
  password: z.string().min(1).max(1024).optional(),
  googleCode: z.string().trim().min(1).max(4096).optional(),
  token: z.string().regex(/^\d{6}$/).optional(),
}).strict().refine(data => (data.password !== undefined) !== (data.googleCode !== undefined));

export async function twoFactorDisableInternal({ body }, actorUserId = null) {
  if (!actorUserId) throw new HttpError(401, { message: 'Unauthorized' });

  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, { message: 'Invalid input' });

  try {
    const { rows: [user] } = await writePool.query(
      `SELECT password_hash, status, authz_version, is_2fa_enabled,
              totp_secret_encrypted, totp_last_used_step
       FROM public.users WHERE id = $1`,
      [actorUserId],
    );
    if (!user || user.status !== 'active') {
      throw new HttpError(401, { message: 'Unauthorized' });
    }
    const googleSubject = await verifyTwoFactorReauthentication(parsed.data, user, actorUserId);

    let step = null;
    if (user.is_2fa_enabled) {
      if (!parsed.data.token) {
        throw new HttpError(401, { message: '2FA token is required' });
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
      step = Math.floor(time / 30) + result.delta;
      if (step <= Number(user.totp_last_used_step)) {
        throw new HttpError(401, { message: 'Invalid or already used 2FA token' });
      }
    }

    // Also permits cancelling unconfirmed setup after reauthentication.
    // Recheck every credential/state used above so concurrent changes cannot
    // disable a new secret or bypass a factor enabled during this request.
    const { rowCount } = await writePool.query(
      `UPDATE public.users
       SET is_2fa_enabled = false, totp_secret_encrypted = NULL,
           totp_last_used_step = -1
       WHERE id = $1 AND status = 'active'
         AND password_hash IS NOT DISTINCT FROM $2 AND authz_version = $3
         AND is_2fa_enabled = $4
         AND totp_secret_encrypted IS NOT DISTINCT FROM $5
         AND ($6::bigint IS NULL OR totp_last_used_step < $6)
         AND ($7::text IS NULL OR EXISTS (
           SELECT 1 FROM public.auth_identities
           WHERE user_id = $1 AND provider = 'google' AND provider_user_id = $7
         ))
       RETURNING id`,
      [actorUserId, user.password_hash, user.authz_version,
        user.is_2fa_enabled, user.totp_secret_encrypted, step, googleSubject],
    );
    if (rowCount !== 1) {
      throw new HttpError(409, { message: 'Account changed while disabling 2FA. Please try again.' });
    }

    return { message: '2FA disabled' };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Do not expose or log passwords, tokens, or decryption/database errors.
    throw new HttpError(500, { message: 'Unable to disable two-factor authentication' });
  }
}
