import speakeasy from 'speakeasy';
import { z } from 'zod';
import { HttpError } from '../../../common/httpError.js';
import { logEvent } from '../../../common/logger.js';
import { decryptTotpSecret } from '../helpers/totpSecret.js';
import { verifyTwoFactorToken, twoFactorCredentialState } from '../helpers/twoFactorToken.js';
import { loginTransaction, lockLoginUser, completeLogin } from '../helpers/login.shared.js';

const loginSchema = z.object({
  twoFactorToken: z.string().min(1).max(4096),
  otp: z.string().regex(/^\d{6}$/),
}).strict();

export async function twoFactorLoginInternal({ body }) {
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, { message: 'A temporary token and six-digit OTP are required' });

  try {
    const result = await loginTransaction(async client => {
      // Check expiry after acquiring the account lock as well, since it may wait.
      const claims = verifyTwoFactorToken(parsed.data.twoFactorToken);
      const user = await lockLoginUser(client, claims.sub);
      verifyTwoFactorToken(parsed.data.twoFactorToken);
      if (!user.is_2fa_enabled || !user.totp_secret_encrypted
        || user.authz_version !== claims.authzVersion
        || String(user.totp_last_used_step) !== claims.lastUsedStep
        || twoFactorCredentialState(user) !== claims.state) {
        throw new HttpError(401, { message: 'Two-factor login is no longer valid. Sign in again.' });
      }

      const time = Math.floor(Date.now() / 1000);
      const verified = speakeasy.totp.verifyDelta({
        secret: decryptTotpSecret(user.totp_secret_encrypted, user.id),
        encoding: 'base32', token: parsed.data.otp,
        algorithm: 'sha1', digits: 6, step: 30, window: 1, time,
      });
      const step = verified === undefined ? null : Math.floor(time / 30) + verified.delta;
      if (step === null || step <= Number(user.totp_last_used_step)) {
        throw new HttpError(401, { message: 'Invalid or already used 2FA token' });
      }

      await client.query(
        'UPDATE public.users SET totp_last_used_step = $2 WHERE id = $1',
        [user.id, step],
      );
      return completeLogin(client, user, claims.context);
    });
    logEvent('auth.login_success', { email: result.user.email, message: 'User logged in with 2FA' });
    return result;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, { message: 'Unable to complete two-factor login' });
  }
}
