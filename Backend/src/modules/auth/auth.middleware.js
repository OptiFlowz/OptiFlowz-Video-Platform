import multer from 'multer';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

export const profilePictureUploadMiddleware = upload.single('file');

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
