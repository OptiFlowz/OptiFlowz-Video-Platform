import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function encryptionKey() {
  const encodedKey = process.env.TWO_FACTOR_ENCRYPTION_KEY || '';
  const key = Buffer.from(encodedKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== encodedKey) {
    throw new Error('TWO_FACTOR_ENCRYPTION_KEY must be a base64-encoded 32-byte key');
  }
  return key;
}

export function encryptTotpSecret(secret, userId) {
  const key = encryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  // Bind the ciphertext to its owner so it cannot be moved between accounts.
  cipher.setAAD(Buffer.from(`totp:${userId}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);

  // v1: 12-byte IV, 16-byte authentication tag, then encrypted secret.
  return `v1.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64')}`;
}

export function decryptTotpSecret(stored, userId) {
  if (typeof stored !== 'string' || !stored.startsWith('v1.')) {
    throw new Error('Invalid encrypted TOTP secret');
  }
  const encoded = stored.slice(3);
  const payload = Buffer.from(encoded, 'base64');
  if (payload.length <= 28 || payload.toString('base64') !== encoded) {
    throw new Error('Invalid encrypted TOTP secret');
  }

  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), payload.subarray(0, 12));
  decipher.setAAD(Buffer.from(`totp:${userId}`, 'utf8'));
  decipher.setAuthTag(payload.subarray(12, 28));
  return Buffer.concat([
    decipher.update(payload.subarray(28)), decipher.final(),
  ]).toString('utf8');
}
