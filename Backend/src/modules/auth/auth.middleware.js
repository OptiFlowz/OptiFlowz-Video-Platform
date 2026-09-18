import multer from 'multer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { verifyTwoFactorToken } from './helpers/twoFactorToken.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

export const profilePictureUploadMiddleware = upload.single('file');

// Verify the signed identity before using it as an account-wide rate-limit key.
export function requireTwoFactorLoginToken(req, res, next) {
  res.set('Cache-Control', 'no-store');
  const token = req.body?.twoFactorToken;
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    return res.status(400).json({ success: false, message: 'A temporary two-factor token is required' });
  }
  try {
    req.twoFactorLoginUserId = verifyTwoFactorToken(token).sub;
    return next();
  } catch (error) {
    return res.status(error.status || 500).json({
      ...(error.body || { message: 'Unable to complete two-factor login' }), success: false,
    });
  }
}

export const twoFactorLoginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.twoFactorLoginUserId,
  message: { success: false, message: 'Too many 2FA login attempts. Try again in 10 minutes.' },
});

// Mounted after requireAuth; limit password attempts by authenticated account.
export const twoFactorSetupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.sub,
  message: { success: false, message: 'Too many setup attempts. Try again in 10 minutes.' },
});

export const twoFactorVerifyLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.sub,
  message: { success: false, message: 'Too many verification attempts. Try again in 10 minutes.' },
});

export const twoFactorDisableLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user.sub,
  message: { success: false, message: 'Too many disable attempts. Try again in 10 minutes.' },
});

export const resetRequestLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body?.email || '').toString().trim().toLowerCase();
    const ip = ipKeyGenerator(req);
    return `${ip}|${email}`;
  },
  message: { message: 'Too many requests. Try again in 10 seconds.' },
});

export const resetLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req),
  message: { message: 'Too many requests. Try again in 10 seconds.' },
});

export const resetVerifyLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body?.email || '').toString().trim().toLowerCase();
    const token = (req.body?.token || '').toString().trim().toUpperCase();
    const ip = ipKeyGenerator(req);
    return `${ip}|${email}|${token}`;
  },
  message: { message: 'Too many requests. Try again in 10 seconds.' },
});
