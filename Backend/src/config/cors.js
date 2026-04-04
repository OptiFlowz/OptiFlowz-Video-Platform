const defaultOrigins = [
  'https://videoplatform.optiflowz.com',
  'https://optiflowz.com',
  'https://www.optiflowz.com',
  'https://mux.com',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const additionalOrigins = [
  process.env.FRONTEND_URL,
  ...(process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean),
];

const allowedOrigins = [...new Set([...defaultOrigins, ...additionalOrigins])];

export const corsOptions = {
  origin: allowedOrigins,
};
