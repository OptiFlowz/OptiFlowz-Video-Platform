import { createHmac, randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { HttpError } from '../../../common/httpError.js';

const issuer = 'optiflowz';
const audience = 'optiflowz:2fa-login';
const contextSchema = z.object({
  provider: z.literal('google').optional(),
  is_new_user: z.boolean().optional(),
  linked_existing_account: z.boolean().optional(),
}).strict();
const claimsSchema = z.object({
  sub: z.uuid(),
  purpose: z.literal('2fa-login'),
  authzVersion: z.number().int(),
  state: z.string().regex(/^[a-f0-9]{64}$/),
  lastUsedStep: z.string().regex(/^-?\d+$/),
  context: contextSchema,
  jti: z.uuid(),
  iat: z.number().int(),
  exp: z.number().int(),
});

function signingSecret() {
  const secret = process.env.TWO_FACTOR_TOKEN_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32
    || secret === process.env.JWT_SECRET
    || secret === process.env.TWO_FACTOR_ENCRYPTION_KEY) {
    throw new HttpError(500, { message: 'Two-factor login is not configured' });
  }
  return secret;
}

// Bind pending login to current credentials without putting their hashes or
// encrypted secret in the JWT. A password reset or secret rotation invalidates it.
export function twoFactorCredentialState(user) {
  return createHmac('sha256', signingSecret())
    .update(JSON.stringify([user.password_hash, user.totp_secret_encrypted]))
    .digest('hex');
}

export function createTwoFactorToken(user, context = {}) {
  return jwt.sign({
    purpose: '2fa-login', authzVersion: user.authz_version,
    state: twoFactorCredentialState(user),
    lastUsedStep: String(user.totp_last_used_step),
    context: contextSchema.parse(context),
  }, signingSecret(), {
    algorithm: 'HS256', subject: user.id, issuer, audience,
    expiresIn: '5m', jwtid: randomUUID(),
  });
}

export function verifyTwoFactorToken(token) {
  const secret = signingSecret();
  try {
    return claimsSchema.parse(jwt.verify(token, secret, {
      algorithms: ['HS256'], issuer, audience, maxAge: '5m',
    }));
  } catch {
    throw new HttpError(401, { message: 'Invalid or expired two-factor token. Sign in again.' });
  }
}
