import bcrypt from 'bcrypt';
import speakeasy from 'speakeasy';
import QRCode from 'qrcode';
import { z } from 'zod';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { encryptTotpSecret } from '../helpers/totpSecret.js';

const setupSchema = z.object({ password: z.string().min(1).max(1024) }).strict();

export async function twoFactorSetupInternal({ body }, actorUserId = null) {
  if (!actorUserId) throw new HttpError(401, { message: 'Unauthorized' });

  const parsed = setupSchema.safeParse(body);
  if (!parsed.success) throw new HttpError(400, { message: 'A valid password is required' });

  try {
    const { rows: [user] } = await writePool.query(
      `SELECT email, password_hash, status, authz_version,
              is_2fa_enabled, totp_secret_encrypted
       FROM public.users WHERE id = $1`,
      [actorUserId],
    );

    if (!user || user.status !== 'active') {
      throw new HttpError(401, { message: 'Unauthorized' });
    }
    if (user.is_2fa_enabled) {
      throw new HttpError(409, { message: '2FA is already enabled for this account' });
    }
    if (!(await bcrypt.compare(parsed.data.password, user.password_hash))) {
      throw new HttpError(401, { message: 'Invalid password' });
    }

    const secret = speakeasy.generateSecret({ length: 32 }).base32;
    const encryptedSecret = encryptTotpSecret(secret, actorUserId);
    const issuer = 'OptiFlowz';
    const label = `${issuer}:${user.email}`;
    const otpauthUrl = speakeasy.otpauthURL({
      secret, label, issuer, encoding: 'base32',
      algorithm: 'sha1', digits: 6, period: 30,
    });
    const qr = await QRCode.toDataURL(otpauthUrl);

    // Do not overwrite a secret if setup, password, or account state changed
    // while the password was being verified and the QR code was generated.
    const { rowCount } = await writePool.query(
      `UPDATE public.users
       SET totp_secret_encrypted = $2, totp_last_used_step = -1
       WHERE id = $1 AND is_2fa_enabled = false AND status = 'active'
         AND password_hash = $3 AND authz_version = $4
         AND totp_secret_encrypted IS NOT DISTINCT FROM $5
       RETURNING id`,
      [actorUserId, encryptedSecret, user.password_hash,
        user.authz_version, user.totp_secret_encrypted],
    );
    if (rowCount !== 1) {
      throw new HttpError(409, { message: 'Account changed during setup. Please try again.' });
    }

    return { qr, manual: { codeName: label, yourKey: secret } };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    // Database/QR errors may contain sensitive data; do not log their payloads.
    throw new HttpError(500, { message: 'Unable to set up two-factor authentication' });
  }
}
