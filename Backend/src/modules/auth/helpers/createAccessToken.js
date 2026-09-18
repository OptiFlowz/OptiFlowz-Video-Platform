import jwt from 'jsonwebtoken';

export function createAccessToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      authzVersion: user.authz_version,
      purpose: 'access',
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES || '1h',
    },
  );
}
