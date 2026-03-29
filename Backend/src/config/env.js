import dotenv from 'dotenv';

dotenv.config();

export function getEnv(name, fallback = undefined) {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === null || value === '') {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

export function getNumberEnv(name, fallback) {
  const raw = process.env[name] ?? fallback;
  const value = Number(raw);

  if (!Number.isFinite(value)) {
    throw new Error(`Invalid numeric env: ${name}`);
  }

  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: getNumberEnv('PORT', 4000),
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:5173',
};
