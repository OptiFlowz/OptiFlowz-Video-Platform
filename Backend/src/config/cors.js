const defaultOrigins = [
  'https://optiflowz.com',
  'https://www.optiflowz.com',
  'https://mux.com',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const additionalOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

const allowedOrigins = [...new Set([...defaultOrigins, ...additionalOrigins])];

export const corsOptions = {
  origin: allowedOrigins,
};
