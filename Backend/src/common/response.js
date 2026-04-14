export function sendSuccess(res, data = {}, status = 200) {
  return res.status(status).json({
    success: true,
    ...data,
  });
}

export function sendError(res, message = 'Internal server error', status = 500, extra = {}) {
  return res.status(status).json({
    success: false,
    message,
    ...extra,
  });
}