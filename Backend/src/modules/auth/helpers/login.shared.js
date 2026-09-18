import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';
import { createAccessToken } from './createAccessToken.js';
import { createTwoFactorToken } from './twoFactorToken.js';

export async function loginTransaction(action) {
  const client = await writePool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function lockLoginUser(client, userId) {
  const { rows: [user] } = await client.query(
    `SELECT id, email, full_name, image_url, description, eaes_member,
            status, password_hash, authz_version, is_2fa_enabled,
            totp_secret_encrypted, totp_last_used_step
     FROM public.users WHERE id = $1 FOR UPDATE`,
    [userId],
  );
  if (!user || user.status !== 'active') {
    throw new HttpError(401, { message: 'Account is not active' });
  }
  return user;
}

// Call inside the transaction only after all required factors are verified.
export async function completeLogin(client, user, context = {}) {
  const token = createAccessToken(user);
  await client.query('UPDATE public.users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  return {
    ...context,
    success: true,
    user: {
      email: user.email, full_name: user.full_name, image_url: user.image_url,
      description: user.description, eaes_member: user.eaes_member,
    },
    token,
  };
}

// Password login opens a transaction; OAuth passes its existing transaction.
export async function finishFirstFactor(authenticatedUser, context = {}, client = null) {
  const action = async db => {
    const user = await lockLoginUser(db, authenticatedUser.id);
    if (user.authz_version !== authenticatedUser.authz_version
      || (authenticatedUser.password_hash !== undefined
        && user.password_hash !== authenticatedUser.password_hash)) {
      throw new HttpError(401, { message: 'Account changed. Sign in again.' });
    }
    if (user.is_2fa_enabled) {
      if (!user.totp_secret_encrypted) throw new Error('Missing enabled TOTP secret');
      return {
        success: false,
        requires2fa: true,
        twoFactorToken: createTwoFactorToken(user, context),
      };
    }
    return completeLogin(db, user, context);
  };
  return client ? action(client) : loginTransaction(action);
}
