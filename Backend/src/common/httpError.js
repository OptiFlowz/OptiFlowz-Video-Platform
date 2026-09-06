// Preserve endpoint-specific error payloads while keeping Express out of handlers.
export class HttpError extends Error {
  constructor(status, body) {
    super(body?.message || 'Request failed');
    this.status = status;
    this.body = body;
  }
}
