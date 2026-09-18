import bcrypt from 'bcrypt';
import { OAuth2Client } from 'google-auth-library';
import { writePool } from '../../../database/index.js';
import { HttpError } from '../../../common/httpError.js';

// Called only after the endpoint validates exactly one credential.
// Returns the verified Google subject, or null for password verification.
export async function verifyTwoFactorReauthentication({ password, googleCode }, user, userId) {
  if (password !== undefined) {
    if (user.password_hash === null) {
      throw new HttpError(400, { message: 'This account does not have a password' });
    }
    if (!(await bcrypt.compare(password, user.password_hash))) {
      throw new HttpError(401, { message: 'Invalid password' });
    }
    return null;
  }

  const audience = process.env.GOOGLE_CLIENT_ID;
  if (!audience) {
    throw new HttpError(500, { message: 'Google verification is not configured' });
  }
  const googleClient = new OAuth2Client(
    audience, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI,
  );
  let payload;
  try {
    const { tokens } = await googleClient.getToken(googleCode);
    if (!tokens?.id_token) throw new Error('Missing ID token');
    const ticket = await googleClient.verifyIdToken({ idToken: tokens.id_token, audience });
    payload = ticket.getPayload();
    if (typeof payload?.sub !== 'string' || !payload.sub || payload.email_verified !== true) {
      throw new Error('Invalid Google identity');
    }
  } catch {
    // Google errors can contain authorization codes/tokens; never expose them.
    throw new HttpError(401, { message: 'Google verification failed. Please try again with a new code.' });
  }
  if (process.env.GOOGLE_ALLOWED_HD && payload.hd !== process.env.GOOGLE_ALLOWED_HD) {
    throw new HttpError(403, { message: 'Google domain not allowed' });
  }

  // Reauthentication must never create/link accounts or match by email.
  const { rowCount } = await writePool.query(
    `SELECT 1 FROM public.auth_identities
     WHERE user_id = $1 AND provider = 'google' AND provider_user_id = $2`,
    [userId, payload.sub],
  );
  if (!rowCount) {
    throw new HttpError(403, { message: 'Google account is not linked to this user' });
  }
  return payload.sub;
}
