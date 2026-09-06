export function getClientIp(req) {
  // express će uz trust proxy koristiti X-Forwarded-For
  let ip = req.ip || '';

  // skini IPv6-mapped IPv4 prefix ::ffff:
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  return ip; // može biti i "::1" u lokalnom testu
}
