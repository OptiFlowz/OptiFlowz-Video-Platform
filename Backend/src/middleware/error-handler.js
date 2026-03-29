export function notFoundHandler(req, res) {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
}

export function errorHandler(err, _req, res, _next) {
  console.error('Unhandled error:', err);

  res.status(err.statusCode || 500).json({
    message: err.message || 'Something went wrong',
    error: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });
}
