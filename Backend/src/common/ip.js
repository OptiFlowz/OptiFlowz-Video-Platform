import crypto from 'crypto';
import { fileURLToPath } from 'url';
import maxmind from 'maxmind';

const GEOIP_DB_PATH = fileURLToPath(new URL('../../data/GeoLite2-City.mmdb', import.meta.url));
let geoReaderPromise;

export function normalizeIp(ip) {
  const first = Array.isArray(ip) ? ip[0] : ip;
  if (!first) return null;

  let value = String(first).split(',')[0].trim();
  if (value.startsWith('::ffff:')) value = value.slice(7);
  return value || null;
}

export function getClientIp(req) {
  // Express applies the application's trust-proxy policy to req.ip.
  return normalizeIp(req.ip) || '';
}

export function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHmac('sha256', process.env.IP_HASH_SALT).update(ip).digest('hex');
}

export function isPrivateIp(ip) {
  if (!ip) return true;

  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === 'localhost') return true;
  if (ip.startsWith('10.') || ip.startsWith('127.') || ip.startsWith('192.168.')) return true;

  const match172 = ip.match(/^172\.(\d{1,3})\./);
  if (match172) {
    const secondOctet = Number(match172[1]);
    if (secondOctet >= 16 && secondOctet <= 31) return true;
  }

  return lower.startsWith('fc') || lower.startsWith('fd');
}

export async function getCountryAndCityFromIp(ip) {
  const normalizedIp = normalizeIp(ip);
  const unknown = { country: null, city: null, country_iso: null };
  if (!normalizedIp || isPrivateIp(normalizedIp)) return unknown;

  try {
    // Load lazily so hashing/client-IP users do not require the GeoIP database.
    geoReaderPromise ??= maxmind.open(GEOIP_DB_PATH);
    const reader = await geoReaderPromise;
    const geo = reader.get(normalizedIp);
    return {
      country_iso: geo?.country?.iso_code || null,
      country: geo?.country?.names?.en || null,
      city: geo?.city?.names?.en || null,
    };
  } catch (error) {
    console.error('Local GeoIP lookup failed:', error);
    return unknown;
  }
}
