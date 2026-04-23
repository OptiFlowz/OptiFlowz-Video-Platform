import crypto from "crypto";

export function getClientIp(req) {
    let ip = req.ip || "";

    if (ip.startsWith("::ffff:")) ip = ip.slice(7);
    return ip;
}

export function hashIp(ip) {
  if (!ip) return null;
  const salt = process.env.IP_HASH_SALT;
  return crypto.createHmac("sha256", salt).update(ip).digest("hex");
}