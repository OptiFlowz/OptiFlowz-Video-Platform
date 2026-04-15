export function validateOrThrow(parsed, fallbackMessage = 'Invalid input') {
  if (!parsed.success) {
    const error = new Error(parsed.error.issues[0]?.message || fallbackMessage);
    error.status = 400;
    throw error;
  }

  return parsed.data;
}