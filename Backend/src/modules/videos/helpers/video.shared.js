import crypto from 'crypto';

export function hashIp(ip) {
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT;
  return crypto.createHmac('sha256', salt).update(ip).digest('hex');
}

export function normalizeIp(ip) {
  if (!ip) return null;

  let value = Array.isArray(ip) ? ip[0] : String(ip);
  value = value.split(',')[0].trim();

  if (value.startsWith('::ffff:')) {
    value = value.slice(7);
  }

  return value || null;
}
